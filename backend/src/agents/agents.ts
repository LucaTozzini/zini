import { dirname, join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getRetryable } from "@langchain/core/errors";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, modelRetryMiddleware, toolErrorMiddleware } from "langchain";
import type { ChatEntry, ChatMessage } from "shared";
import { isSummary, summaryText } from "./compaction.js";
import { storage } from "../db.js";
import { isModelRateLimit } from "../providers/modelErrors.js";
import { timestampedSerializer } from "./messageTimestamps.js";
import { errorMessage } from "../core/errors.js";

// What the agents (project lead, forge) share.

// Keeps only the latest checkpoint of each thread and namespace (the Forge, an agent
// conversation, a Project Lead chat): each holds the whole state, so a long run's
// history would grow to gigabytes, and nothing resumes from or reads older ones.
// Pending writes of older checkpoints go with them; the latest keeps its own.
export class LatestCheckpointSaver extends SqliteSaver {
  async put(...args: Parameters<SqliteSaver["put"]>) {
    const saved = await super.put(...args);
    const { thread_id, checkpoint_ns = "", checkpoint_id } = saved.configurable ?? {};
    for (const table of ["checkpoints", "writes"]) {
      this.db
        .prepare(`DELETE FROM ${table} WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id < ?`)
        .run(thread_id, checkpoint_ns, checkpoint_id);
    }
    return saved;
  }

  // Returns a deleted thread's space to the disk; pruned checkpoints' space is reused
  // by the next ones instead.
  async deleteThread(threadId: string) {
    await super.deleteThread(threadId);
    this.db.pragma("incremental_vacuum");
  }
}

// Conversations live here, keyed by thread id, so a run can pause for approval and
// resume later, even after a restart. Its own file next to the main database, since
// it uses a different SQLite driver (better-sqlite3) than Sequelize; fromConnString
// opens it.
const { db } = SqliteSaver.fromConnString(join(dirname(storage), "checkpoints.sqlite"));
// Takes effect when the file is created, before any table.
db.pragma("auto_vacuum = INCREMENTAL");
export const checkpointer = new LatestCheckpointSaver(db);
checkpointer.serde = timestampedSerializer(checkpointer.serde);

// For reading conversations for the webapp, never for runs: a thread's latest checkpoint
// stays parsed, and is reused until a cheap query on its newest rows shows the thread was
// saved to since. Parsing a long conversation takes a few hundred milliseconds, and
// blocks the server while it does, and the webapp reads it after every change.
export class CachedCheckpointReader extends SqliteSaver {
  private cache = new Map<string, { version: string; tuple: CheckpointTuple | undefined }>();

  async getTuple(config: RunnableConfig) {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    if (checkpoint_id || typeof thread_id !== "string") return super.getTuple(config);
    this.setup();
    const key = `${thread_id}\0${checkpoint_ns}`;
    const version = this.version(thread_id, checkpoint_ns);
    const cached = this.cache.get(key);
    this.cache.delete(key);
    const tuple = cached?.version === version ? cached.tuple : await super.getTuple(config);
    // The most recently read threads, e.g. the Lead's and an open worker run's.
    this.cache.set(key, { version, tuple });
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    return tuple;
  }

  // Changes whenever the thread's checkpoint or its pending writes are saved or replaced.
  private version(threadId: string, namespace: string) {
    const row = this.db
      .prepare(
        `SELECT (SELECT MAX(rowid) FROM checkpoints WHERE thread_id = @thread AND checkpoint_ns = @namespace) AS checkpoint,
          (SELECT MAX(rowid) || ':' || COUNT(*) FROM writes WHERE thread_id = @thread AND checkpoint_ns = @namespace) AS writes`,
      )
      .get({ thread: threadId, namespace }) as { checkpoint: number | null; writes: string | null };
    return `${row.checkpoint}|${row.writes}`;
  }
}
export const readCheckpointer = new CachedCheckpointReader(db);
readCheckpointer.serde = checkpointer.serde;

export const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

// Runs are streamed so the caller can report progress: "values" yields the state
// once the input is applied and again after every step, and "sync" saves each step
// before its chunk is yielded, so a reload at any chunk sees everything so far.
// recursionLimit is optional, and left out (LangGraph's default of 25) unless the
// agent needs more steps than that. It counts the steps of one run: the count is
// read from the saved checkpoint, so every message gets a fresh budget. signal is the
// run's abort signal (see stopRun), which cancels the model and tool calls it has in
// flight.
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
  onError: (error) => `${errorMessage(error)}\nPlease fix your mistakes.`,
});

