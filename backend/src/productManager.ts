import type { LinearClient } from "@linear/sdk";
import { join, dirname } from "node:path";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatOpenAI } from "@langchain/openai";
import {
  createAgent,
  createMiddleware,
  humanInTheLoopMiddleware,
  tool,
  ToolMessage,
  type HITLRequest,
} from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import {
  STATUS_TYPES,
  type ChatMessage,
  type Decision,
  type PendingAction,
} from "shared";
import { z } from "zod";
import {
  createLinearIssue,
  fetchLinearIssue,
  fetchLinearIssues,
  fetchLinearTeams,
  searchLinearIssues,
  updateLinearIssue,
} from "./linear.js";
import { storage } from "./db.js";
import { fetchRepo, listRepoFiles, readRepoFile, searchRepoCode } from "./git.js";
import { OPENROUTER_URL } from "./openrouter.js";

// {repo} is the githubRepo setting.
const SYSTEM_PROMPT = `You are a product manager with access to the user's Linear workspace
and to the code of the product's GitHub repository ({repo}).
Help the user think through ideas, bugs and features, and turn them into clear Linear issues.

- Look at existing issues before proposing new ones (search_issues finds them by keyword),
  and point out likely duplicates.
- The user approves every create_issue and update_issue call before it runs. If they
  reject one, read their note, adjust, and propose again.
- Linear priorities: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low.
- Statuses and assignees are per team: use list_teams to see a team's status names and
  members. "Me" is the list_teams viewer.
- After creating or updating an issue, share its identifier and link.
- list_files, read_file and search_code read the repo's default branch, always up to date.
  Check the code before saying what the product does or doesn't do, and before proposing
  issues about it.
- Mention the relevant files in issue descriptions when it helps whoever picks it up.`;

// Names rather than ids, so the approval card shows what will be set.
const STATUS = z.string().describe("A status name from the issue's team, e.g. \"In Progress\"");
const ASSIGNEE = z.string().describe("Email of a member of the issue's team");

function buildTools(linear: LinearClient) {
  return [
    tool(
      async ({ statusTypes }) => JSON.stringify(await fetchLinearIssues(linear, statusTypes ?? [])),
      {
        name: "list_issues",
        description:
          "List up to 250 issues, most recently updated first, without descriptions. " +
          "Optionally filter by status type.",
        schema: z.object({ statusTypes: z.array(z.enum(STATUS_TYPES)).optional() }),
      },
    ),
    tool(async ({ query }) => JSON.stringify(await searchLinearIssues(linear, query)), {
      name: "search_issues",
      description:
        "Search issue titles and descriptions with Linear's full-text search, like its " +
        "search box. Up to 50 results.",
      schema: z.object({ query: z.string().min(1) }),
    }),
    tool(async ({ id }) => JSON.stringify(await fetchLinearIssue(linear, id)), {
      name: "get_issue",
      description: "Get one issue with its description, by identifier (e.g. ENG-123) or id.",
      schema: z.object({ id: z.string() }),
    }),
    tool(async () => JSON.stringify(await fetchLinearTeams(linear)), {
      name: "list_teams",
      description:
        "List the workspace's teams with their statuses and members, and who \"me\" is. " +
        "Creating an issue needs a team id.",
      schema: z.object({}),
    }),
    tool(async (input) => JSON.stringify(await createLinearIssue(linear, input)), {
      name: "create_issue",
      description: "Create an issue. The user approves the call before it runs.",
      schema: z.object({
        teamId: z.string(),
        title: z.string(),
        description: z.string().optional().describe("Markdown"),
        priority: z.number().int().min(0).max(4).optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.optional(),
      }),
    }),
    tool(async ({ id, ...changes }) => JSON.stringify(await updateLinearIssue(linear, id, changes)), {
      name: "update_issue",
      description:
        "Change an issue's title, description, priority, status or assignee. Every field " +
        "but id is optional: omit the ones you aren't changing, rather than passing their " +
        "current value or an empty string. Set assignee to null to unassign. " +
        "The user approves the call before it runs.",
      schema: z.object({
        id: z.string().describe("Identifier (e.g. ENG-123) or id"),
        title: z.string().optional(),
        description: z.string().optional().describe("Markdown"),
        priority: z.number().int().min(0).max(4).optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.nullable().optional(),
      }),
    }),
  ];
}

