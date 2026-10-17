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
  // Links on the issue, such as its pull requests.
  attachments: LinearAttachment[];
  // Issues that block this one, and issues it blocks (Linear's "blocks" relations).
  blockedBy: LinearRelatedIssue[];
  blocks: LinearRelatedIssue[];
};

// An issue on the other end of a "blocks" relation. relationId identifies the relation,
// for removing it.
export type LinearRelatedIssue = {
  relationId: string;
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: StatusType };
};

// A blocker is active until it's done or canceled.
export const isActiveBlocker = (issue: LinearRelatedIssue) =>
  issue.state.type !== "completed" && issue.state.type !== "canceled";

export type LinearAttachment = { title: string; url: string };

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
  openwikiProvider: string | null;
  openwikiModel: string | null;
  githubRepo: string | null;
  // Stored as "true" or "false"; null preserves the default enabled behavior.
  conductorEnabled: string | null;
};

// Settings that can be cleared, by saving an empty value.
export const OPTIONAL_SETTINGS = [
  "projectLeadProvider",
  "forgeProvider",
  "openwikiProvider",
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

// The docs generation scan started, finished, or failed: refetch its status.
export type OpenWikiEvent = { type: "openwiki.updated" };

// Everything sent on GET /api/events.
export type ServerEvent = ThreadEvent | WorkspaceEvent | ForgeEvent | ForgeLogEvent | EvalEvent | ChatGptEvent | OpenWikiEvent;

// The forge for an issue: a Lead agent works the issue end to end. It writes the plan
// (you approve every change to it), delegates the code to a Coder and the testing to a
// Reviewer, commits (merging the latest default branch each time), and finishes once
// the plan's steps are complete and its QA checklist passed. It asks you only when it
// can't decide.
export type AgentRole = "lead" | "coder" | "reviewer";

// The plan the Lead writes. The Lead sets each step's status; only the Reviewer sets a
// QA check's status. Every commit sets the checks back to todo. note says why a check
// failed or was skipped.
export type PlanStep = { id: string; description: string; status: "todo" | "in-progress" | "complete" };
export type QaCheck = { id: string; condition: string; status: "todo" | "skipped" | "failed" | "passed"; note: string };
export type ForgePlan = { steps: PlanStep[]; qaChecklist: QaCheck[] };

// A command the repo supports (to set up, check or start it), kept with the files
// that define it, so it's dropped once they change. Used by the workspace app launcher.
export type RepoCommand = {
  id: string;
  kind: "setup" | "check" | "start";
  command: string;
  cwd: string;
  purpose: string;
  sources: string[];
};

// The workspace's changes against the base branch, as returned by
// GET /api/workspaces/:issueId/diff: a unified diff, new files included.
export type WorkspaceDiff = { diff: string; truncated: boolean };

// What the Forge is paused on, waiting for you: the Lead's questions, or a plan (or a
// change to it) to approve.
export type PipelineWaiting =
  | { kind: "questions"; questions: string[] }
  | { kind: "approve_plan"; plan: ForgePlan };

// Your reply to what the Forge is waiting on, as POSTed to /api/forge/:issueId/resume:
// answers to the questions (in order), approving the plan, or what to change in it.
export type PipelineResume =
  | { answers: string[] }
  | { approve: true }
  | { feedback: string };

export type ForgeMessage = { id: string; t: string; agent: AgentRole | null } & (
  | { kind: "message"; message: Extract<ChatMessage, { role: "user" | "assistant" | "compaction" }> }
  // callId: the tool call's own id, e.g. to open the Coder's run for a delegate_coder call.
  | { kind: "tool"; call: Extract<ChatMessage, { role: "tool" }>; result?: string; callId?: string }
);

// An issue whose Forge is waiting for you to approve its plan, as listed by
// GET /api/forge/approvals.
export type PendingApproval = { issueId: string; kind: "approve_plan" };

// An issue's Forge, as returned by GET /api/forge/:issueId. One per issue.
export type PipelineState = {
  integration?: IntegrationState | null;
  started: boolean;
  // The agent working now, if any: the Lead, or the worker it delegated to.
  running: AgentRole | null;
  // Cancellation is draining; do not resume into the same workspace yet.
  pausing?: boolean;
  // Pending work with no active run or outstanding human request.
  canResume?: boolean;
  waiting: PipelineWaiting | null;
  plan: ForgePlan | null;
  planApproved: boolean;
  // The page the Reviewer's browser is on, while it's open: it can be watched live, at
  // GET /api/forge/:issueId/browser.
  browserUrl: string | null;
  // The Lead finished: every step complete and every QA check passed or skipped. You
  // can still message it for changes.
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

// A subagent run's log, for debugging: one entry per line of its log file, written as
// the run goes. A model call or tool call logs when it starts and when it ends, so
// the last entry says what the run is doing (e.g. model_call: waiting on the model).
export type RunLogEntry =
  | { event: "start"; role: AgentRole; model: string; prompt: string; input: string }
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
  role: AgentRole;
  startedAt: string;
  outcome: "done" | "error" | null;
};

// ---- Evals (see evals/README.md) ---------------------------------------------------

// What an eval runs: scenarios run the whole Forge on an issue
// (evals/scenarios), agent tests run one agent from a fixed starting point
// (evals/agents).
export type EvalKind = "scenarios" | "agents";

// A scenario or agent test: evals/<kind>/<repo>/<name>. id is "<repo>/<name>".
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
  running: { kind: EvalKind; scenario: string; repeat: number; startedAt: string } | null;
  output: string[];
  // How the latest one ended: null while it runs, or if there hasn't been one.
  ended: { ok: boolean; error: string | null } | null;
};

