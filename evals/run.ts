import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { summarizeRuns, type RunMetrics } from "shared";
import { killTree } from "../backend/src/processes.js";
import { codeVersion } from "./harness/version.js";

// Runs scenarios through the coordinator, each --repeat times, every run in its own
// process with its own data folder (see harness/run-one.ts), then summarises each
// scenario's batch. The eval container's entry point (see Dockerfile), started by zini's
// backend from the webapp's Evals page (see backend/src/evals.ts); the container is the
// only place the QA's commands are approved.
//   run.ts <repo/scenario ...|all> [--repeat N]
// Needs OPENROUTER_API_KEY and EVAL_MODEL. EVAL_RESULTS (default evals/results) is where
// results go, EVAL_WORK (default the system's temp folder) where runs work, and
// EVAL_TIMEOUT_MINUTES (default 60) how long a run may take.

const EVALS = import.meta.dirname;
const SCENARIOS = join(EVALS, "scenarios");

const args = process.argv.slice(2);
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt === -1 ? 1 : Number(args.splice(repeatAt, 2)[1]);
const scenarios = args.includes("all")
  ? readdirSync(SCENARIOS).flatMap((repo) =>
      readdirSync(join(SCENARIOS, repo))
        .filter((name) => existsSync(join(SCENARIOS, repo, name, "scenario.json")))
        .map((name) => `${repo}/${name}`),
    )
  : args;

// The runs check this too (see harness/run-one.ts); here it stops before any start.
if (!existsSync("/.dockerenv")) {
  console.error(
    "Evals only run in the eval container, where the QA's commands can't reach this machine. See evals/README.md.",
  );
  process.exit(1);
}
if (scenarios.length === 0 || !Number.isInteger(repeat) || repeat < 1) {
  console.error("Usage: npx tsx evals/run.ts <repo/scenario ...|all> [--repeat N]");
  process.exit(1);
}
for (const name of ["OPENROUTER_API_KEY", "EVAL_MODEL"]) {
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
const batch = new Date().toISOString().replace(/[:.]/g, "-");
console.log(`Coordinator source version: ${codeVersion()}`);

function runOne(scenario: string, runDir: string, dataDir: string) {
  return new Promise<number>((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(EVALS, "harness", "run-one.ts")], {
      stdio: "inherit",
      env: {
        ...process.env,
        DB_PATH: join(dataDir, "zini.sqlite"),
        EVAL_SCENARIO: scenario,
        EVAL_RUN_DIR: runDir,
      },
    });
    const timer = setTimeout(() => {
      console.log(`✗ Stopped after ${timeoutMinutes} minutes`);
      killTree(child);
    }, timeoutMinutes * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
    child.on("error", (error) => { clearTimeout(timer); console.error(error.message); done(1); });
  });
}

let failed = false;
for (const scenario of scenarios) {
  const batchDir = join(results, scenario, batch);
  for (let n = 1; n <= repeat; n++) {
    console.log(`\n=== ${scenario}, run ${n} of ${repeat} ===`);
    const code = await runOne(scenario, join(batchDir, `run-${n}`), join(work, batch, scenario, `run-${n}`));
    if (code === 2) {
      console.log(`MODEL_RATE_LIMIT: stopping the batch before further runs.\n${summarize(batchDir)}`);
      process.exit(2);
    }
    if (code !== 0) failed = true;
  }
  console.log(`\n${summarize(batchDir)}`);
}
process.exitCode = failed ? 1 : 0;

// The batch's summary, as the webapp's Results show it (see shared's summarizeRuns).
function summarize(batchDir: string) {
  const runs = readdirSync(batchDir)
    .filter((run) => existsSync(join(batchDir, run, "metrics.json")))
    .map((run) => JSON.parse(readFileSync(join(batchDir, run, "metrics.json"), "utf8")) as RunMetrics);
  const rows = summarizeRuns(runs).map((row) => `  ${row.label.padEnd(22)} ${row.value.padStart(14)}`);
  const errors = runs.filter((run) => run.error).map((run) => `  error: ${run.error}`);
  return [`${batchDir} (${runs.length} runs)`, ...rows, ...errors].join("\n");
}
