import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EvalBatch, EvalKind, EvalScenario, EvalStatus, RunMetrics } from "shared";
import { sendEvent } from "../core/events.js";
import { loadConnection, type ModelConnection } from "../providers/modelProvider.js";
import { getSetting } from "../core/settings.js";
import { createEvalCredentials } from "./evalCredentials.js";
import { killTree } from "../core/processes.js";
import { BatchConsole, followConsole, readConsoleTail } from "./batchConsole.js";

// zini's evals (see evals/README.md, at the repo's root): runs of the forge on test
// issues with a trusted host harness and an isolated workspace container per run.

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const EVALS = join(ROOT, "evals");
const RESULTS = join(EVALS, "results");
// Scenarios' results are in results/, agent tests' in results/agents/.
const results = (kind: EvalKind) => (kind === "agents" ? join(RESULTS, "agents") : RESULTS);
const definition = (kind: EvalKind) => (kind === "agents" ? "agent.json" : "scenario.json");
export const isEvalKind = (value: unknown): value is EvalKind => value === "scenarios" || value === "agents";

// A folder name from a URL, before it's used in a path: no "..", no separators.
const NAME = /^[\w.-]+$/;
const isName = (value: string) => NAME.test(value) && value !== "." && value !== "..";

const subfolders = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

// Every scenario (or agent test), by repo.
export function listScenarios(kind: EvalKind = "scenarios"): EvalScenario[] {
  const folder = join(EVALS, kind);
  return subfolders(folder).flatMap((repo) =>
    subfolders(join(folder, repo))
      .filter((name) => existsSync(join(folder, repo, name, definition(kind))))
      .map((name) => {
        const { title } = JSON.parse(readFileSync(join(folder, repo, name, definition(kind)), "utf8")) as {
          title: string;
        };
        return { id: `${repo}/${name}`, repo, name, title };
      }),
  );
}

// Every batch of runs of a kind, newest first (batch ids are when they started).
export function listBatches(kind: EvalKind = "scenarios"): EvalBatch[] {
  const folder = results(kind);
  return listScenarios(kind)
    .flatMap(({ id: scenario }) =>
      subfolders(join(folder, scenario)).map((batch) => ({
        scenario,
        id: batch,
        hasLog: existsSync(join(folder, scenario, batch, "console.log")),
        runs: subfolders(join(folder, scenario, batch)).map((run) => {
          const file = join(folder, scenario, batch, run, "metrics.json");
          return { id: run, metrics: existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunMetrics) : null };
        }),
      })),
    )
    .sort((a, b) => b.id.localeCompare(a.id));
}

