import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ForgeResume, ForgeWaiting } from "shared";
import { approvePlan, getForge, forgeRun, resumeForge, startForge, stopForgeProcesses } from "../../backend/src/forge/forge.js";
import { checklistVerdict } from "../../backend/src/forge/plan.js";
import { initDb } from "../../backend/src/db.js";
import { git as workspaceGit, workspacePath } from "../../backend/src/repositories/git.js";
import { Workspace } from "../../backend/src/models/Workspace.js";
import { workspaceDiff } from "../../backend/src/workspaces/workspaceFiles.js";
import { removeSandbox } from "../../backend/src/workspaces/workspaceSandbox.js";
import type { RunMetrics } from "shared";
import { roleMetrics, totals } from "./metrics.js";
import type { Check, Scenario } from "./types.js";
import { isModelRateLimit } from "../../backend/src/providers/modelErrors.js";
import { codeVersion } from "./version.js";
import {
  checkContext,
  cloneLikeZini,
  connection,
  dataDir,
  EVALS,
  fakeLinear,
  followLogs,
  git,
  makeSourceRepo,
  makeWorkspace,
  model,
  required,
  type Fixture,
} from "./workspace.js";

// One eval run, in its own process (see run.ts), with its own data folder (see
// workspace.ts). The run logs are linked into EVAL_RUN_DIR, the results folder, so they
// can be followed live; the results (metrics.json, diff.patch) are written there too.

const scenarioName = required("EVAL_SCENARIO"); // e.g. todo-app/remaining-count
const runDir = resolve(required("EVAL_RUN_DIR"));
const scenarioDir = join(EVALS, "scenarios", scenarioName);
const scenario = JSON.parse(readFileSync(join(scenarioDir, "scenario.json"), "utf8")) as Scenario;
const fixture: Fixture = {
  name: scenarioName,
  dir: scenarioDir,
  title: scenario.title,
  description: scenario.description,
  patch: scenario.patch,
  branchPatches: scenario.branchPatch ? [scenario.branchPatch] : [],
  upstreamPatch: scenario.upstreamPatch,
  preinstalledDependencies: scenario.preinstalledDependencies,
};

// ---- Answering the pauses ---------------------------------------------------------

let questionsAnswered = 0;
let plansApproved = 0;

// Every question gets "You decide.": the Lead makes the calls a user would.
function reply(waiting: ForgeWaiting): ForgeResume {
  questionsAnswered += waiting.questions.length;
  waiting.questions.forEach((question) => console.log(`? lead: ${question}\n  → You decide.`));
  return { answers: waiting.questions.map(() => "You decide.") };
}

// ---- The run ----------------------------------------------------------------------

