import { dirname, join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { BaseMessage } from "@langchain/core/messages";
import { toolErrorMiddleware } from "langchain";
import type { ChatMessage } from "shared";
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
export const streamConfig = (threadId: string) => ({
  ...threadConfig(threadId),
  streamMode: "values" as const,
  durability: "sync" as const,
});

// A tool that throws (e.g. no such file, or an unknown status name) gives the model
// the error as its result, so it can correct itself and carry on. The agent does this
// by default, but not once any wrapToolCall middleware is in use: errors then end the
// run. Interrupts for approval still pass through.
export const toolErrors = toolErrorMiddleware({
  onError: (error) => `${error instanceof Error ? error.message : String(error)}\nPlease fix your mistakes.`,
});

// Only the user's messages and the agent's written replies; tool calls and their
// results stay out of the chat.
export function toChatMessage(message: BaseMessage): ChatMessage[] {
  if (message.type === "human") return [{ role: "user", content: message.text }];
  if (message.type === "ai" && message.text) return [{ role: "assistant", content: message.text }];
  return [];
}
