import type { ChildProcess } from "node:child_process";
import { workspacePath } from "../git.js";
import { killTree, spawnShell } from "../processes.js";

// The QA's commands, run in the issue's workspace: ones it waits for (run_command), and
// long-running ones it starts and checks on (start_process, e.g. a dev server). Every
// one is stopped when the QA's run ends (stopAllProcesses), but not while it's paused
// for approval: a dev server it started is still up when it carries on.

// What a model is given of a command's output, at most: its end, where errors show.
const MAX_OUTPUT_FOR_MODEL = 8_000;
// What's kept of a long-running process's output, at most.
const MAX_BUFFER = 200_000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1_800;

// For the QA's commands only: CI makes tools run once rather than watch (e.g. test
// runners), and plain output reads better than color codes.
const QA_ENV = { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };

// Color and cursor codes some tools print anyway.
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

// The end of text, with a note when its start is left out.
function tail(text: string) {
  if (text.length <= MAX_OUTPUT_FOR_MODEL) return text;
  const left = text.length - MAX_OUTPUT_FOR_MODEL;
  return `[${left} earlier characters left out]\n${text.slice(-MAX_OUTPUT_FOR_MODEL)}`;
}

function exitText(code: number | null, signal: NodeJS.Signals | null) {
  return code === null ? `stopped (${signal ?? "killed"})` : `exited with code ${code}`;
}

type Process = {
  command: string;
  child: ChildProcess;
  // The output kept, which starts at offset `start` of everything it printed; `read`
  // is how far read_output has given it.
  output: string;
  start: number;
  read: number;
  status: string | null;
};

// Each issue's processes, by id ("p1", "p2", ...), and the commands running now.
const processes = new Map<string, Map<string, Process>>();
const commands = new Map<string, Set<ChildProcess>>();
let nextId = 1;

const spawnInWorkspace = (issueId: string, command: string) =>
  spawnShell(command, workspacePath(issueId), QA_ENV);

// Runs command to completion (or until it times out), and gives its exit code and the
// end of its output.
export function runCommand(issueId: string, command: string, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
  const seconds = Math.min(Math.max(timeoutSeconds, 1), MAX_TIMEOUT_SECONDS);
  const child = spawnInWorkspace(issueId, command);
  const running = commands.get(issueId) ?? new Set();
  commands.set(issueId, running.add(child));

  let output = "";
  const append = (chunk: Buffer) => {
    // Kept a little past what's shown, so the note says how much was left out.
    output = (output + stripAnsi(chunk.toString())).slice(-MAX_BUFFER);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  return new Promise<string>((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, seconds * 1000);
    // "error" (it couldn't start) and "close" can both fire; only the first counts.
    let done = false;
    const finish = (status: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      running.delete(child);
      resolve(`${status}\n\n${tail(output.trim()) || "(no output)"}`);
    };
    child.on("error", (err) => finish(`Couldn't run it: ${err.message}`));
    child.on("close", (code, signal) =>
      finish(timedOut ? `Timed out after ${seconds}s, and was stopped` : exitText(code, signal)),
    );
  });
}

// Starts command and leaves it running; its output is read with readOutput.
export function startProcess(issueId: string, command: string) {
  const id = `p${nextId++}`;
  const child = spawnInWorkspace(issueId, command);
  const proc: Process = { command, child, output: "", start: 0, read: 0, status: null };
  const append = (chunk: Buffer) => {
    proc.output += stripAnsi(chunk.toString());
    if (proc.output.length > MAX_BUFFER) {
      proc.start += proc.output.length - MAX_BUFFER;
      proc.output = proc.output.slice(-MAX_BUFFER);
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (err) => (proc.status ??= `couldn't start: ${err.message}`));
  child.on("close", (code, signal) => (proc.status ??= exitText(code, signal)));

  const issueProcesses = processes.get(issueId) ?? new Map();
  processes.set(issueId, issueProcesses.set(id, proc));
  return id;
}

function getProcess(issueId: string, id: string) {
  const proc = processes.get(issueId)?.get(id);
  if (!proc) throw new Error(`No process ${id}. Start one with start_process.`);
  return proc;
}

// What the process printed since the last read, and whether it's still running.
export function readOutput(issueId: string, id: string) {
  const proc = getProcess(issueId, id);
  const end = proc.start + proc.output.length;
  const from = Math.max(proc.read, proc.start);
  const skipped = from - proc.read;
  proc.read = end;
  const text = proc.output.slice(from - proc.start);
  return [
    `${id} (${proc.command}): ${proc.status ?? "running"}`,
    skipped > 0 ? `[${skipped} characters weren't kept]` : "",
    tail(text.trim()) || "(no new output)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function stopProcess(issueId: string, id: string) {
  const proc = getProcess(issueId, id);
  killTree(proc.child);
  processes.get(issueId)?.delete(id);
  return `Stopped ${id} (${proc.command})`;
}

// Stops everything the QA started in the issue's workspace.
export function stopAllProcesses(issueId: string) {
  for (const proc of processes.get(issueId)?.values() ?? []) killTree(proc.child);
  for (const child of commands.get(issueId) ?? []) killTree(child);
  processes.delete(issueId);
  commands.delete(issueId);
}
