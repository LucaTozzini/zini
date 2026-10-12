import type { LinearClient } from "@linear/sdk";
import type { Workspace as WorkspaceResponse, WorkspaceSelection, WorkspaceGitStatus } from "shared";
import { findPullRequest, getPullRequest } from "../integrations/github.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../core/settings.js";
import { selectWorkspaceBranch, WorkspaceChoiceRequired } from "./branchSelection.js";
import { assertNoMerge } from "./workspaceIntegration.js";
import { sendEvent } from "../core/events.js";
import { cloneWorkspace, fetchRepo, pushBranch, removeWorkspaceMarker, workspacePath, defaultBranch, remoteBranches, git } from "../repositories/git.js";
import { fetchLinearIssue, linkedPullRequests } from "../integrations/linear.js";
import { commitAll, hasUncommitted, hasUnpushed } from "./workspaceFiles.js";
import { Workspace } from "../models/Workspace.js";
import { forgeThreadId, deleteConversation, stopQa } from "../forge/forge.js";
import { deleteRunLogs } from "../forge/runLog.js";
import { forgetRun, isRunning } from "../agents/runs.js";
import { workspaceApps } from "./workspaceAppSessions.js";
import { removeSandbox } from "./workspaceSandbox.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { trustedGit } from "./trustedGit.js";
import { ensureWorkspaceVolume, workspaceVolume } from "./workspaceVolumes.js";
import { withRepositoryLock } from "../repositories/repositoryLock.js";

// Linear issue ids are UUIDs. Checked before an id is used in a folder path.
export const isIssueId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

function toResponse(row: Workspace): WorkspaceResponse {
  if (!row.context?.branch) throw new Error("Workspace branch metadata is missing");
  return {
    issueId: row.issueId,
    context: row.context,
    branch: row.context.branch,
    path: `docker-volume:${workspaceVolume(row.issueId)}/repo`,
    createdAt: row.createdAt.toISOString(),
    forgeRunning: isForgeRunning(row.issueId),
  };
}

// Metadata reads never inspect Docker or wait for the workspace execution lock.
export async function getWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  return row ? toResponse(row) : null;
}

export async function getWorkspaceGitStatus(issueId: string): Promise<WorkspaceGitStatus | null> {
  if (!await Workspace.findByPk(issueId)) return null;
  const [uncommitted, unpushed] = await Promise.all([hasUncommitted(issueId), hasUnpushed(issueId)]);
  return { uncommitted, unpushed };
}

export async function getWorkspaceWithStatus(issueId: string) {
  const workspace = await getWorkspace(issueId);
  if (!workspace) return null;
  return { ...workspace, ...(await getWorkspaceGitStatus(issueId))! };
}

// Resumes a Linear-linked PR or the exact suggested branch, or returns the
// existing one; created says which. The row is only kept if the volume was cloned,
// and vice versa.
export async function createWorkspace(linear: LinearClient, issueId: string, selection: WorkspaceSelection = {}) {
  return withRepositoryLock(() => createWorkspaceLocked(linear, issueId, selection));
}
async function createWorkspaceLocked(linear: LinearClient, issueId: string, selection: WorkspaceSelection) {
  const existing = await Workspace.findByPk(issueId);
  if (existing) return { workspace: await toResponse(existing), created: false };

  const issue = await fetchLinearIssue(linear, issueId);
  await fetchRepo();
  const token = await getKey("github");
  const repo = await getSetting("githubRepo");
  if (!token || !repo) throw new Error("Connect GitHub and set a repository first");
  const numbers = await linkedPullRequests(linear, issue.id, repo);
  const pulls = await Promise.all(numbers.map(number => getPullRequest(token, repo, number)));
  const branches = await remoteBranches();
  const exactPr = branches.includes(issue.branchName) ? await findPullRequest(token, repo, issue.branchName) : null;
  const exact = exactPr ? await getPullRequest(token, repo, exactPr.number) : null;
  const selected = selectWorkspaceBranch(issue.branchName, await defaultBranch(), branches, pulls, exact, selection);
  if (selected.pull && selected.pull.headRepo?.toLowerCase() !== repo.toLowerCase()) {
    throw new WorkspaceChoiceRequired([selected.pull], "Resuming a PR from a fork is not supported; choose a fresh branch instead");
  }
  if (selected.pull && !branches.includes(selected.branch)) throw new WorkspaceChoiceRequired([selected.pull], "The PR branch was deleted; choose a fresh branch instead");
  await cloneWorkspace(issue.id, selected.branch, selected.target, selected.reuse);
  let row: Workspace;
  try {
    const initialHead = (await git(["-C", workspacePath(issue.id), "rev-parse", "HEAD"])).trim();
    row = await Workspace.create({ issueId: issue.id, context: {
      branch: selected.branch,
      initialHead, targetBranch: selected.target,
      sourcePr: selected.pull ? { number: selected.pull.number, url: selected.pull.url, state: selected.pull.state,
        title: selected.pull.title, body: selected.pull.body } : null,
    } });
  } catch (err) {
    await removeSandbox(issue.id).catch(cleanupErr => console.error("Removing workspace volumes after a failed save:", cleanupErr));
    await removeWorkspaceMarker(issue.id).catch((cleanupErr) =>
      console.error("Removing the workspace marker after a failed save failed:", cleanupErr),
    );
    throw err;
  }
  return { workspace: await toResponse(await row.reload()), created: true };
}

