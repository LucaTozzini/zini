import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunLogEvent, RunMetrics } from "shared";
import { pipelineRun, reviewerAgent, runSubagent, stopQa } from "../../backend/src/forge/forge.js";
import type { State } from "../../backend/src/forge/graphState.js";
import { initDb } from "../../backend/src/db.js";
import { fetchLinearIssue } from "../../backend/src/integrations/linear.js";
import { removeSandbox } from "../../backend/src/workspaces/workspaceSandbox.js";
import { isModelRateLimit } from "../../backend/src/providers/modelErrors.js";
import { roleMetrics, totals } from "./metrics.js";
import type { AgentCheck, AgentTest } from "./types.js";
import { codeVersion } from "./version.js";
import {
  checkContext,
  cloneLikeZini,
  connection,
  dataDir,
  EVALS,
  fakeLinear,
  followLogs,
  makeSourceRepo,
  makeWorkspace,
  model,
  required,
  type Fixture,
} from "./workspace.js";

// One agent test run, in its own process (see run.ts --agents): a workspace from the
// test's patches, then one run of its agent from the test's state and earlier
// conversation. Results go to EVAL_RUN_DIR like a scenario run's, plus document.json.

const testName = required("EVAL_AGENT"); // e.g. todo-app/review-repair
const runDir = resolve(required("EVAL_RUN_DIR"));
const testDir = join(EVALS, "agents", testName);
const test = JSON.parse(readFileSync(join(testDir, "agent.json"), "utf8")) as AgentTest;
const fixture: Fixture = {
  name: testName,
  dir: testDir,
  title: test.title,
  description: test.description,
  patch: test.patch,
  branchPatches: test.branchPatches,
  preinstalledDependencies: test.preinstalledDependencies,
};

// The pipeline's state with nothing done yet but an approved plan's place; the test's
// state file fills in what it needs.
const emptyState: State = {
  note: "",
  redirectTarget: "planner",
  steeringFeedback: [],
  humanMessages: [],
  timeline: [],
  plan: null,
  planApproved: true,
  implementation: null,
  runbook: {},
  environmentReport: null,
  checksReport: null,
  review: null,
  qaReport: null,
  clarifications: [],
  planFeedback: [],
  implementationFeedback: [],
  finished: false,
  integration: null,
  integrationAttempts: 0,
};

type HistoryMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
  tool_call_id?: string;
  name?: string;
};

const toMessage = (m: HistoryMessage): BaseMessage =>
  m.role === "user"
    ? new HumanMessage(m.content)
    : m.role === "assistant"
      ? new AIMessage({ content: m.content, tool_calls: (m.tool_calls ?? []).map((call) => ({ ...call, type: "tool_call" as const })) })
      : new ToolMessage({ content: m.content, tool_call_id: m.tool_call_id!, name: m.name });

const readJson = <T>(file: string) => JSON.parse(readFileSync(join(testDir, file), "utf8")) as T;

// Each role's agent for the issue's state. Only the reviewer so far.
const AGENTS = { reviewer: reviewerAgent };

async function main() {
  const started = Date.now();
  mkdirSync(runDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  // The run log goes straight to the results folder, as in run-one.ts.
  mkdirSync(join(runDir, "logs"), { recursive: true });
  symlinkSync(join(runDir, "logs"), join(dataDir, "forge-logs"), "junction");

  await initDb();
  cloneLikeZini(makeSourceRepo(fixture));
  const issueId = randomUUID();
  await makeWorkspace(issueId, fixture);
  console.log(`${testName}: ${test.role} on "${test.title}" (model ${model})`);

  const state: State = { ...emptyState, ...(test.state ? readJson<Partial<State>>(test.state) : {}) };
  const history = test.history ? readJson<HistoryMessage[]>(test.history).map(toMessage) : [];
  const run = pipelineRun({ linear: fakeLinear(issueId, fixture), connection, model }, issueId, "Evals");
  const logDir = join(runDir, "logs", issueId);
  const stopFollowing = followLogs(logDir);
  let error: string | null = null;
  let document: unknown = null;
  try {
    const { agent } = await AGENTS[test.role](issueId, await fetchLinearIssue(run.setup.linear, issueId), state);
    // The history stands in for the agent's remembered conversation.
    document = await runSubagent(run, { ...agent, remember: false, history });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.log(`✗ ${error}`);
  } finally {
    stopFollowing();
    await stopQa(issueId);
  }
  writeFileSync(join(runDir, "document.json"), `${JSON.stringify(document, null, 2)}\n`);

  let check: RunMetrics["check"] = null;
  const checkFile = join(testDir, "check.ts");
  if (existsSync(checkFile) && !isModelRateLimit(error)) {
    console.log("Running the check…");
    const log = existsSync(logDir)
      ? readdirSync(logDir).flatMap((file) =>
          readFileSync(join(logDir, file), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunLogEvent))
      : [];
    const { default: runCheck } = (await import(pathToFileURL(checkFile).href)) as { default: AgentCheck };
    check = await runCheck({ ...checkContext(issueId), log, document }).catch(
      (err: unknown) => ({ passed: false, details: `The check failed to run: ${String(err)}` }),
    );
    console.log(`${check.passed ? "✓" : "✗"} check: ${check.details}`);
  }

  const roles = existsSync(logDir) ? roleMetrics(logDir) : {};
  const metrics: RunMetrics = {
    scenario: testName,
    model,
    finished: document !== null,
    qaVerdict: null,
    error,
    rateLimited: isModelRateLimit(error),
    codeVersion: codeVersion(),
    check,
    seconds: (Date.now() - started) / 1000,
    questionsAnswered: 0,
    plansApproved: 0,
    roles,
    totals: totals(roles),
  };
  writeFileSync(join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Done in ${Math.round(metrics.seconds)}s: ${runDir}`);
  await removeSandbox(issueId);
  // LangChain keeps handles open.
  process.exit(metrics.rateLimited ? 2 : metrics.finished && check?.passed !== false ? 0 : 1);
}

await main();