// A failed model call is tried twice more (after 1s, then 2s) before the run fails:
// OpenRouter's providers now and then answer with an error instead of a reply. A call
// that fails every time fails the run as before, rather than being turned into a reply.
export const modelRetry = modelRetryMiddleware({
  onFailure: "error",
  // A stopped run's aborted call isn't worth trying again; anything else is retried
  // unless LangChain has marked it as not retryable (its default).
  retryOn: (error) => error.name !== "AbortError" && !isModelRateLimit(error) && (getRetryable(error) ?? true),
});

// Tool calls that never got a result, because the run died while they ran (a crash, a
// server restart, a stop), make the model API reject the whole conversation, leaving it
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

export const repairToolCalls = createMiddleware({
  name: "RepairToolCalls",
  wrapModelCall: (request, handler) => handler({ ...request, messages: withMissingToolResults(request.messages) }),
});

// Saves which model wrote each reply in its additional_kwargs.model, like createdAt
// (see messageTimestamps.ts), so a conversation that changes models stays traceable. A
// reply that hands in a document comes back with its messages; each AI one is stamped.
export const modelStamp = (model: string) =>
  createMiddleware({
    name: "ModelStamp",
    wrapModelCall: async (request, handler) => {
      const reply = await handler(request);
      const messages = AIMessage.isInstance(reply) ? [reply] : ((reply as { messages?: BaseMessage[] }).messages ?? []);
      for (const message of messages) if (AIMessage.isInstance(message)) message.additional_kwargs.model ??= model;
      return reply;
    },
  });

// The images (data URLs) attached to a user's message.
export function messageImages(message: BaseMessage): string[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((block) => {
    if (typeof block === "string" || block.type !== "image_url") return [];
    const image = block.image_url;
    return typeof image === "string"
      ? [image]
      : image && typeof image === "object" && "url" in image && typeof image.url === "string"
        ? [image.url]
        : [];
  });
}

// The user's messages, the agent's written replies and its tool calls, each with its
// result, and a marker where each compaction happened, with its summary. A message
// seen twice (e.g. in the checkpoint and its pending writes) shows once. live: the
// conversation is running or waiting on approval, so the last reply's calls without a
// result may still get one. Any other call without a result never ran (e.g. the run
// failed first).
export function toChatEntries(messages: BaseMessage[], live: boolean): ChatEntry[] {
  const results = new Map(messages.filter(ToolMessage.isInstance).map((m) => [m.tool_call_id, m]));
  const lastReply = messages.findLast(AIMessage.isInstance);
  const seen = new Set<string>();
  return messages.flatMap((message, index): ChatEntry[] => {
    // A summary reuses the id of the first message it replaced.
    const id = `${isSummary(message) ? "summary:" : ""}${message.id ?? index}`;
    if (seen.has(id) || ToolMessage.isInstance(message)) return [];
    seen.add(id);
    const createdAt = message.additional_kwargs?.createdAt;
    const entry = (shown: ChatMessage, key = id): ChatEntry => ({
      ...shown,
      id: key,
      ...(typeof createdAt === "string" && { t: createdAt }),
    });
    if (isSummary(message)) return [entry({ role: "compaction", summary: summaryText(message) })];
    if (message.type === "human") {
      const { source, issueId, eventId, eventType, content, username } = message.additional_kwargs;
      if (
        source === "forge" &&
        typeof issueId === "string" &&
        typeof eventId === "string" &&
        typeof eventType === "string" &&
        typeof content === "string"
      ) {
        return [entry({ role: "activity", issueId, eventId, eventType, content })];
      }
      const images = messageImages(message);
      if (!message.text.trim() && !images.length) return [];
      return [
        entry({
          role: "user",
          content: message.text,
          ...(images.length && { images }),
          ...(typeof username === "string" && { username }),
        }),
      ];
    }
    if (!AIMessage.isInstance(message)) return [];
    const calls = (message.tool_calls ?? []).map((call, i) => {
      const result = call.id ? results.get(call.id) : undefined;
      const base = { role: "tool" as const, name: call.name, args: call.args, ...(call.id && { callId: call.id }) };
      const key = `${id}:tool:${call.id ?? i}`;
      if (!result) return entry({ ...base, status: live && message === lastReply ? "pending" : "never_ran" }, key);
      if (result.status === "error") return entry({ ...base, status: "error", error: result.text }, key);
      return entry({ ...base, status: "done", result: result.text }, key);
    });
    return message.text.trim() ? [entry({ role: "assistant", content: message.text }), ...calls] : calls;
  });
}
