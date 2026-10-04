// Linear's fixed status types; every team's custom status names map to one of these.
export const STATUS_TYPES = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
] as const;

export type StatusType = (typeof STATUS_TYPES)[number];

// Linear's priority numbers, 0 to 4, by name.
export const PRIORITY_NAMES = ["None", "Urgent", "High", "Medium", "Low"] as const;

// An issue as returned by GET /api/integrations/linear/issues.
export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  url: string;
  updatedAt: string;
  state: { name: string; type: StatusType };
  assignee: { name: string } | null;
};

// One issue with its details, as returned by GET /api/integrations/linear/issues/:id.
// branchName is the git branch Linear suggests for it; PRs from that branch link back.
export type LinearIssueDetails = Omit<LinearIssue, "assignee"> & {
  description: string | null;
  branchName: string;
  assignee: { name: string; email: string } | null;
  team: { key: string; name: string };
  // Oldest first.
  comments: LinearComment[];
};

// A comment on a Linear issue. user is null for comments by integrations and bots.
export type LinearComment = { body: string; createdAt: string; user: { name: string } | null };

// Where a workspace's setup command is at. A workspace is only ready to work in once
// setup has succeeded (or there's no setup command).
export type SetupStatus = "running" | "ready" | "failed";

// A Linear issue's workspace: a git worktree of the repo with the issue's branch
// checked out, as returned by /api/workspaces. branch is read from the worktree.
// setupError says why setup failed, e.g. "Exited with code 1".
export type Workspace = {
  issueId: string;
  branch: string;
  path: string;
  createdAt: string;
  setupStatus: SetupStatus;
  setupError: string | null;
  // The issue's coordinator is working; the workspace can't be deleted until it's done.
  coordinatorRunning: boolean;
  // Changes not committed yet (new files included, ignored ones not).
  uncommitted: boolean;
  // Commits on the branch that aren't on GitHub yet.
  unpushed: boolean;
};

// A pull request on GitHub from a workspace's branch.
export type PullRequest = { number: number; url: string; state: "open" | "closed" | "merged" };

// As returned by GET /api/workspaces/:issueId/pull-request: whether the branch is on
// GitHub, and its newest pull request (whatever its state), if it has one.
export type PullRequestStatus = { pushed: boolean; pullRequest: PullRequest | null };

// One turn of the product manager chat, as shown in the webapp: a message, one of
// the agent's tool calls (without its result), or where the conversation was
// compacted (the messages before it are replaced by a summary for the model). A call is pending while it runs or
// waits on approval, and never_ran when it can't get a result anymore (e.g. the run
// failed first); error is set when it failed or was rejected.
export type ChatMessage =
  | { role: "user"; content: string; username?: string }
  | { role: "assistant"; content: string }
  | {
      role: "tool";
      name: string;
      args: Record<string, unknown>;
      status: "pending" | "done" | "error" | "never_ran";
      error?: string;
    }
  | { role: "compaction"; summary: string };

// A tool call the agent is waiting on the user to approve, e.g. create_issue. For a
// reply_to_pipeline call, questions are the ones the pipeline is waiting on, which its
// answers are for, in order.
export type PendingAction = { name: string; args: Record<string, unknown>; questions?: string[] };

// The user's answer to one pending action. A reject message is passed to the agent.
export type Decision = { type: "approve" } | { type: "reject"; message?: string };

// A saved product manager chat, as listed by GET /api/product-manager/threads.
// running: the agent is working on it now.
export type ThreadSummary = { id: string; title: string; createdAt: string; running: boolean };

// An item of the agent's to-do list, which it keeps for work with several steps.
export type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

// A chat reopened with GET /api/product-manager/threads/:id. pending is non-empty
// when the agent is paused on actions to approve. notes are the agent's project notes
// (markdown), shared by every chat. error is why the last run failed, until the next one starts;
// it's lost if the server restarts.
export type Thread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  pending: PendingAction[];
  notes: string;
  todos: Todo[];
  running: boolean;
  error: string | null;
};

// A product manager chat changed: refetch it (and the chat list).
export type ThreadEvent = { type: "thread.updated"; threadId: string };