// Removes the issue's Docker resources, host marker and forge
// conversation (which was about this workspace), then its row. false if it had none.
// Not while the forge is running.
// What the QA left running while it waits on you is stopped first: its files would
// otherwise be in use.
export async function deleteWorkspace(issueId: string) {
  return withWorkspaceLock(issueId, () => deleteWorkspaceLocked(issueId));
}
async function deleteWorkspaceLocked(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  if (!row) return false;
  if (isForgeRunning(issueId) || workspaceApps.starting(issueId)) throw new Error("The workspace is still in use by a Forge or app launch");
  await workspaceApps.stop(issueId);
  await stopQa(issueId);
  await removeSandbox(issueId);
  await removeWorkspaceMarker(issueId);
  await deleteConversation(issueId);
  await deleteRunLogs(issueId);
  forgetRun(forgeThreadId(issueId));
  await row.destroy();
  sendEvent({ type: "workspace.updated", issueId });
  return true;
}

export const isForgeRunning = (issueId: string) => isRunning(forgeThreadId(issueId));

// Commits the workspace's uncommitted changes, if any, with message, then pushes its
// branch to GitHub. With nothing uncommitted it only pushes (e.g. after a push that
// failed). Not while the forge is running in it. Answers with the
// workspace, or with what stopped it and the HTTP status that goes with it.
export async function commitAndPush(
  issueId: string,
  message: string,
): Promise<{ workspace: WorkspaceResponse } | { status: number; error: string }> {
  return withWorkspaceLock(issueId, async () => {
    if (workspaceApps.starting(issueId)) return { status: 409, error: "The user app is still being prepared" };
    if (isForgeRunning(issueId)) return { status: 409, error: "The Forge is still working in this workspace" };
    if (!(await Workspace.findByPk(issueId))) return { status: 404, error: "This issue has no workspace" };
    await ensureWorkspaceVolume(issueId);
    return trustedGit(workspacePath(issueId), () => commitAndPushLocked(issueId, message));
  });
}
async function commitAndPushLocked(issueId: string, message: string): Promise<{ workspace: WorkspaceResponse } | { status: number; error: string }> {
  try { await assertNoMerge(issueId); }
  catch (error) { return { status: 409, error: String(error) }; }
  const workspace = await getWorkspaceWithStatus(issueId);
  if (!workspace) return { status: 404, error: "This issue has no workspace" };
  const text = message.trim();
  if (workspace.uncommitted && !text) return { status: 400, error: "Expected a commit message" };
  if (!workspace.uncommitted && !workspace.unpushed) {
    return { status: 409, error: "There's nothing to commit or push" };
  }

  try {
    if (workspace.uncommitted) await commitAll(issueId, text);
    await pushBranch(issueId);
    return { workspace: (await getWorkspace(issueId))! };
  } catch (err) {
    console.error(`Committing and pushing ${issueId} failed:`, err);
    // A failed git command's message ends with its "fatal: ..." line.
    const reason = err instanceof Error ? err.message.trim().split("\n").at(-1) : String(err);
    return { status: 500, error: `Couldn't commit and push: ${reason}` };
  } finally {
    // Committed, pushed, or partly: the webapp refetches what's left to do.
    sendEvent({ type: "workspace.updated", issueId });
  }
}
