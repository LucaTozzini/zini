import { InvalidInputLinearError } from "@linear/sdk";
import { Router, type Response } from "express";
import type { PullRequestStatus, WorkspaceAppState } from "shared";
import { findPullRequest } from "../integrations/github.js";
import { fetchLinearIssue, getLinearClient } from "../integrations/linear.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../core/settings.js";
import { isPushed, workspaceDiff } from "../workspaces/workspaceFiles.js";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import { previewDownload } from "../browser/previewBrowser.js";
import { syncWorkspace } from "../repositories/git.js";
import { WorkspaceChoiceRequired } from "../workspaces/branchSelection.js";
import {
  commitAndPush,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceGitStatus,
  isForgeRunning,
  isIssueId,
} from "../workspaces/workspaces.js";

import { openWorkspacePullRequest } from "../workspaces/workspacePullRequests.js";

export const workspaces = Router();
workspaces.post("/:issueId/sync", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res); if (!issueId) return;
  if (req.body?.merge !== undefined && typeof req.body.merge !== "boolean") { res.status(400).json({ error: "merge must be boolean" }); return; }
  if (!await getWorkspace(issueId)) { res.status(404).json({ error: "Workspace not found" }); return; }
  try { res.json(await syncWorkspace(issueId, req.body?.merge === true)); }
  catch (error) { res.status(409).json({ error: lastLine(error) }); }
});

// The issue id from the URL or body, or null after sending a 400.
function readIssueId(value: unknown, res: Response) {
  if (typeof value === "string" && isIssueId(value)) return value;
  res.status(400).json({ error: "Expected a Linear issue id" });
  return null;
}

// A failed git command's message ends with its "fatal: ..." line.
const lastLine = (err: unknown) =>
  err instanceof Error ? err.message.trim().split("\n").at(-1) : String(err);

// The issue's workspace, or null if it doesn't have one yet.
workspaces.get("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  try {
    res.json(await getWorkspace(issueId));
  } catch (err) {
    console.error(`Reading the workspace for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't read the workspace: ${lastLine(err)}` });
  }
});

// The user's app in the workspace, for its preview page.
workspaces.get("/:issueId/app", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res); if (!issueId) return;
  try {
    const { status, error } = await workspaceApps.refresh(issueId);
    res.json({ status, error: error ?? null } satisfies WorkspaceAppState);
  } catch (error) { res.status(500).json({ error: `Couldn't read the app: ${lastLine(error)}` }); }
});

// A file the preview's page downloaded.
workspaces.get("/:issueId/preview/downloads/:id", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res); if (!issueId) return;
  const download = await previewDownload(issueId, req.params.id);
  if (!download) { res.status(404).json({ error: "That download is no longer available" }); return; }
  res.download(download.path, download.name);
});

// Expensive live Git reads are independent of the issue panel metadata request.
workspaces.get("/:issueId/git-status", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res); if (!issueId) return;
  try { res.json(await getWorkspaceGitStatus(issueId)); }
  catch (error) { res.status(500).json({ error: `Couldn't read Git status: ${lastLine(error)}` }); }
});

// Everything changed in the workspace since it branched, as a unified diff (see
// workspaceDiff).
workspaces.get("/:issueId/diff", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (!(await getWorkspace(issueId))) {
    res.status(404).json({ error: "This issue has no workspace" });
    return;
  }
  try {
    res.json(await workspaceDiff(issueId));
  } catch (err) {
    console.error(`Reading the diff for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't read the changes: ${lastLine(err)}` });
  }
});

// Commits the uncommitted changes, if any, with { message }, then pushes the branch to
// GitHub, and answers with the workspace. With nothing uncommitted it only pushes (e.g.
// after a push that failed). Not while the forge is running in it.
workspaces.post("/:issueId/commit", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const { message } = (req.body ?? {}) as { message?: unknown };
  const result = await commitAndPush(issueId, typeof message === "string" ? message : "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.workspace);
});

// GitHub's token and the repo ("owner/name"), or null after sending a 409.
async function loadGitHub(res: Response) {
  const [token, repo] = await Promise.all([getKey("github"), getSetting("githubRepo")]);
  if (token && repo) return { token, repo };
  res.status(409).json({ error: "Connect GitHub and set a repository first" });
  return null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Whether the branch is on GitHub, and its newest pull request, whatever its state (see
// PullRequestStatus). Asks GitHub each time, so it's current.
workspaces.get("/:issueId/pull-request", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const workspace = await getWorkspace(issueId);
  if (!workspace) {
    res.status(404).json({ error: "This issue has no workspace" });
    return;
  }
  const github = await loadGitHub(res);
  if (!github) return;
  try {
    const pushed = await isPushed(issueId);
    const pullRequest = pushed ? await findPullRequest(github.token, github.repo, workspace.branch) : null;
    res.json({ pushed, pullRequest } satisfies PullRequestStatus);
  } catch (err) {
    console.error(`Looking up the pull request for ${issueId} failed:`, err);
    res.status(500).json({ error: message(err) });
  }
});

// Opens a pull request only after all workspace changes are committed and pushed.
workspaces.post("/:issueId/pull-request", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const { title, body } = (req.body ?? {}) as { title?: unknown; body?: unknown };
  const result = await openWorkspacePullRequest(issueId, typeof title === "string" ? title : "", typeof body === "string" ? body : "");
  if ("error" in result) res.status(result.status).json({ error: result.error });
  else res.status(201).json(result.pullRequest);
});

// Creates a workspace for { issueId }, or returns the one it already has.
workspaces.post("/", async (req, res) => {
  const issueId = readIssueId((req.body as { issueId?: unknown } | undefined)?.issueId, res);
  if (!issueId) return;

  const [linear, githubToken, repo] = await Promise.all([
    getLinearClient(),
    getKey("github"),
    getSetting("githubRepo"),
  ]);
  if (!linear) {
    res.status(409).json({ error: "Linear isn't connected" });
    return;
  }
  if (!githubToken || !repo) {
    res.status(409).json({ error: "Connect GitHub and set a repository first" });
    return;
  }

  try {
    const selection = { pullRequest: req.body?.pullRequest, fresh: req.body?.fresh };
    if ((selection.pullRequest !== undefined && (!Number.isSafeInteger(selection.pullRequest) || selection.pullRequest <= 0)) ||
        (selection.fresh !== undefined && typeof selection.fresh !== "boolean") || (selection.fresh && selection.pullRequest)) {
      res.status(400).json({ error: "Choose a pull request number or fresh branch" }); return;
    }
    const { workspace, created } = await createWorkspace(linear, issueId, selection);
    res.status(created ? 201 : 200).json(workspace);
  } catch (err) {
    if (err instanceof WorkspaceChoiceRequired) { res.status(409).json({ error: err.message, choices: err.choices }); return; }
    if (err instanceof InvalidInputLinearError) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    console.error(`Creating the workspace for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't create the workspace: ${lastLine(err)}` });
  }
});

// Not while the forge is running in it.
workspaces.delete("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (workspaceApps.starting(issueId)) {
    res.status(409).json({ error: "Stop the app launch before deleting its workspace" });
    return;
  }
  if (isForgeRunning(issueId)) {
    res.status(409).json({ error: "The Forge is still working in this workspace" });
    return;
  }
  try {
    if (!(await deleteWorkspace(issueId))) {
      res.status(404).json({ error: "This issue has no workspace" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error(`Deleting the workspace for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't delete the workspace: ${lastLine(err)}` });
  }
});
