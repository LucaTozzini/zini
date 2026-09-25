import { InvalidInputLinearError } from "@linear/sdk";
import { Router, type Response } from "express";
import { getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { getSetting } from "../settings.js";
import { isSettingUp, readSetupLog } from "../workspaceSetup.js";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
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

// Not while setup is running in it.
workspaces.delete("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (isSettingUp(issueId)) {
    stillSettingUp(res);
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
