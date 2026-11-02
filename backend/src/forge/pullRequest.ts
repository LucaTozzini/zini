import type { PullRequest } from "shared";
import { findPullRequest } from "../integrations/github.js";
import { getKey } from "../models/Integration.js";
import { Workspace } from "../models/Workspace.js";
import { workspaceProject } from "../projects/projects.js";

// The Forge's pull request is the newest one from its workspace's branch, whoever opened
// it, as GitHub has it now: open, merged or closed. Nothing keeps a copy, so it can't go
// stale; a lookup is reused for a minute, since the Lead, its view and the Project Lead
// all ask.
const MAX_AGE_MS = 60_000;
const cache = new Map<string, { at: number; pullRequest: PullRequest | null }>();

// null when the branch has no pull request, or GitHub isn't connected.
export async function branchPullRequest(issueId: string): Promise<PullRequest | null> {
  const cached = cache.get(issueId);
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.pullRequest;
  const [token, row, project] = await Promise.all([getKey("github"), Workspace.findByPk(issueId), workspaceProject(issueId)]);
  const branch = row?.context?.branch;
  const pullRequest = token && branch ? await findPullRequest(token, project.githubRepo, branch) : null;
  cache.set(issueId, { at: Date.now(), pullRequest });
  return pullRequest;
}

// After a push or a new pull request, so the next lookup asks GitHub again.
export const forgetPullRequest = (issueId: string) => cache.delete(issueId);