// What a run changed in its repo, or null if there's no such run (or no diff yet).
export function runDiff(kind: EvalKind, repo: string, name: string, batch: string, run: string) {
  if (![repo, name, batch, run].every(isName)) return null;
  const file = join(results(kind), repo, name, batch, run, "diff.patch");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function batchLogFile(kind: EvalKind, repo: string, name: string, batch: string) {
  if (![repo, name, batch].every(isName)) return null;
  const file = join(results(kind), repo, name, batch, "console.log");
  return existsSync(file) ? file : null;
}

// ---- Running ----------------------------------------------------------------------

// The forge's provider and model (EVAL_MODEL overrides it), or what's missing.
export async function evalSettings() {
  const [provider, model] = await Promise.all([getSetting("forgeProvider"), getSetting("forgeModel")]);
  const connection = await loadConnection(provider);
  if (typeof connection === "string") return connection;
  const evalModel = process.env.EVAL_MODEL ?? model;
  if (!evalModel) return "No Forge model set";
  return { connection, model: evalModel };
}

export async function dockerRunning() {
  return promisify(execFile)("docker", ["info"], { timeout: 15_000 }).then(
    () => true,
    () => false,
  );
}

// Builds the common workspace image, then runs a trusted host harness. Credentials
// go only to that harness; sandbox commands receive their own minimal environment.
export function runInDocker(kind: EvalKind, scenario: string, repeat: number, { connection, model }: { connection: ModelConnection; model: string },
  onLine: (line: string) => void, batch = new Date().toISOString().replace(/[:.]/g, "-")) {
  let child: ChildProcess | null = null;
  let stopped = false;
  let credentials: Awaited<ReturnType<typeof createEvalCredentials>> | null = null;
  const work = join(EVALS, ".work", batch);
  const execute = async () => {
    const { buildSandboxImage } = await import("../workspaces/workspaceSandbox.js");
    onLine("Building the workspace sandbox image…");
    await buildSandboxImage();
    if (stopped) return { ok: false, error: "Stopped" };
    if (connection.provider === "chatgpt") credentials = await createEvalCredentials(connection.token, () => stop());
    mkdirSync(RESULTS, { recursive: true });
    const credential: Record<string, string> = connection.provider === "chatgpt"
      ? { EVAL_PROVIDER: "chatgpt", CHATGPT_TOKEN_FILE: join(credentials!.directory, "access-token") }
      : { EVAL_PROVIDER: "openrouter", OPENROUTER_API_KEY: connection.key };
    const code = await new Promise<number | null>(done => {
      child = spawn(process.execPath, ["--import", "tsx", join(EVALS, "run.ts"), ...(kind === "agents" ? ["--agents"] : []), scenario, "--repeat", String(repeat)], {
        cwd: ROOT, windowsHide: true, detached: process.platform !== "win32",
        env: { ...process.env, ...credential, EVAL_MODEL: model, EVAL_BATCH: batch, EVAL_WORK: work, EVAL_RESULTS: RESULTS, EVAL_CONSOLE_CAPTURED: "1" },
      });
      if (child.stdout) followConsole(child.stdout, onLine);
      if (child.stderr) followConsole(child.stderr, onLine);
      child.on("error", error => { onLine(String(error)); done(null); });
      child.on("close", done);
    });
    return { ok: code === 0 && !stopped, error: stopped ? "Stopped" : code === 2 ? "Model rate limit reached; remaining runs were not started" : code === 0 ? null : "Some eval runs failed; inspect the run metrics" };
  };
  const stop = () => { stopped = true; if (child) killTree(child); };
  const done = execute().catch(error => ({ ok: false, error: String(error) })).finally(async () => {
    await credentials?.close();
    // Also clean containers after timeout or interruption of the trusted harness.
    const { removeSandbox } = await import("../workspaces/workspaceSandbox.js");
    function ids(folder: string): { id: string; storage: string }[] {
      if (!existsSync(folder)) return [];
      return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? entry.name === "workspaces" ? readdirSync(join(folder, entry.name)).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => ({ id, storage: join(folder, "zini.sqlite") })) : ids(join(folder, entry.name)) : []);
    }
    for (const { id, storage } of ids(work)) await removeSandbox(id, storage).catch(error => onLine(`Eval sandbox cleanup failed: ${error}`));
  });
  return { done, stop };
}
// ---- The webapp's eval: one at a time ------------------------------------------------

let running: (EvalStatus["running"] & { stop: () => void }) | null = null;
let output: string[] = [];
let ended: EvalStatus["ended"] = null;
let restoredOutput = false;

// One event per half second at most, while output pours in.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notify() {
  notifyTimer ??= setTimeout(() => {
    notifyTimer = null;
    sendEvent({ type: "eval.updated" });
  }, 500);
}

export function evalStatus(): EvalStatus {
  if (!restoredOutput) {
    restoredOutput = true;
    const latest = (["scenarios", "agents"] as const)
      .flatMap((kind) => listBatches(kind).filter((batch) => batch.hasLog).map((batch) => ({ ...batch, folder: join(results(kind), batch.scenario, batch.id) })))
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    if (latest) {
      const folder = latest.folder;
      output = readConsoleTail(join(folder, "console.log"));
      const result = join(folder, "console-result.json");
      if (existsSync(result)) ended = JSON.parse(readFileSync(result, "utf8")) as EvalStatus["ended"];
    }
  }
  return { running: running && { kind: running.kind, scenario: running.scenario, repeat: running.repeat, startedAt: running.startedAt }, output, ended };
}

// Starts repeat runs of a scenario or agent test; answers once it's started, or with why
// it can't.
export async function startEval(kind: EvalKind, scenario: string, repeat: number): Promise<string | null> {
  if (running) return "An eval is already running";
  if (!listScenarios(kind).some((s) => s.id === scenario)) return kind === "agents" ? "No such agent test" : "No such scenario";
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) return "Runs must be between 1 and 10";
  const settings = await evalSettings();
  if (typeof settings === "string") return settings;
  if (!(await dockerRunning())) return "Docker isn't running";
  if (running) return "An eval is already running";

  const batch = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = join(results(kind), scenario, batch);
  const log = new BatchConsole(join(folder, "console.log"));
  restoredOutput = true;
  output = log.tail;
  ended = null;
  const { done, stop } = runInDocker(kind, scenario, repeat, settings, (line) => {
    log.append(line);
    notify();
  }, batch);
  running = { kind, scenario, repeat, startedAt: new Date().toISOString(), stop };
  notify();
  void done.then((result) => {
    if (result.error) log.append(result.error);
    writeFileSync(join(folder, "console-result.json"), `${JSON.stringify(result)}\n`);
    ended = result;
    running = null;
    notify();
  });
  return null;
}

// Stops the eval going on; false if there isn't one.
export function stopEval() {
  if (!running) return false;
  running.stop();
  return true;
}
