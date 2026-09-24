import type { LinearClient } from "@linear/sdk";
import { join, dirname } from "node:path";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, humanInTheLoopMiddleware, tool, type HITLRequest } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import {
  STATUS_TYPES,
  type ChatMessage,
  type ChatResponse,
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
import { OPENROUTER_URL } from "./openrouter.js";

const SYSTEM_PROMPT = `You are a product manager with access to the user's Linear workspace.
Help the user think through ideas, bugs and features, and turn them into clear Linear issues.

- Look at existing issues before proposing new ones (search_issues finds them by keyword),
  and point out likely duplicates.
- The user approves every create_issue and update_issue call before it runs. If they
  reject one, read their note, adjust, and propose again.
- Linear priorities: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low.
- Statuses and assignees are per team: use list_teams to see a team's status names and
  members. "Me" is the list_teams viewer.
- After creating or updating an issue, share its identifier and link.`;

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
        "Change an issue's title, description, priority, status or assignee. Only pass the " +
        "fields to change; set assignee to null to unassign. " +
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

// Conversations live here, keyed by thread id, so a run can pause for approval and
// resume later, even after a restart. Its own file next to the main database, since
// it uses a different SQLite driver (better-sqlite3) than Sequelize.
const checkpointer = SqliteSaver.fromConnString(join(dirname(storage), "checkpoints.sqlite"));

// Built per call, like the Linear client, so a new key or model applies straight
// away. The shared checkpointer keeps each thread's history between calls.
function buildAgent(linear: LinearClient, openRouterKey: string, model: string) {
  return createAgent({
    model: new ChatOpenAI({
      model,
      apiKey: openRouterKey,
      configuration: { baseURL: OPENROUTER_URL },
    }),
    tools: buildTools(linear),
    systemPrompt: SYSTEM_PROMPT,
    checkpointer,
    middleware: [
      humanInTheLoopMiddleware({
        interruptOn: {
          create_issue: { allowedDecisions: ["approve", "reject"] },
          update_issue: { allowedDecisions: ["approve", "reject"] },
        },
      }),
    ],
  });
}

type Setup = { linear: LinearClient; openRouterKey: string; model: string };

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

// Sends the user's next message on a thread.
export async function chat(setup: Setup, threadId: string, message: string) {
  const agent = buildAgent(setup.linear, setup.openRouterKey, setup.model);
  const result = await agent.invoke(
    { messages: [{ role: "user", content: message }] },
    threadConfig(threadId),
  );
  return toResponse(result.messages, result.__interrupt__);
}

// Answers the actions a paused thread is waiting on, one decision per action.
export async function resume(setup: Setup, threadId: string, decisions: Decision[]) {
  const agent = buildAgent(setup.linear, setup.openRouterKey, setup.model);
  const result = await agent.invoke(new Command({ resume: { decisions } }), threadConfig(threadId));
  return toResponse(result.messages, result.__interrupt__);
}

// A saved thread's conversation, and the actions it's paused on if any.
export async function loadThread(setup: Setup, threadId: string) {
  const agent = buildAgent(setup.linear, setup.openRouterKey, setup.model);
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

function toResponse(
  messages: { text: string }[],
  interrupts?: { value?: unknown }[],
): ChatResponse {
  return { reply: messages.at(-1)?.text ?? "", pending: toPending(interrupts) };
}

// Removes a thread's saved conversation from the checkpointer.
export async function deleteThreadHistory(threadId: string) {
  await checkpointer.deleteThread(threadId);
}
