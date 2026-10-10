import type { LinearClient } from "@linear/sdk";
import type { Workspace as WorkspaceResponse } from "shared";
import { sendEvent } from "../core/events.js";
import { cloneWorkspace, fetchRepo, pushBranch, removeWorkspaceMarker, workspacePath, workspaceBranch } from "../repositories/git.js";
import { fetchLinearIssue } from "../integrations/linear.js";
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

// Linear issue ids are UUIDs. Checked before an id is used in a folder path.
export const isIssueId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

async function toResponse(row: Workspace): Promise<WorkspaceResponse> {
  const [branch, uncommitted, unpushed] = await Promise.all([
    workspaceBranch(row.issueId),
    hasUncommitted(row.issueId),
    hasUnpushed(row.issueId),
  ]);
  return {
    issueId: row.issueId,
    branch,
    path: `docker-volume:${workspaceVolume(row.issueId)}/repo`,
    createdAt: row.createdAt.toISOString(),
    forgeRunning: isForgeRunning(row.issueId),
    uncommitted,
    unpushed,
  };
}

export async function getWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  return row ? toResponse(row) : null;
}

// Creates the issue's workspace on the branch Linear suggests for it, or returns the
// existing one; created says which. The row is only kept if the volume was cloned,
// and vice versa.
export async function createWorkspace(linear: LinearClient, issueId: string) {
  const existing = await Workspace.findByPk(issueId);
  if (existing) return { workspace: await toResponse(existing), created: false };

  const issue = await fetchLinearIssue(linear, issueId);
  await fetchRepo();
  await cloneWorkspace(issue.id, issue.branchName);
  let row: Workspace;
  try {
    row = await Workspace.create({ issueId: issue.id });
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
  await workspaceApps.stop(issueId);
  await stopQa(issueId);
  await removeSandbox(issueId);
  await removeWorkspaceMarker(issueId);
  await deleteConversation(issueId);
  await deleteRunLogs(issueId);
  forgetRun(forgeThreadId(issueId));
  await row.destroy();
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
  const workspace = await getWorkspace(issueId);
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
