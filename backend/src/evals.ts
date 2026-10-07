import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EvalBatch, EvalScenario, EvalStatus, RunMetrics } from "shared";
import { sendEvent } from "./events.js";
import { loadConnection, type ModelConnection } from "./modelProvider.js";
import { getSetting } from "./settings.js";
import { createEvalCredentials } from "./evalCredentials.js";

// zini's evals (see evals/README.md, at the repo's root): runs of the coordinator on test
// issues in a Docker container, started from the webapp's Evals page. This lists the
// scenarios and their results, and runs them in Docker.

const ROOT = resolve(import.meta.dirname, "..", "..");
const EVALS = join(ROOT, "evals");
const SCENARIOS = join(EVALS, "scenarios");
const RESULTS = join(EVALS, "results");
const IMAGE = "zini-evals";

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

// Every scenario, by repo.
export function listScenarios(): EvalScenario[] {
  return subfolders(SCENARIOS).flatMap((repo) =>
    subfolders(join(SCENARIOS, repo))
      .filter((name) => existsSync(join(SCENARIOS, repo, name, "scenario.json")))
      .map((name) => {
        const { title } = JSON.parse(readFileSync(join(SCENARIOS, repo, name, "scenario.json"), "utf8")) as {
          title: string;
        };
        return { id: `${repo}/${name}`, repo, name, title };
      }),
  );
}

// Every batch of runs in evals/results, newest first (batch ids are when they started).
export function listBatches(): EvalBatch[] {
  return listScenarios()
    .flatMap(({ id: scenario }) =>
      subfolders(join(RESULTS, scenario)).map((batch) => ({
        scenario,
        id: batch,
        runs: subfolders(join(RESULTS, scenario, batch)).map((run) => {
          const file = join(RESULTS, scenario, batch, run, "metrics.json");
          return { id: run, metrics: existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunMetrics) : null };
        }),
      })),
    )
    .sort((a, b) => b.id.localeCompare(a.id));
}

