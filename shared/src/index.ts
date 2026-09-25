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
};

// A Linear issue's workspace: a git worktree of the repo with the issue's branch
// checked out, as returned by /api/workspaces. branch is read from the worktree.
export type Workspace = { issueId: string; branch: string; path: string; createdAt: string };

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

// The one server-sent event on GET /api/product-manager/events: the chat changed,
// so refetch it (and the chat list).
export type ThreadEvent = { type: "thread.updated"; threadId: string };

// App settings, as returned by GET /api/settings. A setting that was never saved is null.
// githubRepo is "owner/name".
export type Settings = { productManagerModel: string | null; githubRepo: string | null };

// Services zini connects to with an API key.
export const PROVIDERS = ["linear", "openrouter", "github"] as const;
export type Provider = (typeof PROVIDERS)[number];

// As returned by GET /api/integrations. Never the full key; the last 3 characters
// are enough to recognise it.
type IntegrationStatus = { connected: boolean; keyHint?: string };
export type Integrations = Record<Provider, IntegrationStatus>;