// App settings, as returned by GET /api/settings. A setting that was never saved is null.
// githubRepo is "owner/name". workspaceSetupCommand runs in each new workspace, and is
// stopped after workspaceSetupTimeoutMinutes (a whole number; 15 when unset).
export type Settings = {
  productManagerModel: string | null;
  coordinatorModel: string | null;
  githubRepo: string | null;
  workspaceSetupCommand: string | null;
  workspaceSetupTimeoutMinutes: string | null;
};

// Settings that can be cleared, by saving an empty value.
export const OPTIONAL_SETTINGS = ["workspaceSetupCommand", "workspaceSetupTimeoutMinutes"] as const;

// A workspace's setup started, finished or failed: refetch it.
export type WorkspaceEvent = { type: "workspace.updated"; issueId: string };

// An issue's coordinator conversation changed: refetch it.
export type CoordinatorEvent = { type: "coordinator.updated"; issueId: string };

// A line was added to a subagent run's log (a new run starts one): refetch that run,
// and the issue's list of runs.
export type CoordinatorLogEvent = { type: "coordinator.log"; issueId: string; runId: string };

// An eval started, printed a line, or ended: refetch its status (and, once it ends, the
// results).
export type EvalEvent = { type: "eval.updated" };

// Everything sent on GET /api/events.
export type ServerEvent = ThreadEvent | WorkspaceEvent | CoordinatorEvent | CoordinatorLogEvent | EvalEvent;

// The coordinator's pipeline for an issue: the planner plans (you answer its questions
// and approve the plan), then the coder and reviewer loop until the review requires no
// changes, and the QA runs the software to test them (a failure sends the coder back to
// work). Each subagent returns a document with only what it needs to say. Every one
// has blockingQuestions: what it couldn't decide without you (empty if nothing), which
// pauses the pipeline to ask you.
export type AgentRole = "planner" | "coder" | "checks" | "reviewer" | "qa";

// summary: the approach, in a few sentences. steps: plain instructions, each naming
// the files it touches.
export type AcceptanceCriterion = { id: string; requirement: string; source: string };
export type RepoCommand = {
  id: string;
  kind: "check" | "start";
  command: string;
  cwd: string;
  purpose: string;
  sources: string[];
};
export type PlanDocument = {
  summary: string;
  steps: string[];
  blockingQuestions: string[];
  // Optional for pipelines saved before acceptance criteria were introduced.
  acceptanceCriteria?: AcceptanceCriterion[];
};
export type CheckResult = {
  command: string;
  cwd: string;
  purpose: string;
  status: "passed" | "failed" | "blocked";
  exitCode: number | null;
  output: string;
};
export type ChecksDocument = {
  revision: string;
  results: CheckResult[];
  couldNotTest: string[];
  notApplicable?: string[];
  complete: boolean;
};

// The coder follows the approved plan, and its changes are the workspace's diff, so it
// only reports what it needs you for (e.g. a step it can't follow as written).
export type ImplementationDocument = { blockingQuestions: string[] };

// requiredChanges: what the coder must change, each naming the file and line; empty
// means approved.
export type ReviewDocument = { requiredChanges: string[]; blockingQuestions: string[] };

// The QA's report. checks: what it ran or tried, each with its result. failures: what
// doesn't work, each with how to reproduce it and the evidence (fail means there's at
// least one). couldNotTest: what it couldn't check, and why (e.g. a missing .env).
export type QaDocument = {
  verdict: "pass" | "fail" | "partial";
  checks: string[];
  failures: string[];
  couldNotTest: string[];
  blockingQuestions: string[];
  coverage?: { criterionId: string; status: "pass" | "fail" | "blocked"; evidence: string }[];
};

// A question a subagent asked, and your answer. Kept for the whole pipeline and given
// to every subagent.
export type Clarification = { from: AgentRole; question: string; answer: string };

// The workspace's changes against the base branch, as returned by
// GET /api/workspaces/:issueId/diff: a unified diff, new files included.
export type WorkspaceDiff = { diff: string; truncated: boolean };

// A command the QA wants to run on this machine (run_command or start_process), which
// you approve or reject first.
export type PendingCommand = { tool: string; command: string };

// What the pipeline is paused on, waiting for you: a subagent's questions, approving the
// plan, approving the QA's commands, or (once finished) feedback on the changes.
export type PipelineWaiting =
  | { kind: "questions"; from: AgentRole; questions: string[] }
  | { kind: "approve_plan" }
  | { kind: "approve_commands"; commands: PendingCommand[]; from?: AgentRole }
  | { kind: "feedback" };

