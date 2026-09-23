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
