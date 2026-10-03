import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LinearClient } from "@linear/sdk";
import type { PipelineResume, PipelineWaiting } from "shared";
import {
  getPipeline,
  pipelineRun,
  resumePipeline,
  startPipeline,
  stopQa,
} from "../../backend/src/coordinator.js";
import { initDb, storage } from "../../backend/src/db.js";
import { addWorktree, workspacePath } from "../../backend/src/git.js";
import { Workspace } from "../../backend/src/models/Workspace.js";
import { saveSettings } from "../../backend/src/settings.js";
import { workspaceDiff } from "../../backend/src/workspaceFiles.js";
import { startApp } from "./app.js";
import type { RunMetrics } from "shared";
import { roleMetrics, totals } from "./metrics.js";
import type { Check, Scenario } from "./types.js";

// One eval run, in its own process (see run.ts): DB_PATH puts all of zini's data (its
// database, the repo's clone, the workspace, the run logs) in a fresh folder. The run
// logs are linked into EVAL_RUN_DIR, the results folder, so they can be followed live;
// the results (metrics.json, diff.patch) are written there too.

const EVALS = resolve(import.meta.dirname, "..");
const scenarioName = required("EVAL_SCENARIO"); // e.g. todo-app/remaining-count
const runDir = resolve(required("EVAL_RUN_DIR"));
const model = required("EVAL_MODEL");
const openRouterKey = required("OPENROUTER_API_KEY");
const dataDir = dirname(resolve(storage));

// Every command the QA runs is approved, so runs only happen in the eval container,
// where they can't reach this machine.
if (!existsSync("/.dockerenv")) {
  console.error(
    "Evals only run in the eval container, where the QA's commands can't reach this machine. See evals/README.md.",
  );
  process.exit(1);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} isn't set`);
  return value;
}

const git = (args: string[], cwd?: string) =>
  execFileSync("git", ["-c", "user.name=zini evals", "-c", "user.email=evals@zini.local", ...args], {
    cwd,
    encoding: "utf8",
  });

const repoName = scenarioName.split("/")[0]!;
const scenarioDir = join(EVALS, "scenarios", scenarioName);
const repoDir = join(EVALS, "repos", repoName);
const scenario = JSON.parse(readFileSync(join(scenarioDir, "scenario.json"), "utf8")) as Scenario;

// ---- The repo and the workspace --------------------------------------------------

// The test repo as a fresh git repo with one commit, the scenario's patch applied.
function makeSourceRepo() {
  const source = join(dataDir, "source");
  const skip = new Set(["node_modules", "dist", "data"]);
  cpSync(repoDir, source, {
    recursive: true,
    filter: (path) => !skip.has(path.slice(repoDir.length + 1).split(/[\\/]/)[0] ?? ""),
  });
  git(["init", "--quiet", "-b", "main"], source);
  if (scenario.patch) git(["apply", join(scenarioDir, scenario.patch)], source);
  git(["add", "-A"], source);
  git(["commit", "--quiet", "-m", "Initial commit"], source);
  return source;
}

