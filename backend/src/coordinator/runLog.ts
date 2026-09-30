import { appendFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { LogRole, RunLogEntry, RunLogEvent, RunLogSummary } from "shared";
import { storage } from "../db.js";
import { sendEvent } from "../events.js";

// A log of each subagent run, for debugging: what it was given, every model call and
// tool call, and how it ended (see RunLogEntry). One JSON Lines file per run, written
// as the run goes, so it can be watched live (Get-Content -Wait, tail -f, or the
// webapp: each line sends a coordinator.log event) and a run that fails still leaves
// everything up to the failure:
//   data/coordinator-logs/<issueId>/<runId>.jsonl
// where the run id is when it started and its role, e.g. 2026-09-27T07-26-59-397Z-planner.

const LOG_DIR = resolve(dirname(storage), "coordinator-logs");

// A run id, split into the time it started (its ISO string, with : and . as -) and
// its role. Checked before an id is used in a file path.
const RUN_ID = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)-(planner|coder|reviewer|committer)$/;

const runLogPath = (issueId: string, runId: string) => join(LOG_DIR, issueId, `${runId}.jsonl`);

export type RunLog = { write: (entry: RunLogEntry) => Promise<void> };

export async function openRunLog(issueId: string, role: LogRole): Promise<RunLog> {
  await mkdir(join(LOG_DIR, issueId), { recursive: true });
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${role}`;
  const file = runLogPath(issueId, runId);
  // Appends one at a time, so lines stay in order when tools run in parallel.
  let queue = Promise.resolve();
  return {
    write(entry) {
      const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
      queue = queue
        .then(() => appendFile(file, `${line}\n`))
        .then(() => sendEvent({ type: "coordinator.log", issueId, runId }))
        .catch((err) => {
          console.error(`Writing the run log ${file} failed:`, err);
        });
      return queue;
    },
  };
}

// The run's log, or null if there's no such run. A line still being written is left
// out; the next read has it.
export async function readRunLog(issueId: string, runId: string): Promise<RunLogEvent[] | null> {
  if (!RUN_ID.test(runId)) return null;
  let text: string;
  try {
    text = await readFile(runLogPath(issueId, runId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return text.split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as RunLogEvent] : [];
    } catch {
      return [];
    }
  });
}

// The issue's runs, oldest first. Each run's outcome comes from its last entry.
export async function listRunLogs(issueId: string): Promise<RunLogSummary[]> {
  let files: string[];
  try {
    files = await readdir(join(LOG_DIR, issueId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const runs = await Promise.all(
    files.map(async (file): Promise<RunLogSummary | null> => {
      const id = file.replace(/\.jsonl$/, "");
      const match = RUN_ID.exec(id);
      if (!match) return null;
      const [, dayAndHour, minute, second, ms, role] = match;
      const last = (await readRunLog(issueId, id))?.at(-1);
      return {
        id,
        role: role as LogRole,
        startedAt: `${dayAndHour}:${minute}:${second}.${ms}`,
        outcome: last?.event === "end" ? last.outcome : null,
      };
    }),
  );
  return runs
    .filter((run) => run !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// Deletes the issue's run logs, e.g. with its workspace.
export async function deleteRunLogs(issueId: string) {
  await rm(join(LOG_DIR, issueId), { recursive: true, force: true });
}

// The model's reply, from what a model call gives back: the message itself, or, when
// the reply called the doc tool with a valid document, the document with the
// messages that end the run (the reply first).
function replyMessage(reply: unknown) {
  if (AIMessage.isInstance(reply)) return reply;
  const [first] = (reply as { messages?: BaseMessage[] }).messages ?? [];
  return AIMessage.isInstance(first) ? first : null;
}

// Logs each model call and tool call as it starts and when it ends. Goes first in the
// middleware list, so it's outermost: a tool that fails shows as the error result
// toolErrors gives the model.
export function logTo(log: RunLog) {
  // The calls a tool ran, to tell their results from an invalid document's error.
  const toolCallIds = new Set<string>();
  return createMiddleware({
    name: "RunLog",
    wrapModelCall: async (request, handler) => {
      // A doc tool call that didn't fit its schema gets its error back after this
      // middleware, as the next call's last message: the one tool result no tool ran.
      const last = request.messages.at(-1);
      if (ToolMessage.isInstance(last) && !toolCallIds.has(last.tool_call_id)) {
        await log.write({ event: "doc_invalid", error: last.text });
      }
      await log.write({ event: "model_call" });
      try {
        const reply = await handler(request);
        const message = replyMessage(reply);
        if (message) {
          await log.write({
            event: "model_reply",
            text: message.text,
            toolCalls: message.tool_calls?.map(({ name, args }) => ({ name, args })),
            finishReason: message.response_metadata?.finish_reason as string | undefined,
            usage: message.usage_metadata,
          });
        }
        return reply;
      } catch (err) {
        await log.write({ event: "model_error", error: String(err) });
        throw err;
      }
    },
    wrapToolCall: async (request, handler) => {
      // The id pairs a result with its call when tools run in parallel.
      const { id, name, args } = request.toolCall;
      if (id) toolCallIds.add(id);
      await log.write({ event: "tool_call", id, name, args });
      const result = await handler(request);
      if (ToolMessage.isInstance(result)) {
        await log.write({ event: "tool_result", id, name, status: result.status, result: result.text });
      }
      return result;
    },
  });
}
