import type { LinearClient } from "@linear/sdk";
import { Command } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  createAgent,
  createMiddleware,
  humanInTheLoopMiddleware,
  todoListMiddleware,
  tool,
  ToolMessage,
  type HITLRequest,
} from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import { STATUS_TYPES, type Decision, type PendingAction, type Todo } from "shared";
import { z } from "zod";
import {
  createLinearIssue,
  fetchLinearIssue,
  fetchLinearIssues,
  fetchLinearTeams,
  searchLinearIssues,
  updateLinearIssue,
} from "./linear.js";
import {
  checkpointer,
  modelRetry,
  streamConfig,
  threadConfig,
  toChatMessages,
  toolErrors,
} from "./agents.js";
import { compactionMiddleware } from "./compaction.js";
import { diffForModel } from "./coordinator/tools.js";
import {
  coordinatorThreadId,
  getPipeline,
  loadSetup as loadPipelineSetup,
  outsideAgentRun,
  pipelineRun,
  readReply,
  replyFits,
  resumePipeline,
  startPipeline,
} from "./coordinator.js";
import { factsMiddleware } from "./facts.js";
import { fetchRepo, listRepoFiles, readRepoFile, searchRepoCode } from "./git.js";
import { notesMiddleware, readNotes } from "./notes.js";
import { Workspace } from "./models/Workspace.js";
import { npmTools } from "./npmTools.js";
import { OPENROUTER_URL } from "./openrouter.js";
import { startRun } from "./runs.js";
import { commitAndPush, createWorkspace, isIssueId } from "./workspaces.js";

// {repo} is the githubRepo setting.
const SYSTEM_PROMPT = `You are a product manager with access to the user's Linear workspace
and to the code of the product's GitHub repository ({repo}).
Help the user think through ideas, bugs and features, and turn them into clear Linear issues.

- Several people may use this chat. User messages start with the sender's name in brackets,
  e.g. "[Alice]: ..."; one without a name is from someone who hasn't set one. Don't start
  your own replies with a name.
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
- Mention the relevant files in issue descriptions when it helps whoever picks it up.
- The repo's files don't include its dependencies. To see what a package offers, read
  it with the npm_ tools, at the version in the repo's package.json or lockfile.
- When the user asks you to build an issue, use start_coordinator: it sets up the
  issue's workspace and starts the coordinator pipeline (planner, coder, reviewer). Use
  coordinator_status to report its progress; never call start_coordinator just to check.
  Use git_diff to see the code changes in the issue's workspace. When the user asks you to
  commit them, use commit_and_push, with a message you write from the diff (and the plan).
  Use reply_to_pipeline to answer the pipeline's questions, approve its plan or send it
  feedback, from this chat. Only send what the user said: never answer the pipeline's
  questions or approve its plan yourself. The user approves every reply before it's sent.`;

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

// The issue's id: workspaces and pipelines are keyed by it, not by its identifier.
const toIssueId = async (linear: LinearClient, id: string) =>
  isIssueId(id) ? id : (await fetchLinearIssue(linear, id)).id;

const ISSUE_ID = z.string().describe("Linear issue id or identifier, e.g. ENG-123");

