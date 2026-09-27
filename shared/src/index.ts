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
};

// One turn of the product manager chat, as shown in the webapp.
export type ChatMessage = { role: "user" | "assistant"; content: string };

// A tool call the agent is waiting on the user to approve, e.g. create_issue.
export type PendingAction = { name: string; args: Record<string, unknown> };

// The user's answer to one pending action. A reject message is passed to the agent.
export type Decision = { type: "approve" } | { type: "reject"; message?: string };

// A saved product manager chat, as listed by GET /api/product-manager/threads.
// running: the agent is working on it now.
export type ThreadSummary = { id: string; title: string; createdAt: string; running: boolean };

// A chat reopened with GET /api/product-manager/threads/:id. pending is non-empty
// when the agent is paused on actions to approve. error is why the last run failed,
// until the next one starts; it's lost if the server restarts.
export type Thread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  pending: PendingAction[];
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

// Everything sent on GET /api/events.
export type ServerEvent = ThreadEvent | WorkspaceEvent | CoordinatorEvent | CoordinatorLogEvent;

// The coordinator's pipeline for an issue: the planner plans (you answer its questions
// and approve the plan), then the coder and reviewer loop until the review requires no
// changes. Each subagent returns a document with only what it needs to say. Every one
// has blockingQuestions: what it couldn't decide without you (empty if nothing), which
// pauses the pipeline to ask you.
export type AgentRole = "planner" | "coder" | "reviewer";

// summary: the approach, in a few sentences. steps: plain instructions, each naming
// the files it touches.
export type PlanDocument = { summary: string; steps: string[]; blockingQuestions: string[] };

// The coder follows the approved plan, and its changes are the workspace's diff, so it
// only reports what it needs you for (e.g. a step it can't follow as written).
export type ImplementationDocument = { blockingQuestions: string[] };

// requiredChanges: what the coder must change, each naming the file and line; empty
// means approved.
export type ReviewDocument = { requiredChanges: string[]; blockingQuestions: string[] };

// A question a subagent asked, and your answer. Kept for the whole pipeline and given
// to every subagent.
export type Clarification = { from: AgentRole; question: string; answer: string };

// The workspace's changes against the base branch, as returned by
// GET /api/workspaces/:issueId/diff: a unified diff, new files included.
export type WorkspaceDiff = { diff: string; truncated: boolean };

// What the pipeline is paused on, waiting for you: a subagent's questions, approving the
// plan, or (once finished) feedback on the changes.
export type PipelineWaiting =
  | { kind: "questions"; from: AgentRole; questions: string[] }
  | { kind: "approve_plan" }
  | { kind: "feedback" };

// Your reply to what the pipeline is waiting on, as POSTed to
// /api/coordinator/:issueId/resume: answers to the questions (in order), approving the
// plan, or feedback (on the plan, or on the finished changes).
export type PipelineResume = { answers: string[] } | { approve: true } | { feedback: string };

// An issue's pipeline, as returned by GET /api/coordinator/:issueId. One per issue.
export type PipelineState = {
  started: boolean;
  // The subagent working now, if any.
  running: AgentRole | null;
  waiting: PipelineWaiting | null;
  plan: PlanDocument | null;
  planApproved: boolean;
  implementation: ImplementationDocument | null;
  review: ReviewDocument | null;
  clarifications: Clarification[];
  // The review required no changes; the pipeline waits for your feedback, if any.
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
      toolCalls?: { name: string; args: Record<string, unknown> }[];
      finishReason?: string;
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
    }
  | { event: "model_error"; error: string }
  // A doc tool call that didn't fit its schema; the error went back to the model.
  | { event: "doc_invalid"; error: string }
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
  role: AgentRole;
  startedAt: string;
  outcome: "done" | "error" | null;
};
