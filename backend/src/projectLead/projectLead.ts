import type { LinearClient } from "@linear/sdk";
import { Command } from "@langchain/langgraph";
import { createAgent, createMiddleware, humanInTheLoopMiddleware, todoListMiddleware, tool, type HITLRequest } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import type { Decision, PendingAction, Todo } from "shared";
import { z } from "zod";
import {
  checkpointer,
  modelRetry,
  modelStamp,
  repairToolCalls,
  streamConfig,
  threadConfig,
  toChatEntries,
  toolErrors,
} from "../agents/agents.js";
import { compactionMiddleware } from "../agents/compaction.js";
import { getForge } from "../forge/forge.js";
import { codeTools, fetchRepoMiddleware } from "../agents/codeTools.js";
import { wikiTools } from "../openwiki/wikiTools.js";
import { exploreCode } from "../agents/codeExplorer.js";
import { notesMiddleware, readNotes } from "./notes.js";
import { userMessage, withSenderName } from "./messageInput.js";
import { npmTools } from "../agents/npmTools.js";
import { chatModel as connectModel, loadConnection, type ModelConnection } from "../providers/modelProvider.js";
import { sendEvent } from "../core/events.js";
import { forgeSubscriptions } from "../forge/forgeSubscriptions.js";
import type { QueuedMessage } from "../models/ProjectLeadQueueMessage.js";
import { freshQueuedMessages } from "./queuedMessages.js";
import { getLinearClient } from "../integrations/linear.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../core/settings.js";
import { browserTools } from "../browser/browserTools.js";
import { closeBrowser } from "../browser/agentBrowser.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { linearTools, toIssueId } from "./linearTools.js";
import { forgeTools, workspaceAppTools } from "./forgeTools.js";
import { pullRequestTools } from "./pullRequestTools.js";

// Shows the model who sent each message, from the username saved with it. Only in
// what the model reads: the saved message, and so the chat, stays as it was written.
const senderNames = createMiddleware({
  name: "SenderNames",
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      messages: request.messages.map(withSenderName),
    }),
});

// Built per call, like the Linear client, so a new key or model applies straight
// away. The shared checkpointer keeps each thread's history between calls.
function buildAgent({ linear, connection, model, repo }: Setup, threadId: string) {
  const chatModel = connectModel(connection, model);
  // The run's signal reaches the tool, so stopping the chat stops the explorer too.
  // The chat's id goes in the explorer's log.
  const exploreCodeTool = tool(
    async ({ question }, config) =>
      exploreCode(chatModel, question, {
        signal: config.signal,
        caller: config.configurable?.thread_id,
      }),
    {
      name: "explore_code",
      description:
        "Ask a code explorer a question about the repo's code or about any npm package (a " +
        "dependency or one you're considering). It explores the repo's default branch and " +
        "reads packages as published on npm, and answers with path:line references. It " +
        "doesn't see this conversation, so make the question complete on its own.",
      schema: z.object({ question: z.string().min(1) }),
    },
  );
  return createAgent({
    model: chatModel,
    tools: [
      ...linearTools(linear),
      ...forgeTools(linear),
      ...workspaceAppTools(linear, chatModel),
      ...codeTools,
      ...wikiTools,
      exploreCodeTool,
      ...pullRequestTools(repo),
      ...npmTools,
      ...browserTools(`project-lead:${threadId}`, () => sendEvent({ type: "thread.updated", threadId }), { external: true }),
    ],
    systemPrompt: SYSTEM_PROMPT.replace("{repo}", repo),
    checkpointer,
    middleware: [
      // Outermost, so it also covers fetchRepoMiddleware's tools.
      toolErrors,
      compactionMiddleware(chatModel),
      modelRetry,
      modelStamp(model),
      repairToolCalls,
      senderNames,
      todoListMiddleware(),
      notesMiddleware,
      humanInTheLoopMiddleware({
        interruptOn: {
          create_issue: { allowedDecisions: ["approve", "reject"] },
          update_issue: { allowedDecisions: ["approve", "reject"] },
          set_blocker: { allowedDecisions: ["approve", "reject"] },
          reply_to_forge: { allowedDecisions: ["approve", "reject"] },
          commit_and_push: { allowedDecisions: ["approve", "reject"] },
          pull_request_create: { allowedDecisions: ["approve", "reject"] },
          pull_request_comment: { allowedDecisions: ["approve", "reject"] },
          pull_request_resolve_thread: { allowedDecisions: ["approve", "reject"] },
        },
      }),
      fetchRepoMiddleware,
    ],
  });
}

// repo is the githubRepo setting, "owner/name".
type Setup = { linear: LinearClient; connection: ModelConnection; model: string; repo: string };

