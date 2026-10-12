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

export type User = {
  username: string;
  authority: number;
}

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

// A Linear issue's workspace: a git worktree of the repo with the issue's branch
// checked out, as returned by /api/workspaces. branch is read from the worktree.
export type Workspace = {
  context?: WorkspaceContext | null;
  issueId: string;
  branch: string;
  path: string;
  createdAt: string;
  // The issue's forge is working; the workspace can't be deleted until it's done.
  forgeRunning: boolean;
};

// Live Git state, fetched only by commit/push and PR controls.
export type WorkspaceGitStatus = { uncommitted: boolean; unpushed: boolean };

// A pull request on GitHub from a workspace's branch.
export type PullRequest = { number: number; url: string; state: "open" | "closed" | "merged" };

export type WorkspaceContext = {
  branch: string;
  sourcePr: (PullRequest & { title: string; body: string }) | null;
  initialHead: string;
  targetBranch: string;
};
export type IntegrationState = {
  targetBranch: string;
  targetCommit: string;
  status: "current" | "merged" | "conflicts" | "deferred";
  conflicts: string[];
};
export type WorkspaceChoice = { pr: number; title: string; url: string; state: "open" | "closed" };
export type WorkspaceSelection = { pullRequest?: number; fresh?: boolean };

// As returned by GET /api/workspaces/:issueId/pull-request: whether the branch is on
// GitHub, and its newest pull request (whatever its state), if it has one.
export type PullRequestStatus = { pushed: boolean; pullRequest: PullRequest | null };

// One turn of the project lead chat, as shown in the webapp: a message, one of
// the agent's tool calls (without its result), or where the conversation was
// compacted (the messages before it are replaced by a summary for the model). A call is pending while it runs or
// waits on approval, and never_ran when it can't get a result anymore (e.g. the run
// failed first); error is set when it failed or was rejected.
export type ChatMessage =
  | { role: "user"; content: string; username?: string; images?: string[] }
  | { role: "activity"; content: string; issueId: string; eventId: string; eventType: string }
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

// A saved project lead chat, as listed by GET /api/project-lead/threads.
// running: the agent is working on it now.
export type ThreadSummary = { id: string; title: string; createdAt: string; running: boolean };

// A chat with Forge subscriptions, as returned by GET /api/project-lead/subscriptions.
export type ProjectLeadSubscriptions = { threadId: string; forgeIds: string[] };

// An item of the agent's to-do list, which it keeps for work with several steps.
export type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

// A chat reopened with GET /api/project-lead/threads/:id. pending is non-empty
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
  subscriptions: string[];
  running: boolean;
  error: string | null;
};

// A project lead chat changed: refetch it (and the chat list).
export type ThreadEvent = { type: "thread.updated"; threadId: string };

// App settings, as returned by GET /api/settings. A setting that was never saved is null.
// Each model runs on its provider (a ModelProvider; OpenRouter when unset).
export type Settings = {
  projectLeadProvider: string | null;
  projectLeadModel: string | null;
  forgeProvider: string | null;
  forgeModel: string | null;
  githubRepo: string | null;
  // Stored as "true" or "false"; null preserves the default enabled behavior.
  conductorEnabled: string | null;
};

// Settings that can be cleared, by saving an empty value.
export const OPTIONAL_SETTINGS = [
  "projectLeadProvider",
  "forgeProvider",
] as const;

