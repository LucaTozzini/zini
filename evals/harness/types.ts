// A scenario: an issue for the forge to work on, in a copy of a test repo, with an
// optional patch applied first (e.g. a planted bug) and answers for the questions the
// subagents may ask. Each lives in evals/scenarios/<repo>/<name>/, under the folder of
// the repo in evals/repos it runs on, as scenario.json, and can also hold check.ts, a
// hidden check of the result (see Check).
export type Scenario = {
  title: string;
  description: string;
  // A patch in the scenario's folder, applied to the repo before its first commit.
  patch?: string;
  // Answers to the subagents' questions, in the order they're asked; "You decide."
  // once they run out.
  answers?: string[];
  // False exercises the Forge's preparation with an initially empty dependency install.
  preinstalledDependencies?: boolean;
  // Seed an inherited implementation on the issue branch after the baseline commit.
  branchPatch?: string;
  // Advance main before Forge starts, at its second fetch of main (the Lead's commit
  // after coding), or at its first fetch after a review (its finish check), so finishing
  // is refused until the new main is merged and reviewed.
  upstreamPatch?: string;
  upstreamAfterCoderPatch?: string;
  upstreamAfterReviewPatch?: string;
};

// What a hidden check is given: the workspace after the run, and a way to run the app in
// it.
export type CheckContext = {
  // Repository files and commands live in the Linux workspace volume.
  readFile: (path: string) => Promise<string>;
  runCommand: (command: string) => Promise<{ exitCode: number | null; output: string }>;
  startApp: (options?: { dataFile?: string; protocol?: "http" | "https" }) => Promise<RunningApp>;
  launchBrowser: () => Promise<import("playwright").Browser>;
};

export type RunningApp = {
  // e.g. http://localhost:4710
  url: string;
  browserUrl: string;
  stop: () => Promise<void>;
};

export type CheckResult = { passed: boolean; details: string };

// check.ts's default export. It throws, or returns passed: false, when the result is
// wrong.
export type Check = (context: CheckContext) => Promise<CheckResult>;

// An agent test: one run of one Forge agent from a fixed starting point, in
// evals/agents/<repo>/<name>/agent.json (see run-agent.ts). Its check.ts exports an
// AgentCheck.
export type AgentTest = {
  // The agent; only the reviewer for now.
  role: "reviewer";
  // The issue.
  title: string;
  description: string;
  // A patch in the test's folder, applied to the repo before its first commit.
  patch?: string;
  // Patches committed one by one on the issue branch: the code as the agent finds it.
  branchPatches?: string[];
  preinstalledDependencies?: boolean;
  // A JSON file with the approved plan the agent works from: { plan: ForgePlan }.
  state: string;
  // The Lead's brief; a default one when left out.
  brief?: string;
  // A JSON file of the agent's earlier conversation, as messages:
  // { role: "user" | "assistant" | "tool", content, tool_calls?, tool_call_id? }.
  history?: string;
};

// An agent test's check.ts: the run's log and the report the agent submitted (null
// if it didn't), with the workspace as hidden checks get it.
export type AgentCheck = (
  context: CheckContext & { log: import("shared").RunLogEvent[]; document: unknown },
) => Promise<CheckResult>;
