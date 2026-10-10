import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { summarizeRuns, type RunMetrics } from "shared";
import { killTree } from "../backend/src/core/processes.js";
import { codeVersion } from "./harness/version.js";
import { BatchConsole, followConsole } from "../backend/src/evals/batchConsole.js";

// Trusted host runner: each scenario gets a separate process, database, clone,
// workspace container and runtime volume. See evals/README.md.
const EVALS = import.meta.dirname;
const SCENARIOS = join(EVALS, "scenarios");

const args = process.argv.slice(2);
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt === -1 ? 1 : Number(args.splice(repeatAt, 2)[1]);
const runAt = args.indexOf("--run");
const only = runAt === -1 ? null : Number(args.splice(runAt, 2)[1]);
const scenarios = args.includes("all")
  ? readdirSync(SCENARIOS).flatMap((repo) =>
      readdirSync(join(SCENARIOS, repo))
        .filter((name) => existsSync(join(SCENARIOS, repo, name, "scenario.json")))
        .map((name) => `${repo}/${name}`),
    )
  : args;

// Keep model credentials outside repository execution containers.
if (existsSync("/.dockerenv")) {
  console.error(
    "Run the trusted eval harness on the host. Repository commands run in separate workspace sandboxes.",
  );
  process.exit(1);
}
if (scenarios.length === 0 || !Number.isInteger(repeat) || repeat < 1 ||
    (only !== null && (!Number.isInteger(only) || only < 1 || only > repeat))) {
  console.error("Usage: npx tsx evals/run.ts <repo/scenario ...|all> [--repeat N] [--run N]");
  process.exit(1);
}
const credential = process.env.EVAL_PROVIDER === "chatgpt" ? "CHATGPT_TOKEN_FILE" : "OPENROUTER_API_KEY";
for (const name of [credential, "EVAL_MODEL"]) {
  if (!process.env[name]) {
    console.error(`${name} isn't set`);
    process.exit(1);
  }
}
for (const scenario of scenarios) {
  if (!existsSync(join(SCENARIOS, scenario, "scenario.json"))) {
    console.error(`No scenario at evals/scenarios/${scenario}`);
    process.exit(1);
  }
}

const results = resolve(process.env.EVAL_RESULTS ?? join(EVALS, "results"));
const work = resolve(process.env.EVAL_WORK ?? join(tmpdir(), "zini-evals"));
const timeoutMinutes = Number(process.env.EVAL_TIMEOUT_MINUTES) || 60;
const batch = process.env.EVAL_BATCH ?? new Date().toISOString().replace(/[:.]/g, "-");
const version = codeVersion();
let canceled = false;
let active: ChildProcess | null = null;
for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => { canceled = true; if (active) killTree(active); });
async function cleanupRun(dataDir: string, print: (line: string) => void) {
  const folder = join(dataDir, "workspaces"); if (!existsSync(folder)) return;
  const { removeSandbox } = await import("../backend/src/workspaces/workspaceSandbox.js");
  for (const id of readdirSync(folder).filter(id => /^[0-9a-f-]{36}$/.test(id))) await removeSandbox(id, join(dataDir, "zini.sqlite")).catch(error => print(`Sandbox cleanup failed: ${error}`));
}

function runOne(scenario: string, runDir: string, dataDir: string, print: (line: string) => void) {
  return new Promise<number>((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(EVALS, "harness", "run-one.ts")], {
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
      env: {
        ...process.env,
        DB_PATH: join(dataDir, "zini.sqlite"),
        EVAL_SCENARIO: scenario,
        EVAL_RUN_DIR: runDir,
      },
    });
    if (child.stdout) followConsole(child.stdout, print);
    if (child.stderr) followConsole(child.stderr, print);
    active = child;
    const timer = setTimeout(() => {
      print(`✗ Stopped after ${timeoutMinutes} minutes`);
      killTree(child);
    }, timeoutMinutes * 60_000);
    child.on("close", async (code) => {
      clearTimeout(timer);
      active = null;
      await cleanupRun(dataDir, print);
      done(code ?? 1);
    });
    child.on("error", (error) => { clearTimeout(timer); print(error.message); done(1); });
  });
}

let failed = false;
for (const scenario of scenarios) {
  if (canceled) break;
  const batchDir = join(results, scenario, batch);
  // The backend captures its own build/cleanup output too. CLI batches capture here.
  const log = process.env.EVAL_CONSOLE_CAPTURED === "1" ? null : new BatchConsole(join(batchDir, "console.log"));
  const print = (line: string) => { log?.append(line); console.log(line); };
  const saveResult = (ok: boolean, error: string | null) => {
    if (log) writeFileSync(join(batchDir, "console-result.json"), `${JSON.stringify({ ok, error })}\n`);
  };
  print(`Coordinator source version: ${version}`);
  let batchFailed = false;
  for (let n = only ?? 1; n <= (only ?? repeat); n++) {
    if (canceled) break;
    print(`\n=== ${scenario}, run ${n} of ${repeat} ===`);
    const code = await runOne(scenario, join(batchDir, `run-${n}`), join(work, batch, scenario, `run-${n}`), print);
    if (code === 2) {
      print(`MODEL_RATE_LIMIT: stopping the batch before further runs.\n${summarize(batchDir)}`);
      saveResult(false, "Model rate limit reached; remaining runs were not started");
      process.exit(2);
    }
    if (code !== 0) failed = batchFailed = true;
  }
  print(`\n${summarize(batchDir)}`);
  saveResult(!batchFailed && !canceled, canceled ? "Stopped" : batchFailed ? "Some eval runs failed; inspect the run metrics" : null);
}
process.exitCode = canceled ? 130 : failed ? 1 : 0;

// The batch's summary, as the webapp's Results show it (see shared's summarizeRuns).
function summarize(batchDir: string) {
  const runs = readdirSync(batchDir)
    .filter((run) => existsSync(join(batchDir, run, "metrics.json")))
    .map((run) => JSON.parse(readFileSync(join(batchDir, run, "metrics.json"), "utf8")) as RunMetrics);
  const rows = summarizeRuns(runs).map((row) => `  ${row.label.padEnd(22)} ${row.value.padStart(14)}`);
  const errors = runs.filter((run) => run.error).map((run) => `  error: ${run.error}`);
  return [`${batchDir} (${runs.length} runs)`, ...rows, ...errors].join("\n");
}
