import { Router, type Response } from "express";
import {
  coordinatorThreadId,
  getPipeline,
  loadSetup as loadPipelineSetup,
  pipelineRun,
  readReply,
  replyFits,
  resumePipeline,
  startPipeline,
} from "../coordinator.js";
import { writeCommitMessage, writePullRequest } from "../coordinator/writers.js";
import { listRunLogs, readRunLog } from "../coordinator/runLog.js";
import { Workspace } from "../models/Workspace.js";
import { beginRun, isRunning } from "../runs.js";
import { branchCommits, hasUncommitted } from "../workspaceFiles.js";
import { isIssueId } from "../workspaces.js";

// An issue's coordinator pipeline, at /api/coordinator/:issueId (see coordinator.ts).
export const coordinator = Router();

// The issue id from the URL, or null after sending a 400.
function readIssueId(value: string, res: Response) {
  if (isIssueId(value)) return value;
  res.status(400).json({ error: "Expected a Linear issue id" });
  return null;
}

// What the pipeline needs to run, or null after sending a 409 naming what's missing.
async function loadSetup(res: Response) {
  const setup = await loadPipelineSetup();
  if (typeof setup !== "string") return setup;
  res.status(409).json({ error: setup });
  return null;
}

// The pipeline works in the issue's workspace, so it needs one that's set up. false
// after sending a 404 or 409.
async function requireReadyWorkspace(issueId: string, res: Response) {
  const workspace = await Workspace.findByPk(issueId);
  if (!workspace) {
    res.status(404).json({ error: "This issue has no workspace" });
    return false;
  }
  if (workspace.setupStatus !== "ready") {
    res.status(409).json({ error: "The workspace isn't set up yet" });
    return false;
  }
  return true;
}

coordinator.get("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  res.json(await getPipeline(issueId));
});

// Starts the pipeline, with an optional note for the planner. Answers once it's
// started; the planner works in the background.
coordinator.post("/:issueId/start", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const { note } = req.body ?? {};
  if (note !== undefined && typeof note !== "string") {
    res.status(400).json({ error: "note must be a string" });
    return;
  }
  if (!(await requireReadyWorkspace(issueId, res))) return;
  if ((await getPipeline(issueId)).started) {
    res.status(409).json({ error: "The pipeline has already started" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = pipelineRun(setup, issueId);
  const started = await beginRun(
    res,
    coordinatorThreadId(issueId),
    () => startPipeline(run, (note ?? "").trim()),
    run.notify,
  );
  if (started) res.status(202).end();
});

// Replies to what the pipeline is waiting on: { answers } to questions, { approve: true }
// or { feedback } for the plan, { feedback } once finished. It then carries on.
coordinator.post("/:issueId/resume", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const reply = readReply(req.body);
  if (!reply) {
    res.status(400).json({ error: "Expected { answers }, { approve: true } or { feedback }" });
    return;
  }
  if (!(await requireReadyWorkspace(issueId, res))) return;

  const { waiting } = await getPipeline(issueId);
  if (!replyFits(waiting, reply)) {
    res.status(409).json({
      error: waiting ? "That reply doesn't fit what the pipeline is waiting on" : "The pipeline isn't waiting on you",
    });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = pipelineRun(setup, issueId);
  const started = await beginRun(res, coordinatorThreadId(issueId), () => resumePipeline(run, reply), run.notify);
  if (started) res.status(202).end();
});

// Writes a commit message for the workspace's uncommitted changes (see committer.ts),
// for you to read and edit before committing. Answers { commitMessage } once written.
// Not while the pipeline is running.
coordinator.post("/:issueId/commit-message", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (!(await requireReadyWorkspace(issueId, res))) return;
  if (isRunning(coordinatorThreadId(issueId))) {
    res.status(409).json({ error: "The coordinator is still working in this workspace" });
    return;
  }
  if (!(await hasUncommitted(issueId))) {
    res.status(409).json({ error: "There's nothing to commit" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;
  try {
    res.json({ commitMessage: await writeCommitMessage(setup, issueId) });
  } catch (err) {
    console.error(`Writing the commit message for ${issueId} failed:`, err);
    res.status(500).json({
      error: `Couldn't write the commit message: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// Writes a pull request's { title, body } for the branch's commits (see writers.ts),
// for you to read and edit before opening it. Not while the pipeline is running.
coordinator.post("/:issueId/pull-request-text", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (!(await requireReadyWorkspace(issueId, res))) return;
  if (isRunning(coordinatorThreadId(issueId))) {
    res.status(409).json({ error: "The coordinator is still working in this workspace" });
    return;
  }
  if ((await branchCommits(issueId)).length === 0) {
    res.status(409).json({ error: "The branch has no commits to open a pull request for" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;
  try {
    res.json(await writePullRequest(setup, issueId));
  } catch (err) {
    console.error(`Writing the pull request for ${issueId} failed:`, err);
    res.status(500).json({
      error: `Couldn't write the pull request: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// The issue's subagent runs, oldest first, for inspecting their logs (see runLog.ts).
coordinator.get("/:issueId/logs", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  res.json(await listRunLogs(issueId));
});

// One run's log. Each line added sends a coordinator.log event.
coordinator.get("/:issueId/logs/:runId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const log = await readRunLog(issueId, req.params.runId);
  if (!log) {
    res.status(404).json({ error: "No such run" });
    return;
  }
  res.json(log);
});