// Where a model runs: on OpenRouter, with its key, or on the user's ChatGPT plan, through
// Sign in with ChatGPT.
export const MODEL_PROVIDERS = ["openrouter", "chatgpt"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

// As returned by GET /api/chatgpt: whether zini is signed in to a ChatGPT plan, and as whom.
export type ChatGptStatus = { connected: boolean; email?: string };

// The ChatGPT sign-in changed (signed in or out): refetch its status and models.
export type ChatGptEvent = { type: "chatgpt.updated" };

// A workspace's setup started, finished or failed: refetch it.
export type WorkspaceEvent = { type: "workspace.updated"; issueId: string };

// An issue's forge conversation changed: refetch it.
export type ForgeEvent = { type: "forge.updated"; issueId: string };

// A line was added to a subagent run's log (a new run starts one): refetch that run,
// and the issue's list of runs.
export type ForgeLogEvent = { type: "forge.log"; issueId: string; runId: string };

// An eval started, printed a line, or ended: refetch its status (and, once it ends, the
// results).
export type EvalEvent = { type: "eval.updated" };

// Everything sent on GET /api/events.
export type ServerEvent = ThreadEvent | WorkspaceEvent | ForgeEvent | ForgeLogEvent | EvalEvent | ChatGptEvent;

// The forge's pipeline for an issue: the planner plans (you answer its questions
// and approve the plan), then the coder and reviewer loop until the review requires no
// changes, and the QA runs the software to test them (a failure sends the coder back to
// work). Each subagent returns a document with only what it needs to say. Every one
// has blockingQuestions: what it couldn't decide without you (empty if nothing), which
// pauses the pipeline to ask you.
export type AgentRole = "planner" | "coder" | "reviewer" | "qa";

// summary: the approach, in a few sentences. steps: plain instructions, each naming
// the files it touches.
export type AcceptanceCriterion = { id: string; requirement: string; source: string };
export type RepoCommand = {
  id: string;
  kind: "setup" | "check" | "start";
  command: string;
  cwd: string;
  purpose: string;
  sources: string[];
};
export type PlanDocument = {
  existingImplementation: string;
  summary: string;
  steps: string[];
  blockingQuestions: string[];
  acceptanceCriteria: AcceptanceCriterion[];
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
  // Why none were selected, when none were.
  noChecksReason?: string;
  complete: boolean;
};

export type EnvironmentSetupDocument = ChecksDocument & {
  noSetupReason?: string;
  blockingQuestions: string[];
};

// The coder follows the approved plan, and its changes are the workspace's diff, so it
// only reports what it needs you for (e.g. a step it can't follow as written).
export type ImplementationDocument = { blockingQuestions: string[]; commitMessage: string; replanReason: string };

// Reviewer approves only when requiredChanges and questions
// are empty and its executed checks support approval.
export type EnvironmentFailure = { command: string; reason: string };
export type ReviewDocument = { requiredChanges: string[]; blockingQuestions: string[] };

// The QA's report. coverage: each acceptance criterion's result, with its evidence.
// failures: what doesn't work, each with how to reproduce it and the evidence. The
// forge adds verdict and couldNotTest (what wasn't verified, and why) from these
// and the deterministic checks.
export type QaDocument = {
  environmentFailures: EnvironmentFailure[];
  verdict: "pass" | "fail" | "partial";
  failures: string[];
  couldNotTest: string[];
  blockingQuestions: string[];
  coverage: { criterionId: string; status: "pass" | "fail" | "blocked"; evidence: string }[];
};

// A question a subagent asked, and your answer. Kept for the whole pipeline and given
// to every subagent.
export type Clarification = { from: AgentRole; question: string; answer: string };

// The workspace's changes against the base branch, as returned by
// GET /api/workspaces/:issueId/diff: a unified diff, new files included.
export type WorkspaceDiff = { diff: string; truncated: boolean };

// What the pipeline is paused on, waiting for you: a subagent's questions, approving the
// plan. Finished work has no pending request.
export type PipelineWaiting =
  | { kind: "questions"; from: AgentRole; questions: string[] }
  | { kind: "approve_plan" };

// Your reply to what the pipeline is waiting on, as POSTed to
// /api/forge/:issueId/resume: answers to the questions (in order), approving the
// plan.
export type PipelineResume =
  | { answers: string[] }
  | { approve: true };

export type ForgeHumanMessage = { id: string; t: string; content: string; username?: string };
export type ForgeMessage = { id: string; t: string; agent: AgentRole | null } & (
  | { kind: "stage" }
  | { kind: "message"; message: Extract<ChatMessage, { role: "user" | "assistant" | "compaction" }> }
  | { kind: "tool"; call: Extract<ChatMessage, { role: "tool" }>; result?: string }
  | { kind: "document" }
);

// An issue whose pipeline is waiting for you to approve something (its plan, or the QA's
// commands), as listed by GET /api/forge/approvals.
export type PendingApproval = { issueId: string; kind: "approve_plan" };

// An issue's pipeline, as returned by GET /api/forge/:issueId. One per issue.
export type SteeringTarget = "planner" | "coder" | "reviewer" | "qa";
export type PipelineRedirect = { target: SteeringTarget; feedback: string };
export type SteeringOption = { target: SteeringTarget; reason: string | null };

export type PipelineState = {
  integration?: IntegrationState | null;
  redirecting?: boolean;
  steeringOptions?: SteeringOption[];
  started: boolean;
  // The subagent working now, if any.
  running: AgentRole | null;
  // Cancellation is draining; do not resume into the same workspace yet.
  pausing?: boolean;
  // Pending checkpoint work with no active run or outstanding human request.
  canResume?: boolean;
  pendingRole?: AgentRole | null;
  waiting: PipelineWaiting | null;
  plan: PlanDocument | null;
  planApproved: boolean;
  implementation: ImplementationDocument | null;
  checks?: ChecksDocument | null;
  environmentSetup?: EnvironmentSetupDocument | null;
  review: ReviewDocument | null;
  qa: QaDocument | null;
  clarifications: Clarification[];
  // The page the QA's browser is on, while it's open: it can be watched live, at
  // GET /api/forge/:issueId/browser.
  browserUrl: string | null;
  // The pipeline completed. Further revisions use redirect; no reply is pending.
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

export type LogRole = AgentRole | "pr_writer";

// A subagent run's log, for debugging: one entry per line of its log file, written as
// the run goes. A model call or tool call logs when it starts and when it ends, so
// the last entry says what the run is doing (e.g. model_call: waiting on the model).
export type RunLogEntry =
  | { event: "start"; role: LogRole; model: string; prompt: string; input: string }
  | { event: "model_call" }
  | {
      event: "model_reply";
      text: string;
      toolCalls?: { id?: string; name: string; args: Record<string, unknown> }[];
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
// GET /api/forge/:issueId/logs/:runId.
export type RunLogEvent = RunLogEntry & { t: string };

// A subagent run, as listed by GET /api/forge/:issueId/logs (oldest first).
// outcome is null while it runs, or if the server stopped before it ended.
export type RunLogSummary = {
  id: string;
  role: LogRole;
  startedAt: string;
  outcome: "done" | "error" | null;
};

// ---- Evals (see evals/README.md) ---------------------------------------------------

// A scenario the forge can be evaluated on: evals/scenarios/<repo>/<name>. id is
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
  // Whether the pipeline got to the end. Further revisions use redirect.
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
  roles: Record<string, RoleMetrics>;
  totals: Omit<RoleMetrics, "runs" | "toolCallsByName">;
};

// A batch of runs of one scenario, started together, as listed by GET /api/evals/batches
// (newest first). A run without metrics is still going, or was stopped.
export type EvalBatch = {
  scenario: string;
  id: string;
  hasLog?: boolean;
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

const SUMMARY_ROLES = ["planner", "coder", "reviewer", "qa"];

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

// Images are base64 data URLs, sent alongside the message text.
export type ProjectLeadMessage = { message: string; images?: string[] };
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

// Current conductor activity, as returned by GET /api/conductor/status.
export type ConductorStatus = {
  lastRan: null | Date;
  running: boolean;
}