async function main() {
  const started = Date.now();
  mkdirSync(runDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  // The run logs go straight to the results folder ("junction": no admin rights needed
  // on Windows; ignored elsewhere).
  mkdirSync(join(runDir, "logs"), { recursive: true });
  symlinkSync(join(runDir, "logs"), join(dataDir, "forge-logs"), "junction");

  await initDb();
  cloneLikeZini(makeSourceRepo(fixture));
  const issueId = randomUUID();
  await makeWorkspace(issueId, fixture);
  console.log(`${scenarioName}: ${scenario.title} (model ${model})`);

  let refreshes = 0;
  let advanced = false;
  const reviewed = () => {
    const logs = join(runDir, "logs", issueId);
    return existsSync(logs) && readdirSync(logs).some((file) => file.endsWith("-reviewer.jsonl"));
  };
  const run = forgeRun({ linear: fakeLinear(issueId, fixture), connection, model }, issueId, "Evals", async () => {
    refreshes++;
    const patch =
      refreshes === 2 && scenario.upstreamAfterCoderPatch
        ? scenario.upstreamAfterCoderPatch
        : !advanced && scenario.upstreamAfterReviewPatch && reviewed()
          ? scenario.upstreamAfterReviewPatch
          : null;
    if (patch) {
      advanced = true;
      const source = join(dataDir, "source");
      git(["apply", join(scenarioDir, patch)], source);
      git(["add", "-A"], source);
      git(["commit", "--quiet", "-m", "Upstream advanced during Forge"], source);
    }
    git(["fetch", "--quiet", "--prune", "origin"], join(dataDir, "repo.git"));
  });
  const stopFollowing = followLogs(join(runDir, "logs", issueId));
  let error: string | null = null;
  try {
    for await (const _ of await startForge(run, "")) {
      // Each step's state; the logs show the progress.
    }
    for (let pauses = 0; pauses < 200; pauses++) {
      const { waiting, plan, planApproved } = await getForge(issueId);
      const next = waiting
        ? resumeForge(run, reply(waiting))
        : plan && !planApproved
          ? (plansApproved++, console.log(`✓ plan revision ${plan.revision} approved`), approvePlan(run, plan.revision))
          : null;
      if (!next) break;
      for await (const _ of await next) {
        // As above.
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.log(`✗ ${error}`);
  } finally {
    stopFollowing();
    await stopForgeProcesses(issueId);
  }

  const forge = await getForge(issueId);
  if (!error && !forge.finished) error = forge.waiting ? "Stopped after 200 pauses" : "Stopped before finishing";
  writeFileSync(join(runDir, "validation.json"), JSON.stringify({ plan: forge.plan }, null, 2));

  const { diff, truncated } = await workspaceDiff(issueId);
  writeFileSync(join(runDir, "diff.patch"), truncated ? `${diff}\n[Cut off]\n` : diff);
  const row = await Workspace.findByPk(issueId);
  const initialHead = row!.context!.initialHead;
  const runGit = (args: string[]) => workspaceGit(["-C", workspacePath(issueId), ...args]);
  const finalHead = (await runGit(["rev-parse", "HEAD"])).trim();
  writeFileSync(join(runDir, "zini.diff.patch"), await runGit(["diff", initialHead, "HEAD"]));
  const pendingMerge = await runGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
    .then(() => true)
    .catch(() => false);
  const dirty = (await runGit(["status", "--porcelain"])).trim();
  if (forge.finished && (pendingMerge || dirty)) error = "Completed Forge left uncommitted changes or a pending merge";
  writeFileSync(
    join(runDir, "git.json"),
    JSON.stringify(
      {
        initialHead,
        finalHead,
        commits: await runGit(["log", "--format=%H %s", `${initialHead}..HEAD`]),
        integration: forge.integration,
        upstreamRefreshes: refreshes,
        pendingMerge,
        dirty,
      },
      null,
      2,
    ),
  );

  let check: RunMetrics["check"] = null;
  const checkFile = join(scenarioDir, "check.ts");
  if (existsSync(checkFile) && !isModelRateLimit(error)) {
    console.log("Running the hidden check…");
    const { default: runCheck } = (await import(pathToFileURL(checkFile).href)) as { default: Check };
    check = await runCheck(checkContext(issueId)).catch((err: unknown) => ({
      passed: false,
      details: `The check failed to run: ${String(err)}`,
    }));
    console.log(`${check.passed ? "✓" : "✗"} check: ${check.details}`);
  }

  // A run that failed before any agent started has no logs.
  const logDir = join(runDir, "logs", issueId);
  const roles = existsSync(logDir) ? roleMetrics(logDir) : {};
  const metrics: RunMetrics = {
    scenario: scenarioName,
    model,
    finished: forge.finished,
    qaVerdict: checklistVerdict(forge.plan),
    error,
    rateLimited: isModelRateLimit(error),
    codeVersion: codeVersion(),
    check,
    seconds: (Date.now() - started) / 1000,
    questionsAnswered,
    plansApproved,
    roles,
    totals: totals(roles),
  };
  writeFileSync(join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Done in ${Math.round(metrics.seconds)}s: ${runDir}`);
  await removeSandbox(issueId);
  // The Forge's checkpointer and LangChain keep handles open.
  process.exit(metrics.rateLimited ? 2 : metrics.finished && metrics.qaVerdict === "pass" && check?.passed !== false ? 0 : 1);
}

await main();
