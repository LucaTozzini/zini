import { dirname, join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { getRetryable } from "@langchain/core/errors";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { modelRetryMiddleware, toolErrorMiddleware } from "langchain";
import type { ChatMessage } from "shared";
import { isSummary, summaryText } from "./compaction.js";
import { storage } from "./db.js";

// What the agents (product manager, coordinator) share.

// Conversations live here, keyed by thread id, so a run can pause for approval and
// resume later, even after a restart. Its own file next to the main database, since
// it uses a different SQLite driver (better-sqlite3) than Sequelize.
export const checkpointer = SqliteSaver.fromConnString(join(dirname(storage), "checkpoints.sqlite"));

export const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

// Runs are streamed so the caller can report progress: "values" yields the state
// once the input is applied and again after every step, and "sync" saves each step
// before its chunk is yielded, so a reload at any chunk sees everything so far.
// recursionLimit is optional, and left out (LangGraph's default of 25) unless the
// agent needs more steps than that. It counts the steps of one run: the count is
// read from the saved checkpoint, so every message gets a fresh budget. signal is the
// run's abort signal (see stopRun), which cancels the model and tool calls it has in
// flight, and is left out for a run that can't be stopped (the coordinator's).
export const streamConfig = (threadId: string, recursionLimit?: number, signal?: AbortSignal) => ({
  ...threadConfig(threadId),
  streamMode: "values" as const,
  durability: "sync" as const,
  ...(recursionLimit === undefined ? {} : { recursionLimit }),
  ...(signal ? { signal } : {}),
});

// A tool that throws (e.g. no such file, or an unknown status name) gives the model
// the error as its result, so it can correct itself and carry on. The agent does this
// by default, but not once any wrapToolCall middleware is in use: errors then end the
// run. Interrupts for approval still pass through.
export const toolErrors = toolErrorMiddleware({
  onError: (error) => `${error instanceof Error ? error.message : String(error)}\nPlease fix your mistakes.`,
});

// A failed model call is tried twice more (after 1s, then 2s) before the run fails:
// OpenRouter's providers now and then answer with an error instead of a reply. A call
// that fails every time fails the run as before, rather than being turned into a reply.
export const modelRetry = modelRetryMiddleware({
  onFailure: "error",
  // A stopped run's aborted call isn't worth trying again; anything else is retried
  // unless LangChain has marked it as not retryable (its default).
  retryOn: (error) => error.name !== "AbortError" && (getRetryable(error) ?? true),
});

// The user's messages, the agent's written replies and its tool calls, each with its
// result's status, and a marker where each compaction happened, with its summary.
// Results themselves stay out: they can be whole files. live: the conversation is
// running or waiting on approval, so the last reply's calls without a result may still
// get one. Any other call without a result never ran (e.g. the run failed first).
export function toChatMessages(messages: BaseMessage[], live: boolean): ChatMessage[] {
  const results = new Map(
    messages.filter(ToolMessage.isInstance).map((m) => [m.tool_call_id, m]),
  );
  const lastReply = messages.findLast(AIMessage.isInstance);
  return messages.flatMap((message): ChatMessage[] => {
    if (isSummary(message)) return [{ role: "compaction", summary: summaryText(message) }];
    if (message.type === "human") {
      const username = message.additional_kwargs.username;
      return [
        {
          role: "user",
          content: message.text,
          ...(typeof username === "string" && { username }),
        },
      ];
    }
    if (!AIMessage.isInstance(message)) return [];
    const calls = (message.tool_calls ?? []).map((call): ChatMessage => {
      const result = call.id ? results.get(call.id) : undefined;
      const base = { role: "tool" as const, name: call.name, args: call.args };
      if (!result && live && message === lastReply) return { ...base, status: "pending" };
      if (!result) return { ...base, status: "never_ran" };
      if (result.status === "error") return { ...base, status: "error", error: result.text };
      return { ...base, status: "done" };
    });
    return message.text ? [{ role: "assistant", content: message.text }, ...calls] : calls;
  });
}
