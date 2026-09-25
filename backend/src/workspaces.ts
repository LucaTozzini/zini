import type { LinearClient } from "@linear/sdk";
import type { Workspace as WorkspaceResponse } from "shared";
import { addWorktree, fetchRepo, removeWorktree, workspacePath, worktreeBranch } from "./git.js";
import { fetchLinearIssue } from "./linear.js";
import { Workspace } from "./models/Workspace.js";

// Linear issue ids are UUIDs. Checked before an id is used in a folder path.
export const isIssueId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

async function toResponse(row: Workspace): Promise<WorkspaceResponse> {
  return {
    issueId: row.issueId,
    branch: await worktreeBranch(row.issueId),
    path: workspacePath(row.issueId),
    createdAt: row.createdAt.toISOString(),
  };
}

// The issue's workspace, or null if it doesn't have one.
export async function getWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  return row ? toResponse(row) : null;
}

// Creates the issue's workspace on the branch Linear suggests for it, or returns the
// existing one; created says which. The row is only kept if the worktree was made,
// and vice versa.
export async function createWorkspace(linear: LinearClient, issueId: string) {
  const existing = await Workspace.findByPk(issueId);
  if (existing) return { workspace: await toResponse(existing), created: false };

  const issue = await fetchLinearIssue(linear, issueId);
  await fetchRepo();
  await addWorktree(issue.id, issue.branchName);
  try {
    const row = await Workspace.create({ issueId: issue.id });
    return { workspace: await toResponse(row), created: true };
  } catch (err) {
    await removeWorktree(issue.id).catch((cleanupErr) =>
      console.error("Removing the worktree after a failed save failed:", cleanupErr),
    );
    throw err;
  }
}

// Removes the issue's worktree and local branch, then its row. false if it had none.
export async function deleteWorkspace(issueId: string) {
  const row = await Workspace.findByPk(issueId);
  if (!row) return false;
  await removeWorktree(issueId);
  await row.destroy();
  return true;
}
