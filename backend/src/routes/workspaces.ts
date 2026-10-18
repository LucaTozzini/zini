import { InvalidInputLinearError } from "@linear/sdk";
import { Router, type Response } from "express";
import type { PullRequestStatus, WorkspaceAppState } from "shared";
import { z } from "zod";
import { findPullRequest } from "../integrations/github.js";
import { getLinearClient } from "../integrations/linear.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../core/settings.js";
import { errorMessage } from "../core/errors.js";
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
import { checkIssueId, parse } from "./http.js";

export const workspaces = Router();
workspaces.param("issueId", checkIssueId);

// A new workspace's issue, and which branch to start it on: an open pull request's, a
// fresh one, or (neither) whatever createWorkspace finds.
const newWorkspace = z
  .object({
    issueId: z.string().refine(isIssueId, "Expected a Linear issue id"),
    pullRequest: z.number().int().positive().optional(),
    fresh: z.boolean().optional(),
  })
  .refine((body) => !(body.fresh && body.pullRequest), "Choose a pull request number or fresh branch");

workspaces.post("/:issueId/sync", async (req, res) => {
  const { issueId } = req.params;
  const body = parse(z.object({ merge: z.boolean({ error: "merge must be boolean" }).default(false) }), req.body, res);
  if (!body) return;
  if (!(await getWorkspace(issueId))) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  try {
    res.json(await syncWorkspace(issueId, body.merge));
  } catch (error) {
    res.status(409).json({ error: lastLine(error) });
  }
});

// A failed git command's message ends with its "fatal: ..." line.
const lastLine = (err: unknown) => errorMessage(err).trim().split("\n").at(-1);

// The issue's workspace, or null if it doesn't have one yet.
workspaces.get("/:issueId", async (req, res) => {
  const { issueId } = req.params;
  try {
    res.json(await getWorkspace(issueId));
  } catch (err) {
    console.error(`Reading the workspace for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't read the workspace: ${lastLine(err)}` });
  }
});

// The user's app in the workspace, for its preview page.
workspaces.get("/:issueId/app", async (req, res) => {
  try {
    const { status, error } = await workspaceApps.refresh(req.params.issueId);
    res.json({ status, error: error ?? null } satisfies WorkspaceAppState);
  } catch (error) {
    res.status(500).json({ error: `Couldn't read the app: ${lastLine(error)}` });
  }
});

// A file the preview's page downloaded.
workspaces.get("/:issueId/preview/downloads/:id", async (req, res) => {
  const download = await previewDownload(req.params.issueId, req.params.id);
  if (!download) {
    res.status(404).json({ error: "That download is no longer available" });
    return;
  }
  res.download(download.path, download.name);
});

// Expensive live Git reads are independent of the issue panel metadata request.
workspaces.get("/:issueId/git-status", async (req, res) => {
  try {
    res.json(await getWorkspaceGitStatus(req.params.issueId));
  } catch (error) {
    res.status(500).json({ error: `Couldn't read Git status: ${lastLine(error)}` });
  }
});

// Everything changed in the workspace since it branched, as a unified diff (see
// workspaceDiff).
workspaces.get("/:issueId/diff", async (req, res) => {
  const { issueId } = req.params;
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
  const body = parse(z.object({ message: z.string().catch("") }), req.body, res);
  if (!body) return;
  const result = await commitAndPush(req.params.issueId, body.message);
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

// Whether the branch is on GitHub, and its newest pull request, whatever its state (see
// PullRequestStatus). Asks GitHub each time, so it's current.
workspaces.get("/:issueId/pull-request", async (req, res) => {
  const { issueId } = req.params;
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

// Opens a pull request only after all workspace changes are committed and pushed.
workspaces.post("/:issueId/pull-request", async (req, res) => {
  const body = parse(z.object({ title: z.string().catch(""), body: z.string().catch("") }), req.body, res);
  if (!body) return;
  const result = await openWorkspacePullRequest(req.params.issueId, body.title, body.body);
  if ("error" in result) res.status(result.status).json({ error: result.error });
  else res.status(201).json(result.pullRequest);
});

// Creates a workspace for { issueId }, or returns the one it already has.
workspaces.post("/", async (req, res) => {
  const body = parse(newWorkspace, req.body, res);
  if (!body) return;
  const { issueId, ...selection } = body;

  const [linear, githubToken, repo] = await Promise.all([getLinearClient(), getKey("github"), getSetting("githubRepo")]);
  if (!linear) {
    res.status(409).json({ error: "Linear isn't connected" });
    return;
  }
  if (!githubToken || !repo) {
    res.status(409).json({ error: "Connect GitHub and set a repository first" });
    return;
  }

  try {
    const { workspace, created } = await createWorkspace(linear, issueId, selection);
    res.status(created ? 201 : 200).json(workspace);
  } catch (err) {
    if (err instanceof WorkspaceChoiceRequired) {
      res.status(409).json({ error: err.message, choices: err.choices });
      return;
    }
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
  const { issueId } = req.params;
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