// Your reply to what the pipeline is waiting on, as POSTed to
// /api/coordinator/:issueId/resume: answers to the questions (in order), approving the
// plan, feedback (on the plan, or on the finished changes), or a decision on each of
// the QA's commands (in order; a reject's message goes to the QA).
export type PipelineResume =
  | { answers: string[] }
  | { approve: true }
  | { feedback: string }
  | { decisions: Decision[] };

// An issue whose pipeline is waiting for you to approve something (its plan, or the QA's
// commands), as listed by GET /api/coordinator/approvals.
export type PendingApproval = { issueId: string; kind: "approve_plan" | "approve_commands" };

// An issue's pipeline, as returned by GET /api/coordinator/:issueId. One per issue.
export type PipelineState = {
  started: boolean;
  // The subagent working now, if any.
  running: AgentRole | null;
  waiting: PipelineWaiting | null;
  plan: PlanDocument | null;
  planApproved: boolean;
  implementation: ImplementationDocument | null;
  checks?: ChecksDocument | null;
  review: ReviewDocument | null;
  qa: QaDocument | null;
  clarifications: Clarification[];
  // The page the QA's browser is on, while it's open: it can be watched live, at
  // GET /api/coordinator/:issueId/browser.
  browserUrl: string | null;
  // The QA passed the changes; the pipeline waits for your feedback, if any.
  finished: boolean;
  // Why the last run failed, until the next one starts; lost if the server restarts.
  error: string | null;
};

// Services zini connects to with an API key.
export const PROVIDERS = ["linear", "openrouter", "github"] as const;
export type Provider = (typeof PROVIDERS)[number];

// As returned by GET /api/integrations. Never the full key; the last 3 characters
// are enough to recognise it.
type IntegrationStatus = { connected: boolean; keyHint?: string };
export type Integrations = Record<Provider, IntegrationStatus>;

// Whose run a log is: a pipeline subagent's, or, outside the pipeline, the committer's
// (it writes a commit message) or the PR writer's (a pull request's title and body).
export type LogRole = AgentRole | "committer" | "pr_writer";

// A subagent run's log, for debugging: one entry per line of its log file, written as
// the run goes. A model call or tool call logs when it starts and when it ends, so
// the last entry says what the run is doing (e.g. model_call: waiting on the model).
export type RunLogEntry =
  | { event: "start"; role: LogRole; model: string; prompt: string; input: string }
  | { event: "model_call" }
  | {
      event: "model_reply";
      text: string;
      toolCalls?: { name: string; args: Record<string, unknown> }[];
      finishReason?: string;
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    }
  | { event: "model_error"; error: string }
  // A doc tool call that didn't fit its schema; the error went back to the model.
  | { event: "doc_invalid"; error: string }
  | { event: "doc_recovery"; attempt: number }
  // id pairs a result with its call when tools run in parallel.
  | { event: "tool_call"; id?: string; name: string; args: Record<string, unknown> }
  | { event: "tool_result"; id?: string; name: string; status?: string; result: string }
  | { event: "end"; outcome: "done"; document: unknown }
  | { event: "end"; outcome: "error"; error: string };

// An entry with when it was written, as returned by
// GET /api/coordinator/:issueId/logs/:runId.
export type RunLogEvent = RunLogEntry & { t: string };

// A subagent run, as listed by GET /api/coordinator/:issueId/logs (oldest first).
// outcome is null while it runs, or if the server stopped before it ended.
export type RunLogSummary = {
  id: string;
  role: LogRole;
  startedAt: string;
  outcome: "done" | "error" | null;
};

// ---- Evals (see evals/README.md) ---------------------------------------------------

// A scenario the coordinator can be evaluated on: evals/scenarios/<repo>/<name>. id is
// "<repo>/<name>".
export type EvalScenario = { id: string; repo: string; name: string; title: string };

// One subagent role's share of an eval run, from its run logs.
export type RoleMetrics = {
  // How many times the role ran, e.g. 2 coder runs after a review asked for changes.
  runs: number;
  seconds: number;
  modelCalls: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  errors: number;
};

