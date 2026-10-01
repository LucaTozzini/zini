import { InvalidInputLinearError } from "@linear/sdk";
import { Router, type Response } from "express";
import type { PullRequestStatus } from "shared";
import { withIdentifier } from "../coordinator/writers.js";
import { defaultBranch } from "../git.js";
import { createPullRequest, findPullRequest } from "../github.js";
import { fetchLinearIssue, getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../settings.js";
import { isPushed, workspaceDiff } from "../workspaceFiles.js";
import { isSettingUp, readSetupLog } from "../workspaceSetup.js";
import {
  commitAndPush,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  isCoordinatorRunning,
  isIssueId,
  rerunSetup,
} from "../workspaces.js";

export const workspaces = Router();

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

const stillSettingUp = (res: Response) =>
  res.status(409).json({ error: "The workspace is still being set up" });

// Runs the setup command again. The outcome comes as a workspace.updated event.
workspaces.post("/:issueId/setup", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (isSettingUp(issueId)) {
    stillSettingUp(res);
    return;
  }
  const workspace = await rerunSetup(issueId);
  if (!workspace) {
    res.status(404).json({ error: "This issue has no workspace" });
    return;
  }
  res.json(workspace);
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
// after a push that failed). Not while setup or the coordinator is running in it.
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

// Opens a pull request from the branch into the default branch, with { title, body },
// and answers with it. The title always starts with the issue's identifier (see
// withIdentifier). Only once everything is committed and pushed, so it has all the
// changes.
workspaces.post("/:issueId/pull-request", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (isSettingUp(issueId)) {
    stillSettingUp(res);
    return;
  }
  if (isCoordinatorRunning(issueId)) {
    res.status(409).json({ error: "The coordinator is still working in this workspace" });
    return;
  }
  const workspace = await getWorkspace(issueId);
  if (!workspace) {
    res.status(404).json({ error: "This issue has no workspace" });
    return;
  }
  const { title, body } = (req.body ?? {}) as { title?: unknown; body?: unknown };
  const titleText = typeof title === "string" ? title.trim() : "";
  if (!titleText) {
    res.status(400).json({ error: "Expected a title" });
    return;
  }
  if (workspace.uncommitted || workspace.unpushed || !(await isPushed(issueId))) {
    res.status(409).json({ error: "Commit and push the changes first" });
    return;
  }
  const github = await loadGitHub(res);
  if (!github) return;
  const linear = await getLinearClient();
  if (!linear) {
    res.status(409).json({ error: "Linear isn't connected" });
    return;
  }
  try {
    const issue = await fetchLinearIssue(linear, issueId);
    const pullRequest = await createPullRequest(github.token, github.repo, {
      title: withIdentifier(issue, titleText),
      body: typeof body === "string" ? body.trim() : "",
      branch: workspace.branch,
      base: await defaultBranch(),
    });
    res.status(201).json(pullRequest);
  } catch (err) {
    console.error(`Opening the pull request for ${issueId} failed:`, err);
    res.status(500).json({ error: message(err) });
  }
});

// The end of the last setup's output (see readSetupLog), as plain text.
workspaces.get("/:issueId/setup-log", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  res.type("text/plain").send(await readSetupLog(issueId));
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
    const { workspace, created } = await createWorkspace(linear, issueId);
    res.status(created ? 201 : 200).json(workspace);
  } catch (err) {
    if (err instanceof InvalidInputLinearError) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    console.error(`Creating the workspace for ${issueId} failed:`, err);
    res.status(500).json({ error: `Couldn't create the workspace: ${lastLine(err)}` });
  }
});

// Not while setup or the coordinator is running in it.
workspaces.delete("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (isSettingUp(issueId)) {
    stillSettingUp(res);
    return;
  }
  if (isCoordinatorRunning(issueId)) {
    res.status(409).json({ error: "The coordinator is still working in this workspace" });
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