// Read-only tools over the repo's default branch. Fetching is left to fetchRepoMiddleware.
const codeTools = [
  tool(async ({ path }) => listRepoFiles(path ?? ""), {
    name: "list_files",
    description: "List a folder's files and subfolders (subfolders end in /). Omit path for the root.",
    schema: z.object({ path: z.string().optional().describe('e.g. "src/components"') }),
  }),
  tool(async ({ path, startLine, endLine }) => readRepoFile(path, startLine, endLine), {
    name: "read_file",
    description:
      "Read a file, with line numbers. Long files are cut off with a note saying which " +
      "startLine to read on from; pass a line range to read just part of a file.",
    schema: z.object({
      path: z.string().describe('e.g. "src/App.tsx"'),
      startLine: z.number().int().min(1).optional().describe("First line to read, from 1"),
      endLine: z.number().int().min(1).optional().describe("Last line to read, inclusive"),
    }),
  }),
  tool(async ({ query }) => searchRepoCode(query), {
    name: "search_code",
    description:
      "Find lines containing some text (plain text, any case), as path:line:text. " +
      "Up to 100 matches; use a more specific term if there are more.",
    schema: z.object({ query: z.string().min(1) }),
  }),
];
const CODE_TOOL_NAMES = new Set<string>(codeTools.map((t) => t.name));

// Brings the clone up to date before each code tool runs; other tools pass straight
// through. Parallel code tools share one fetch (see fetchRepo). If the fetch fails,
// the tool doesn't run on stale code: the model gets the error as its result.
const fetchRepoMiddleware = createMiddleware({
  name: "FetchRepo",
  wrapToolCall: async (request, handler) => {
    if (!CODE_TOOL_NAMES.has(request.toolCall.name)) return handler(request);
    try {
      await fetchRepo();
    } catch (err) {
      console.error("Fetching the repo failed:", err);
      // A failed git command's message ends with its "fatal: ..." line.
      const reason = err instanceof Error ? err.message.trim().split("\n").at(-1) : String(err);
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: request.toolCall.name,
        status: "error",
        content: `Couldn't update the code from GitHub: ${reason}. Tell the user.`,
      });
    }
    return handler(request);
  },
});

// Conversations live here, keyed by thread id, so a run can pause for approval and
// resume later, even after a restart. Its own file next to the main database, since
// it uses a different SQLite driver (better-sqlite3) than Sequelize.
const checkpointer = SqliteSaver.fromConnString(join(dirname(storage), "checkpoints.sqlite"));

// Built per call, like the Linear client, so a new key or model applies straight
// away. The shared checkpointer keeps each thread's history between calls.
function buildAgent({ linear, openRouterKey, model, repo }: Setup) {
  return createAgent({
    model: new ChatOpenAI({
      model,
      apiKey: openRouterKey,
      configuration: { baseURL: OPENROUTER_URL },
    }),
    tools: [...buildTools(linear), ...codeTools],
    systemPrompt: SYSTEM_PROMPT.replace("{repo}", repo),
    checkpointer,
    middleware: [
      humanInTheLoopMiddleware({
        interruptOn: {
          create_issue: { allowedDecisions: ["approve", "reject"] },
          update_issue: { allowedDecisions: ["approve", "reject"] },
        },
      }),
      fetchRepoMiddleware,
    ],
  });
}

// repo is the githubRepo setting, "owner/name".
type Setup = { linear: LinearClient; openRouterKey: string; model: string; repo: string };

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

// Runs are streamed so the caller can report progress: "values" yields the state
// once the input is applied and again after every step, and "sync" saves each step
// before its chunk is yielded, so a reload at any chunk sees everything so far.
const streamConfig = (threadId: string) => ({
  ...threadConfig(threadId),
  streamMode: "values" as const,
  durability: "sync" as const,
});

// Sends the user's next message on a thread. The run ends with a reply, or paused
// on actions to approve.
export function chat(setup: Setup, threadId: string, message: string) {
  return buildAgent(setup).stream(
    { messages: [{ role: "user", content: message }] },
    streamConfig(threadId),
  );
}

// Answers the actions a paused thread is waiting on, one decision per action.
export function resume(setup: Setup, threadId: string, decisions: Decision[]) {
  return buildAgent(setup).stream(new Command({ resume: { decisions } }), streamConfig(threadId));
}

// A saved thread's conversation, and the actions it's paused on if any.
export async function loadThread(setup: Setup, threadId: string) {
  const agent = buildAgent(setup);
  const state = await agent.graph.getState(threadConfig(threadId));
  const messages: BaseMessage[] = state.values.messages ?? [];
  return {
    messages: messages.flatMap(toChatMessage),
    pending: toPending(state.tasks.flatMap((task) => task.interrupts)),
  };
}

// Only the user's messages and the agent's written replies; tool calls and their
// results stay out of the chat.
function toChatMessage(message: BaseMessage): ChatMessage[] {
  if (message.type === "human") return [{ role: "user", content: message.text }];
  if (message.type === "ai" && message.text) return [{ role: "assistant", content: message.text }];
  return [];
}

function toPending(interrupts: { value?: unknown }[] = []): PendingAction[] {
  const request = interrupts[0]?.value as HITLRequest | undefined;
  return request?.actionRequests.map(({ name, args }) => ({ name, args })) ?? [];
}

// Removes a thread's saved conversation from the checkpointer.
export async function deleteThreadHistory(threadId: string) {
  await checkpointer.deleteThread(threadId);
}