// One eval run's metrics.json.
export type RunMetrics = {
  scenario: string;
  model: string;
  // Whether the pipeline got to the end (the QA passed, waiting for feedback).
  finished: boolean;
  qaVerdict: "pass" | "fail" | "partial" | null;
  rateLimited?: boolean;
  codeVersion?: string;
  // Why the run stopped early, if it did.
  error: string | null;
  // The scenario's hidden check, if it has one.
  check: { passed: boolean; details: string } | null;
  seconds: number;
  // The pauses the harness answered.
  questionsAnswered: number;
  plansApproved: number;
  commandsApproved: number;
  roles: Record<string, RoleMetrics>;
  totals: Omit<RoleMetrics, "runs" | "toolCallsByName">;
};

// A batch of runs of one scenario, started together, as listed by GET /api/evals/batches
// (newest first). A run without metrics is still going, or was stopped.
export type EvalBatch = {
  scenario: string;
  id: string;
  runs: { id: string; metrics: RunMetrics | null }[];
};

// The eval going on now, if any, and the console output of the latest one, as returned by
// GET /api/evals/status. One runs at a time.
export type EvalStatus = {
  running: { scenario: string; repeat: number; startedAt: string } | null;
  output: string[];
  // How the latest one ended: null while it runs, or if there hasn't been one.
  ended: { ok: boolean; error: string | null } | null;
};

// A line of a batch summary: a metric's mean across the runs (with its spread, or a rate
// as a percentage), and with compared runs, theirs and the change.
export type SummaryRow = { label: string; value: string; was: string | null; change: string | null };

type SummaryMetric = [label: string, value: (run: RunMetrics) => number | null, kind?: "rate"];

const SUMMARY_ROLES = ["planner", "coder", "checks", "reviewer", "qa"];

const SUMMARY_METRICS: SummaryMetric[] = [
  ["finished", (r) => (r.finished ? 1 : 0), "rate"],
  ["QA passed", (r) => (r.qaVerdict === "pass" ? 1 : 0), "rate"],
  ["model rate limited", (r) => (r.rateLimited ? 1 : 0), "rate"],
  ["hidden check passed", (r) => (r.check ? (r.check.passed ? 1 : 0) : null), "rate"],
  ["seconds", (r) => r.seconds],
  ["model calls", (r) => r.totals.modelCalls],
  ["tool calls", (r) => r.totals.toolCalls],
  ["input tokens (k)", (r) => r.totals.inputTokens / 1000],
  ["output tokens (k)", (r) => r.totals.outputTokens / 1000],
  ["commands approved", (r) => r.commandsApproved],
  ["questions answered", (r) => r.questionsAnswered],
  ...SUMMARY_ROLES.flatMap((role): SummaryMetric[] => [
    [`${role}: runs`, (r) => r.roles[role]?.runs ?? 0],
    [`${role}: seconds`, (r) => r.roles[role]?.seconds ?? 0],
    [`${role}: tool calls`, (r) => r.roles[role]?.toolCalls ?? 0],
  ]),
];

// "12.3 ± 2.1", or "67%" for a rate; "-" without values.
function summaryStat(values: number[], kind?: "rate") {
  if (values.length === 0) return { mean: null, text: "-" };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (kind === "rate") return { mean, text: `${Math.round(mean * 100)}%` };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  return { mean, text: values.length > 1 ? `${round(mean)} ± ${round(sd)}` : `${round(mean)}` };
}

// A batch's runs summarised, metric by metric; with compare, against other runs (e.g. a
// baseline from before a change).
export function summarizeRuns(runs: RunMetrics[], compare?: RunMetrics[]): SummaryRow[] {
  return SUMMARY_METRICS.map(([label, value, kind]) => {
    const values = (list: RunMetrics[]) => list.map(value).filter((v): v is number => v !== null);
    const here = summaryStat(values(runs), kind);
    if (!compare) return { label, value: here.text, was: null, change: null };
    const there = summaryStat(values(compare), kind);
    const change =
      here.mean !== null && there.mean !== null && there.mean !== 0 && kind !== "rate"
        ? `${here.mean >= there.mean ? "+" : ""}${Math.round(((here.mean - there.mean) / there.mean) * 100)}%`
        : null;
    return { label, value: here.text, was: there.text, change };
  });
}