// The clone zini works from, made like cloneRepo makes one from GitHub (see git.ts):
// bare, with origin/* branches and origin/HEAD pointing at the default branch.
function cloneLikeZini(source: string) {
  const repo = join(dataDir, "repo.git");
  git(["clone", "--bare", "--quiet", source, repo]);
  git(["-C", repo, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  git(["-C", repo, "fetch", "--quiet", "origin"]);
  git(["-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
}

// A workspace like createWorkspace makes, without Linear: its worktree, its row, and its
// setup, already done (the dependencies come with the eval image).
async function makeWorkspace(issueId: string) {
  await addWorktree(issueId, `eval/${scenarioName.replace("/", "-")}`);
  const modules = join(repoDir, "node_modules");
  if (existsSync(modules)) {
    cpSync(modules, join(workspacePath(issueId), "node_modules"), { recursive: true, verbatimSymlinks: true });
  }
  await saveSettings({ workspaceSetupCommand: "npm ci" });
  mkdirSync(join(dataDir, "workspace-logs"), { recursive: true });
  writeFileSync(
    join(dataDir, "workspace-logs", `${issueId}.log`),
    "$ npm ci\n(Installed when the eval image was built.)\n\nSetup finished\n",
  );
  await Workspace.create({ issueId, setupStatus: "ready" });
}

// Linear, as far as the pipeline uses it: fetchLinearIssue's query, answered with the
// scenario's issue. Any other call fails, so a new one shows up instead of misleading.
function fakeLinear(issueId: string): LinearClient {
  const issue = {
    id: issueId,
    identifier: "EVAL-1",
    title: scenario.title,
    description: scenario.description,
    priority: 0,
    url: "",
    updatedAt: new Date().toISOString(),
    branchName: `eval/${scenarioName}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    team: { key: "EVAL", name: "Evals" },
    comments: { nodes: [] },
  };
  const rawRequest = async (query: string) => {
    if (!query.includes("query Issue(")) throw new Error(`Linear call not mocked in evals:\n${query}`);
    return { data: { issue } };
  };
  return { client: { rawRequest } } as unknown as LinearClient;
}

// ---- Following the run ------------------------------------------------------------

// Prints each run log line as it's written: who's working and what they call.
function followLogs(logDir: string) {
  const read = new Map<string, number>();
  const short = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };
  const poll = () => {
    if (!existsSync(logDir)) return;
    for (const file of readdirSync(logDir).sort()) {
      const role = file.replace(/\.jsonl$/, "").split("-").at(-1);
      const lines = readFileSync(join(logDir, file), "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(read.get(file) ?? 0)) {
        const event = JSON.parse(line) as { event: string; name?: string; args?: Record<string, unknown>; outcome?: string };
        if (event.event === "start") console.log(`▶ ${role}`);
        else if (event.event === "tool_call") {
          const first = Object.values(event.args ?? {})[0];
          console.log(`  ${role}: ${event.name}${first === undefined ? "" : ` ${short(first)}`}`);
        } else if (event.event === "end") console.log(`■ ${role}: ${event.outcome}`);
      }
      read.set(file, lines.length);
    }
  };
  const timer = setInterval(poll, 1500);
  return () => {
    clearInterval(timer);
    poll();
  };
}

// ---- Answering the pauses ---------------------------------------------------------

let questionsAnswered = 0;
let plansApproved = 0;
let commandsApproved = 0;

function reply(waiting: PipelineWaiting): PipelineResume {
  if (waiting.kind === "questions") {
    const answers = waiting.questions.map(() => scenario.answers?.[questionsAnswered++] ?? "You decide.");
    waiting.questions.forEach((question, i) => console.log(`? ${waiting.from}: ${question}\n  → ${answers[i]}`));
    return { answers };
  }
  if (waiting.kind === "approve_plan") {
    plansApproved++;
    console.log("✓ plan approved");
    return { approve: true };
  }
  if (waiting.kind === "approve_commands") {
    for (const { command } of waiting.commands) console.log(`✓ $ ${command}`);
    commandsApproved += waiting.commands.length;
    return { decisions: waiting.commands.map(() => ({ type: "approve" as const })) };
  }
  throw new Error(`Nothing to answer ${waiting.kind} with`);
}

// ---- The run ----------------------------------------------------------------------

async function main() {
  const started = Date.now();
  mkdirSync(runDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  // The run logs go straight to the results folder ("junction": no admin rights needed
  // on Windows; ignored elsewhere).
  mkdirSync(join(runDir, "logs"), { recursive: true });
  symlinkSync(join(runDir, "logs"), join(dataDir, "coordinator-logs"), "junction");

  await initDb();
  cloneLikeZini(makeSourceRepo());
  const issueId = randomUUID();
  await makeWorkspace(issueId);
  console.log(`${scenarioName}: ${scenario.title} (model ${model})`);

  const run = pipelineRun({ linear: fakeLinear(issueId), openRouterKey, model }, issueId);
  const stopFollowing = followLogs(join(runDir, "logs", issueId));
  let error: string | null = null;
  try {
    for await (const _ of await startPipeline(run, "")) {
      // Each step's state; the logs show the progress.
    }
    for (let pauses = 0; pauses < 200; pauses++) {
      const { waiting } = await getPipeline(issueId);
      if (!waiting || waiting.kind === "feedback") break;
      for await (const _ of await resumePipeline(run, reply(waiting))) {
        // As above.
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.log(`✗ ${error}`);
  } finally {
    stopFollowing();
    await stopQa(issueId);
  }

  const pipeline = await getPipeline(issueId);
  if (!error && !pipeline.finished) error = pipeline.waiting ? "Stopped after 200 pauses" : "Stopped before finishing";

  const { diff, truncated } = await workspaceDiff(issueId);
  writeFileSync(join(runDir, "diff.patch"), truncated ? `${diff}\n[Cut off]\n` : diff);

  let check: RunMetrics["check"] = null;
  const checkFile = join(scenarioDir, "check.ts");
  if (existsSync(checkFile)) {
    console.log("Running the hidden check…");
    const { default: runCheck } = (await import(pathToFileURL(checkFile).href)) as { default: Check };
    const workspace = workspacePath(issueId);
    check = await runCheck({ workspace, startApp: (options) => startApp(workspace, options) }).catch(
      (err: unknown) => ({ passed: false, details: `The check failed to run: ${String(err)}` }),
    );
    console.log(`${check.passed ? "✓" : "✗"} check: ${check.details}`);
  }

  const roles = roleMetrics(join(runDir, "logs", issueId));
  const metrics: RunMetrics = {
    scenario: scenarioName,
    model,
    finished: pipeline.finished,
    qaVerdict: pipeline.qa?.verdict ?? null,
    error,
    check,
    seconds: (Date.now() - started) / 1000,
    questionsAnswered,
    plansApproved,
    commandsApproved,
    roles,
    totals: totals(roles),
  };
  writeFileSync(join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Done in ${Math.round(metrics.seconds)}s: ${runDir}`);
  // The pipeline's checkpointer and LangChain keep handles open.
  process.exit(0);
}

await main();
