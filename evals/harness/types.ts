// A scenario: an issue for the coordinator to work on, in a copy of a test repo, with an
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
};

// What a hidden check is given: the workspace after the run, and a way to run the app in
// it.
export type CheckContext = {
  workspace: string;
  startApp: (options?: { dataFile?: string }) => Promise<RunningApp>;
};

export type RunningApp = {
  // e.g. http://localhost:4710
  url: string;
  stop: () => Promise<void>;
};

export type CheckResult = { passed: boolean; details: string };

// check.ts's default export. It throws, or returns passed: false, when the result is
// wrong.
export type Check = (context: CheckContext) => Promise<CheckResult>;
