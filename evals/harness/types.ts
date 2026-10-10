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
  // False exercises pipeline preparation with an initially empty dependency install.
  preinstalledDependencies?: boolean;
};

// What a hidden check is given: the workspace after the run, and a way to run the app in
// it.
export type CheckContext = {
  // Repository files and commands live in the Linux workspace volume.
  readFile: (path: string) => Promise<string>;
  runCommand: (command: string) => Promise<{ exitCode: number | null; output: string }>;
  startApp: (options?: { dataFile?: string }) => Promise<RunningApp>;
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
