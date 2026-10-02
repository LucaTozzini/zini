import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, createAgent } from "langchain";
import type { RunLogEntry } from "shared";
import { modelRetry, toolErrors } from "./agents.js";
import { codeTools, fetchRepoMiddleware } from "./codeTools.js";
import { logTo } from "./coordinator/runLog.js";
import { storage } from "./db.js";
import { npmTools } from "./npmTools.js";

const SYSTEM_PROMPT = `You answer another agent's question about a product's code, or about npm
packages, by exploring its GitHub repository's default branch with list_files, read_file
and search_code, and packages as published on npm with the npm_ tools.

- Look until you can answer from the code itself, not from names or guesses.
- Back each claim with path:line references.
- Quote only the lines that matter, never whole files.
- If something isn't in the code, say so plainly, and say where you looked.
- The repo's files don't include its dependencies. Read a dependency with the npm_ tools
  at the version in the repo's package.json or lockfile; any other package at the version
  asked about, or its latest.
- Keep the answer short and to the point: another agent reads it, not a person.`;

// Plenty for a search and a good number of reads, while a question that can't be
// answered still ends.
const RECURSION_LIMIT = 100;

// A log of each explorer run, for debugging, in the coordinator's run log format (see
// runLog.ts): the question, every model call and tool call, and the answer. One JSON
// Lines file per run, written as the run goes, so it can be watched live:
//   data/explorer-logs/<when it started>.jsonl
// The start line names the caller's thread (a PM chat's id, or coordinator:<issueId>),
// to find a caller's runs by.
const LOG_DIR = resolve(dirname(storage), "explorer-logs");

// The coordinator's entries (which logTo writes), with the explorer's own start and
// end.
type ExplorerLogEntry =
  | RunLogEntry
  | { event: "start"; question: string; model?: string; caller?: string }
  | { event: "end"; outcome: "done"; answer: string };

async function openExplorerLog() {
  await mkdir(LOG_DIR, { recursive: true });
  const file = join(LOG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  // Appends one at a time, so lines stay in order when tools run in parallel.
  let queue = Promise.resolve();
  return {
    write(entry: ExplorerLogEntry) {
      const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
      queue = queue
        .then(() => appendFile(file, `${line}\n`))
        .catch((err) => {
          console.error(`Writing the explorer log ${file} failed:`, err);
        });
      return queue;
    },
  };
}

// Answers a question about the code with a subagent of its own, so the files it reads
// stay out of the asker's conversation: only the answer goes back. It starts fresh
// every time and saves nothing but its log. signal stops it, e.g. with the asker's run;
// caller is the asker's thread id, for the log.
export async function exploreCode(
  model: BaseChatModel,
  question: string,
  { signal, caller }: { signal?: AbortSignal; caller?: string } = {},
) {
  const log = await openExplorerLog();
  await log.write({
    event: "start",
    question,
    model: (model as { model?: string }).model,
    caller,
  });
  const agent = createAgent({
    model,
    tools: [...codeTools, ...npmTools],
    systemPrompt: SYSTEM_PROMPT,
    // logTo outermost, so a tool that fails shows as the error toolErrors gives the
    // model; toolErrors outside fetchRepoMiddleware, so it covers its tools too.
    middleware: [logTo(log), toolErrors, modelRetry, fetchRepoMiddleware],
    // Run from a tool, it would otherwise save into the asker's checkpoints.
    checkpointer: false,
  });
  try {
    const { messages } = await agent.invoke(
      { messages: [{ role: "user", content: question }] },
      { recursionLimit: RECURSION_LIMIT, ...(signal ? { signal } : {}) },
    );
    const answer = messages.findLast(AIMessage.isInstance)?.text;
    if (!answer) throw new Error("The code explorer finished without an answer");
    await log.write({ event: "end", outcome: "done", answer });
    return answer;
  } catch (err) {
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}