// A line of a batch summary: a metric's mean across the runs (with its spread, or a rate
// as a percentage), and with compared runs, theirs and the change.
export type SummaryRow = { label: string; value: string; was: string | null; change: string | null };

type SummaryMetric = [label: string, value: (run: RunMetrics) => number | null, kind?: "rate"];

const SUMMARY_ROLES = ["lead", "coder", "reviewer"];

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

// The user's app in a workspace, as GET /api/workspaces/:issueId/app reports it.
export type WorkspaceAppState = { status: "stopped" | "starting" | "ready" | "failed"; error?: string | null };

// The live preview: the workspace's app in a browser inside its Docker container, which
// the user controls over a WebSocket (/api/workspaces/:issueId/preview). The backend
// sends the screen as JPEG frames in binary messages, and these as JSON text.
export type PreviewMode = "desktop" | "mobile";
export type PreviewServerMessage =
  | { type: "state"; url: string; title: string; canGoBack: boolean; canGoForward: boolean;
      mode: PreviewMode; width: number; height: number }
  // The page asked for files: answer with "files", or nothing to cancel.
  | { type: "fileChooser"; multiple: boolean }
  | { type: "dialog"; kind: string; message: string; defaultValue: string }
  // Saved by the backend: GET /api/workspaces/:issueId/preview/downloads/:id.
  | { type: "download"; id: string; name: string }
  | { type: "error"; message: string };
// x and y are in the page's CSS pixels; modifiers is CDP's bit field (Alt 1, Ctrl 2,
// Meta 4, Shift 8).
export type PreviewClientMessage =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number;
      button: "left" | "middle" | "right" | "none"; clickCount: number; modifiers: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  // key is a KeyboardEvent.key.
  | { type: "key"; action: "down" | "up"; key: string }
  // Pasted or composed text, typed as is.
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  | { type: "back" } | { type: "forward" } | { type: "reload" }
  // The viewer's size in CSS pixels, and its device pixel ratio (frames are sharper).
  | { type: "resize"; width: number; height: number; scale: number }
  | { type: "mode"; mode: PreviewMode }
  // data is base64.
  | { type: "files"; files: { name: string; mimeType: string; data: string }[] }
  | { type: "dialog"; accept: boolean; text?: string };
