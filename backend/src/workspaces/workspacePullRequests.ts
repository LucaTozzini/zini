import type { LinearIssueDetails, PullRequest } from "shared";
import { createPullRequest } from "../integrations/github.js";
import { fetchLinearIssue, getLinearClient } from "../integrations/linear.js";
import { getKey } from "../models/Integration.js";
import { workspaceProject } from "../projects/projects.js";
import { defaultBranch } from "../repositories/git.js";
import { getWorkspaceWithStatus, isForgeRunning } from "./workspaces.js";
import { isPushed } from "./workspaceFiles.js";
import { workspaceApps } from "./workspaceAppSessions.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { sendEvent } from "../core/events.js";
import { Workspace } from "../models/Workspace.js";
import { assertNoMerge } from "./workspaceIntegration.js";
import { errorMessage } from "../core/errors.js";
import { forgetPullRequest } from "../forge/pullRequest.js";

export const pullRequestDependencies = {
  starting: (id: string) => workspaceApps.starting(id),
  running: (id: string) => isForgeRunning(id),
  workspace: getWorkspaceWithStatus,
  pushed: isPushed,
  github: async (id: string) => {
    const [token, { githubRepo }] = await Promise.all([getKey("github"), workspaceProject(id)]);
    return token ? { token, repo: githubRepo } : null;
  },
  linear: getLinearClient,
  issue: fetchLinearIssue,
  base: async (id: string) => defaultBranch(await workspaceProject(id)),
  create: createPullRequest,
  noMerge: assertNoMerge,
  target: async (id: string) => (await Workspace.findByPk(id))?.context?.targetBranch,
};

// The pull request's title always starts with the issue's identifier, so Linear links
// it to the issue.
const withIdentifier = (issue: Pick<LinearIssueDetails, "identifier">, title: string) =>
  title.startsWith(issue.identifier) ? title : `${issue.identifier}: ${title}`;

// Shared by the workspace UI, the Project Lead and the Forge's Lead. Never commits or pushes implicitly.
export async function openWorkspacePullRequest(
  issueId: string,
  title: string,
  body = "",
  deps: Omit<typeof pullRequestDependencies, "noMerge" | "target"> &
    Partial<Pick<typeof pullRequestDependencies, "noMerge" | "target">> = pullRequestDependencies,
): Promise<{ pullRequest: PullRequest } | { status: number; error: string }> {
  return withWorkspaceLock(issueId, async () => {
    if (deps.starting(issueId)) return { status: 409, error: "The user app is still being prepared" };
    if (deps.running(issueId)) return { status: 409, error: "The Forge is still working in this workspace" };
    if (!title.trim()) return { status: 400, error: "Expected a title" };
    try {
      const workspace = await deps.workspace(issueId);
      if (!workspace) return { status: 404, error: "This issue has no workspace" };
      try {
        await deps.noMerge?.(issueId);
      } catch (error) {
        return { status: 409, error: errorMessage(error) };
      }
      if (workspace.uncommitted || workspace.unpushed || !(await deps.pushed(issueId))) {
        return {
          status: 409,
          error: "Commit and push the changes first (commit_and_push), then retry opening the pull request.",
        };
      }
      const github = await deps.github(issueId);
      if (!github) return { status: 409, error: "Connect GitHub first" };
      const linear = await deps.linear();
      if (!linear) return { status: 409, error: "Linear isn't connected" };
      const issue = await deps.issue(linear, issueId);
      const pullRequest = await deps.create(github.token, github.repo, {
        title: withIdentifier(issue, title.trim()),
        body: body.trim(),
        branch: workspace.branch,
        base: (await deps.target?.(issueId)) ?? (await deps.base(issueId)),
      });
      forgetPullRequest(issueId);
      sendEvent({ type: "workspace.updated", issueId });
      return { pullRequest };
    } catch (error) {
      console.error(`Opening the pull request for ${issueId} failed:`, error);
      return { status: 500, error: errorMessage(error) };
    }
  });
}