// What a run changed in its repo, or null if there's no such run (or no diff yet).
export function runDiff(repo: string, name: string, batch: string, run: string) {
  if (![repo, name, batch, run].every(isName)) return null;
  const file = join(RESULTS, repo, name, batch, run, "diff.patch");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

// ---- Running ----------------------------------------------------------------------

// The coordinator's provider and model (EVAL_MODEL overrides it), or what's missing.
export async function evalSettings() {
  const [provider, model] = await Promise.all([getSetting("coordinatorProvider"), getSetting("coordinatorModel")]);
  const connection = await loadConnection(provider);
  if (typeof connection === "string") return connection;
  const evalModel = process.env.EVAL_MODEL ?? model;
  if (!evalModel) return "No coordinator model set";
  return { connection, model: evalModel };
}

export async function dockerRunning() {
  return promisify(execFile)("docker", ["info"], { timeout: 15_000 }).then(
    () => true,
    () => false,
  );
}

// Builds the eval image, then runs each of a scenario's repeat runs in its own container
// (evals/run.ts --run N), all in one batch, its results going to evals/results. Each line
// of output goes to onLine. ChatGPT tokens stay current in a temporary read-only mount;
// only this server refreshes them. OpenRouter keys go in the container's environment.
export function runInDocker(scenario: string, repeat: number, { connection, model }: { connection: ModelConnection; model: string },
  onLine: (line: string) => void) {
  const container = `zini-eval-${Date.now()}`;
  let child: ChildProcess | null = null;
  let stopped = false;
  let credentials: Awaited<ReturnType<typeof createEvalCredentials>> | null = null;
  let credentialError: string | null = null;

  const run = (command: string[], env: NodeJS.ProcessEnv = process.env) =>
    new Promise<number | null>((done) => {
      child = spawn("docker", command, { cwd: ROOT, env, windowsHide: true });
      let partial = "";
      const read = (chunk: Buffer) => {
        const lines = (partial + chunk.toString()).split(/\r?\n/);
        partial = lines.pop() ?? "";
        lines.forEach(onLine);
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.on("error", (err) => {
        onLine(`Couldn't run docker: ${err.message}`);
        done(null);
      });
      child.on("close", (code) => {
        if (partial) onLine(partial);
        done(code);
      });
    });

  const execute = async () => {
    onLine("Building the eval image…");
    if ((await run(["build", "--quiet", "-f", "evals/Dockerfile", "-t", IMAGE, "."])) !== 0) {
      return { ok: false, error: stopped ? "Stopped" : "Building the eval image failed" };
    }
    if (stopped) return { ok: false, error: "Stopped" };
    if (connection.provider === "chatgpt") {
      credentials = await createEvalCredentials(connection.token, (error) => {
        credentialError = error instanceof Error ? error.message : String(error);
        stop();
      });
    }
    mkdirSync(RESULTS, { recursive: true });
    const batch = new Date().toISOString().replace(/[:.]/g, "-");
    let failed = false;
    for (let n = 1; n <= repeat; n++) {
      if (stopped) return { ok: false, error: credentialError ?? "Stopped" };
      const credential: Record<string, string> = connection.provider === "chatgpt"
        ? { EVAL_PROVIDER: "chatgpt", CHATGPT_TOKEN_FILE: "/run/zini-auth/access-token" }
        : { EVAL_PROVIDER: "openrouter", OPENROUTER_API_KEY: connection.key };
      const code = await run(
        ["run", "--rm", "--name", `${container}-${n}`, ...Object.keys(credential).flatMap((name) => ["-e", name]),
          "-e", "EVAL_MODEL", "-e", "EVAL_BATCH", "-e", "EVAL_TIMEOUT_MINUTES",
          ...(credentials ? ["-v", `${credentials.directory}:/run/zini-auth:ro`] : []),
          "-v", `${RESULTS}:/results`, IMAGE, scenario, "--repeat", String(repeat), "--run", String(n)],
        { ...process.env, ...credential, EVAL_MODEL: model, EVAL_BATCH: batch },
      );
      if (stopped) return { ok: false, error: credentialError ?? "Stopped" };
      if (code === 2) return { ok: false, error: "Model rate limit reached; remaining eval runs were not started" };
      if (code !== 0) failed = true;
    }
    return failed ? { ok: false, error: "Some eval runs failed; inspect the run metrics" } : { ok: true, error: null };
  };

  const stop = () => {
    stopped = true;
    // Stopping the container ends its run; a build still going is killed.
    for (let n = 1; n <= repeat; n++) spawn("docker", ["stop", `${container}-${n}`], { windowsHide: true }).on("error", () => {});
    (child as ChildProcess | null)?.kill();
  };
  const done = execute()
    .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    .finally(async () => { await credentials?.close(); });
  return { done, stop };
}

// ---- The webapp's eval: one at a time ------------------------------------------------

// The most output kept: its end.
const MAX_OUTPUT_LINES = 5_000;

let running: (EvalStatus["running"] & { stop: () => void }) | null = null;
let output: string[] = [];
let ended: EvalStatus["ended"] = null;

// One event per half second at most, while output pours in.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notify() {
  notifyTimer ??= setTimeout(() => {
    notifyTimer = null;
    sendEvent({ type: "eval.updated" });
  }, 500);
}

export function evalStatus(): EvalStatus {
  return { running: running && { scenario: running.scenario, repeat: running.repeat, startedAt: running.startedAt }, output, ended };
}

// Starts repeat runs of scenario; answers once it's started, or with why it can't.
export async function startEval(scenario: string, repeat: number): Promise<string | null> {
  if (running) return "An eval is already running";
  if (!listScenarios().some((s) => s.id === scenario)) return "No such scenario";
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) return "Runs must be between 1 and 10";
  const settings = await evalSettings();
  if (typeof settings === "string") return settings;
  if (!(await dockerRunning())) return "Docker isn't running";
  if (running) return "An eval is already running";

  output = [];
  ended = null;
  const { done, stop } = runInDocker(scenario, repeat, settings, (line) => {
    output.push(line);
    if (output.length > MAX_OUTPUT_LINES) output = output.slice(-MAX_OUTPUT_LINES);
    notify();
  });
  running = { scenario, repeat, startedAt: new Date().toISOString(), stop };
  notify();
  void done.then((result) => {
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
