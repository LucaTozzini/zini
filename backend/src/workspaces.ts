import type { LinearClient } from "@linear/sdk";
import type { Workspace as WorkspaceResponse } from "shared";
import { addWorktree, fetchRepo, removeWorktree, workspacePath, worktreeBranch } from "./git.js";
import { fetchLinearIssue } from "./linear.js";
import { Workspace } from "./models/Workspace.js";
import { deleteSetupLog, startSetup } from "./workspaceSetup.js";

// Linear issue ids are UUIDs. Checked before an id is used in a folder path.
export const isIssueId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

async function toResponse(row: Workspace): Promise<WorkspaceResponse> {
  return {
    issueId: row.issueId,
    branch: await worktreeBranch(row.issueId),
    path: workspacePath(row.issueId),
    createdAt: row.createdAt.toISOString(),
    setupStatus: row.setupStatus,
    setupError: row.setupError,
  };
}

// Starts setup, recording a failure to even start (e.g. the log folder can't be
// made) on the row rather than failing the request.
async function trySetup(issueId: string) {
  try {
    await startSetup(issueId);
  } catch (err) {
    console.error(`Starting setup for ${issueId} failed:`, err);
    const setupError = `Couldn't start setup: ${err instanceof Error ? err.message : String(err)}`;
    await Workspace.update({ setupStatus: "failed", setupError }, { where: { issueId } });
  }
}

// The issue's workspace, or null if it doesn't have one.
export async function getWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  return row ? toResponse(row) : null;
}

// Creates the issue's workspace on the branch Linear suggests for it, or returns the
// existing one; created says which. The row is only kept if the worktree was made,
// and vice versa. Setup then runs in the background (see workspaceSetup.ts).
export async function createWorkspace(linear: LinearClient, issueId: string) {
  const existing = await Workspace.findByPk(issueId);
  if (existing) return { workspace: await toResponse(existing), created: false };

  const issue = await fetchLinearIssue(linear, issueId);
  await fetchRepo();
  await addWorktree(issue.id, issue.branchName);
  let row: Workspace;
  try {
    row = await Workspace.create({ issueId: issue.id });
  } catch (err) {
    await removeWorktree(issue.id).catch((cleanupErr) =>
      console.error("Removing the worktree after a failed save failed:", cleanupErr),
    );
    throw err;
  }
  await trySetup(issue.id);
  return { workspace: await toResponse(await row.reload()), created: true };
}

// Runs setup again, e.g. after fixing the command. null if there's no workspace.
export async function rerunSetup(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  if (!row) return null;
  await trySetup(issueId);
  return toResponse(await row.reload());
}

// Removes the issue's worktree and local branch, its setup log, then its row. false
// if it had none. Not while setup is running (see isSettingUp).
export async function deleteWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  if (!row) return false;
  await removeWorktree(issueId);
  await deleteSetupLog(issueId);
  await row.destroy();
  return true;
}