// Drive the coordinator pipeline (see coordinator.ts) from chat. None of them waits on
// the workspace's setup or the pipeline's work: they start it, or say where it's at.
function coordinatorTools(linear: LinearClient) {
  return [
    tool(
      async ({ issueId }) => {
        const { workspace } = await createWorkspace(linear, await toIssueId(linear, issueId));
        if (workspace.setupStatus === "running") return JSON.stringify({ status: "setting_up" });
        if (workspace.setupStatus === "failed") {
          return JSON.stringify({ status: "setup_failed", error: workspace.setupError });
        }
        const pipeline = await getPipeline(workspace.issueId);
        if (pipeline.finished) return JSON.stringify({ status: "finished" });
        if (pipeline.started) return JSON.stringify({ status: "already_running" });
        const setup = await loadPipelineSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        const run = pipelineRun(setup, workspace.issueId);
        const started = await outsideAgentRun(() =>
          startRun(coordinatorThreadId(workspace.issueId), () => startPipeline(run, ""), run.notify),
        );
        return JSON.stringify({ status: started ? "started" : "already_running" });
      },
      {
        name: "start_coordinator",
        description:
          "Build an issue: create its workspace if it has none, and start the coordinator " +
          "pipeline once the workspace is set up. Returns straight away with a status: " +
          "setting_up (call again later), setup_failed, started, already_running, " +
          "finished (send feedback with reply_to_pipeline instead) or error.",
        schema: z.object({ issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ issueId }) => {
        const id = await toIssueId(linear, issueId);
        const [workspace, pipeline] = await Promise.all([Workspace.findByPk(id), getPipeline(id)]);
        return JSON.stringify({
          hasWorkspace: Boolean(workspace),
          setupStatus: workspace?.setupStatus ?? null,
          setupError: workspace?.setupError ?? null,
          ...pipeline,
        });
      },
      {
        name: "coordinator_status",
        description:
          "Where an issue's workspace setup and coordinator pipeline are at: running is the " +
          "subagent working now, waiting what the pipeline needs from the user (questions to " +
          "answer, a plan to approve, or feedback once finished). Also the subagents' " +
          "documents so far: the plan, the review's required changes, and every question " +
          "asked with its answer (clarifications). Not the code changes.",
        schema: z.object({ issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ issueId, path }) => {
        const id = await toIssueId(linear, issueId);
        if (!(await Workspace.findByPk(id))) return "This issue has no workspace.";
        return diffForModel(id, path);
      },
      {
        name: "git_diff",
        description:
          "The changes in an issue's workspace since it branched, uncommitted ones and new " +
          "files included: the list of changed files, then a unified diff. Not the default " +
          "branch that read_file reads. A long diff is cut between files, with a note naming " +
          "the rest; pass a path for one file's (or folder's) diff.",
        schema: z.object({ issueId: ISSUE_ID, path: z.string().optional() }),
      },
    ),
    tool(
      async ({ issueId, message }) => {
        const result = await commitAndPush(await toIssueId(linear, issueId), message ?? "");
        if ("error" in result) return JSON.stringify({ status: "error", error: result.error });
        return JSON.stringify({ status: "pushed", branch: result.workspace.branch });
      },
      {
        name: "commit_and_push",
        description:
          "Commit all of an issue's workspace's uncommitted changes with message, then push " +
          "its branch to GitHub. With nothing uncommitted it only pushes, and message can " +
          "be left out. Not while the coordinator is working in the workspace. The user " +
          "approves the call before it runs.",
        schema: z.object({
          issueId: ISSUE_ID,
          message: z
            .string()
            .optional()
            .describe("Commit message: a short summary line, then a blank line and the details"),
        }),
      },
    ),
    tool(
      async ({ issueId, ...input }) => {
        // Exactly one, so nothing the user approved on the card is left out.
        if (Object.values(input).filter((value) => value !== undefined).length !== 1) {
          return JSON.stringify({
            status: "error",
            error: "Pass exactly one of answers, approve or feedback",
          });
        }
        const id = await toIssueId(linear, issueId);
        const { waiting } = await getPipeline(id);
        if (!waiting) return JSON.stringify({ status: "not_waiting" });
        const reply = readReply(input);
        if (!reply || !replyFits(waiting, reply)) {
          return JSON.stringify({
            status: "error",
            error: "That reply doesn't fit what the pipeline is waiting on",
            waiting,
          });
        }
        const workspace = await Workspace.findByPk(id);
        if (workspace?.setupStatus !== "ready") {
          return JSON.stringify({ status: "error", error: "The workspace isn't set up" });
        }
        const setup = await loadPipelineSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        const run = pipelineRun(setup, id);
        const started = await outsideAgentRun(() =>
          startRun(coordinatorThreadId(id), () => resumePipeline(run, reply), run.notify),
        );
        return JSON.stringify(started ? { status: "resumed" } : { status: "error", error: "The pipeline is still running" });
      },
      {
        name: "reply_to_pipeline",
        description:
          "Reply to what an issue's coordinator pipeline is waiting on, with exactly one of: " +
          "answers (one per question, in order), approve: true (approve the plan), or " +
          "feedback (on the plan, or on the changes once finished). The user approves the " +
          "call before it runs.",
        schema: z.object({
          issueId: ISSUE_ID,
          answers: z.array(z.string()).optional(),
          approve: z.boolean().optional(),
          feedback: z.string().optional(),
        }),
      },
    ),
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


// Tool calls that never got a result, because the run died while they ran (a crash, a
// server restart), make the model API reject the whole conversation, leaving the chat
// stuck. Each model call gets a stand-in result for them; the saved history is left
// as it is.
function withMissingToolResults(messages: BaseMessage[]) {
  const answered = new Set(messages.filter(ToolMessage.isInstance).map((m) => m.tool_call_id));
  return messages.flatMap((message) => {
    const missing = AIMessage.isInstance(message)
      ? (message.tool_calls ?? []).filter((call) => call.id && !answered.has(call.id))
      : [];
    return [
      message,
      ...missing.map(
        (call) =>
          new ToolMessage({
            tool_call_id: call.id!,
            name: call.name,
            status: "error",
            content: "This call was interrupted and never ran.",
          }),
      ),
    ];
  });
}

const repairToolCalls = createMiddleware({
  name: "RepairToolCalls",
  wrapModelCall: (request, handler) =>
    handler({ ...request, messages: withMissingToolResults(request.messages) }),
});

// Shows the model who sent each message, from the username saved with it. Only in
// what the model reads: the saved message, and so the chat, stays as it was written.
const senderNames = createMiddleware({
  name: "SenderNames",
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      messages: request.messages.map((m) => {
        const username = m.additional_kwargs.username;
        if (m.type !== "human" || typeof username !== "string") return m;
        return new HumanMessage({
          id: m.id,
          content: `[${username}]: ${m.text}`,
          additional_kwargs: m.additional_kwargs,
        });
      }),
    }),
});

// Built per call, like the Linear client, so a new key or model applies straight
// away. The shared checkpointer keeps each thread's history between calls.
function buildAgent({ linear, openRouterKey, model, repo }: Setup) {
  const chatModel = new ChatOpenAI({
    model,
    apiKey: openRouterKey,
    configuration: { baseURL: OPENROUTER_URL },
  });
  return createAgent({
    model: chatModel,
    tools: [...buildTools(linear), ...coordinatorTools(linear), ...codeTools, ...npmTools],
    systemPrompt: SYSTEM_PROMPT.replace("{repo}", repo),
    checkpointer,
    middleware: [
      // Outermost, so it also covers fetchRepoMiddleware's tools.
      toolErrors,
      compactionMiddleware(chatModel),
      modelRetry,
      repairToolCalls,
      senderNames,
      todoListMiddleware(),
      // Notes before facts in the prompt: they change less often.
      notesMiddleware,
      factsMiddleware,
      humanInTheLoopMiddleware({
        interruptOn: {
          create_issue: { allowedDecisions: ["approve", "reject"] },
          update_issue: { allowedDecisions: ["approve", "reject"] },
          reply_to_pipeline: { allowedDecisions: ["approve", "reject"] },
          commit_and_push: { allowedDecisions: ["approve", "reject"] },
        },
      }),
      fetchRepoMiddleware,
    ],
  });
}

// repo is the githubRepo setting, "owner/name".
type Setup = { linear: LinearClient; openRouterKey: string; model: string; repo: string };

// A reply is many small steps (a tool call, then its result), so LangGraph's default
// of 25 is nowhere near enough for a long one, and compaction (100k tokens) never
// comes into play first. The limit is on the steps of a single run: the count is read
// from the saved checkpoint, so every message gets a fresh budget.
const RECURSION_LIMIT = 250;

// Sends the user's next message on a thread. The run ends with a reply, or paused
// on actions to approve. Aborting it stops the run in flight, leaving the checkpoint
// its finished steps were saved to, which the next turn carries on from. The sender's
// username (null if they haven't set one) is saved with the message.
export function chat(
  setup: Setup,
  threadId: string,
  message: string,
  username: string | null,
  signal?: AbortSignal,
) {
  return buildAgent(setup).stream(
    { messages: [new HumanMessage({ content: message, additional_kwargs: { username } })] },
    streamConfig(threadId, RECURSION_LIMIT, signal),
  );
}

// Answers the actions a paused thread is waiting on, one decision per action. Like
// chat, it can be stopped while it runs.
export function resume(setup: Setup, threadId: string, decisions: Decision[], signal?: AbortSignal) {
  return buildAgent(setup).stream(
    new Command({ resume: { decisions } }),
    streamConfig(threadId, RECURSION_LIMIT, signal),
  );
}

// A saved thread's whole conversation, compacted messages included, the actions it's
// paused on if any, the agent's key facts and to-do list, and its project notes (shared
// by every chat). running: a run is going on it now.
export async function loadThread(setup: Setup, threadId: string, running: boolean) {
  const agent = buildAgent(setup);
  const state = await agent.graph.getState(threadConfig(threadId));
  const messages: BaseMessage[] = [...(state.values.compacted ?? []), ...(state.values.messages ?? [])];
  const pending = await toPending(setup.linear, state.tasks.flatMap((task) => task.interrupts));
  return {
    messages: toChatMessages(messages, running || pending.length > 0),
    pending,
    facts: (state.values.facts ?? []) as string[],
    notes: readNotes(),
    todos: (state.values.todos ?? []) as Todo[],
  };
}

async function toPending(
  linear: LinearClient,
  interrupts: { value?: unknown }[] = [],
): Promise<PendingAction[]> {
  const request = interrupts[0]?.value as HITLRequest | undefined;
  return Promise.all(
    (request?.actionRequests ?? []).map(async ({ name, args }) =>
      name === "reply_to_pipeline"
        ? { name, args, questions: await pipelineQuestions(linear, String(args.issueId)) }
        : { name, args },
    ),
  );
}

// The questions the issue's pipeline is waiting on, for showing a reply's answers next
// to them. undefined if it isn't waiting on questions, or the issue can't be found:
// the reply is still shown, just without them.
async function pipelineQuestions(linear: LinearClient, issueId: string) {
  try {
    const { waiting } = await getPipeline(await toIssueId(linear, issueId));
    return waiting?.kind === "questions" ? waiting.questions : undefined;
  } catch (err) {
    console.error(`Reading the pipeline's questions for ${issueId} failed:`, err);
    return undefined;
  }
}

// Removes a thread's saved conversation from the checkpointer.
export async function deleteThreadHistory(threadId: string) {
  await checkpointer.deleteThread(threadId);
}