export async function loadProjectLeadSetup(): Promise<Setup | string> {
  const [linear, connection, githubToken, model, repo] = await Promise.all([
    getLinearClient(),
    getSetting("projectLeadProvider").then(loadConnection),
    getKey("github"),
    getSetting("projectLeadModel"),
    getSetting("githubRepo"),
  ]);
  if (!linear) return "Linear isn't connected";
  if (typeof connection === "string") return connection;
  if (!githubToken) return "GitHub isn't connected";
  if (!model) return "No model set";
  if (!repo) return "No GitHub repository set";
  return { linear, connection, model, repo };
}

export async function receiveQueuedMessages(setup: Setup, threadId: string, events: QueuedMessage[], signal: AbortSignal) {
  const agent = buildAgent(setup, threadId);
  const state = await agent.graph.getState(threadConfig(threadId));
  const messages: BaseMessage[] = [...(state.values.compacted ?? []), ...(state.values.messages ?? [])];
  const fresh = freshQueuedMessages(messages, events);
  if (!fresh.length) return (async function* () {})();
  return agent.stream({ messages: fresh }, streamConfig(threadId, RECURSION_LIMIT, signal));
}

export async function projectLeadAwaitingApproval(setup: Setup, threadId: string) {
  const state = await buildAgent(setup, threadId).graph.getState(threadConfig(threadId));
  return state.tasks.some((task) => task.interrupts.length > 0);
}

// A reply is many small steps (a tool call, then its result), so LangGraph's default
// of 25 is nowhere near enough for a long one, and compaction (100k tokens) never
// comes into play first. The limit is on the steps of a single run: the count is read
// from the saved checkpoint, so every message gets a fresh budget.
const RECURSION_LIMIT = 250;

// Sends the user's next message on a thread. The run ends with a reply, or paused
// on actions to approve. Aborting it stops the run in flight, leaving the checkpoint
// its finished steps were saved to, which the next turn carries on from. The sender's
// authenticated username is saved with the message. Null remains supported for
// internal callers and older conversation history.
export function chat(
  setup: Setup,
  threadId: string,
  message: string,
  username: string | null,
  signal?: AbortSignal,
  images: string[] = [],
) {
  return buildAgent(setup, threadId).stream(
    { messages: [userMessage(message, images, username)] },
    streamConfig(threadId, RECURSION_LIMIT, signal),
  );
}

// Answers the actions a paused thread is waiting on, one decision per action. Like
// chat, it can be stopped while it runs.
export function resume(setup: Setup, threadId: string, decisions: Decision[], signal?: AbortSignal) {
  return buildAgent(setup, threadId).stream(
    new Command({ resume: { decisions } }),
    streamConfig(threadId, RECURSION_LIMIT, signal),
  );
}

// A saved thread's whole conversation, compacted messages included, the actions it's
// paused on if any, the agent's to-do list, and its project notes (shared by every
// chat). running: a run is going on it now.
export async function loadThread(setup: Setup, threadId: string, running: boolean) {
  const agent = buildAgent(setup, threadId);
  const state = await agent.graph.getState(threadConfig(threadId));
  const messages: BaseMessage[] = [...(state.values.compacted ?? []), ...(state.values.messages ?? [])];
  const pending = await toPending(
    setup.linear,
    state.tasks.flatMap((task) => task.interrupts),
  );
  return {
    // Without tool results: they can be whole files.
    messages: toChatEntries(messages, running || pending.length > 0).map((entry) =>
      entry.role === "tool" ? { ...entry, result: undefined } : entry,
    ),
    pending,
    notes: readNotes(),
    todos: (state.values.todos ?? []) as Todo[],
    subscriptions: await forgeSubscriptions.list(threadId),
  };
}

async function toPending(linear: LinearClient, interrupts: { value?: unknown }[] = []): Promise<PendingAction[]> {
  const request = interrupts[0]?.value as HITLRequest | undefined;
  return Promise.all(
    (request?.actionRequests ?? []).map(async ({ name, args }) =>
      name === "reply_to_forge" ? { name, args, questions: await forgeQuestions(linear, String(args.issueId)) } : { name, args },
    ),
  );
}

// The questions the issue's Forge is waiting on, for showing a
// reply's answers next to them. undefined if it isn't waiting on questions, or
// the issue can't be found: the reply is still shown, just without them.
async function forgeQuestions(linear: LinearClient, issueId: string) {
  try {
    const { waiting } = await getForge(await toIssueId(linear, issueId));
    return waiting?.kind === "questions" ? waiting.questions : undefined;
  } catch (err) {
    console.error(`Reading the Forge's questions for ${issueId} failed:`, err);
    return undefined;
  }
}

// Removes a thread's saved conversation from the checkpointer.
export async function deleteThreadHistory(threadId: string) {
  await closeBrowser(`project-lead:${threadId}`);
  await checkpointer.deleteThread(threadId);
}
