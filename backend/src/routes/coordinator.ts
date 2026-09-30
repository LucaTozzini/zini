import { Router, type Response } from "express";
import type { PipelineResume } from "shared";
import {
  coordinatorThreadId,
  getPipeline,
  resumePipeline,
  startPipeline,
  type Setup,
} from "../coordinator.js";
import { writeCommitMessage } from "../coordinator/committer.js";
import { listRunLogs, readRunLog } from "../coordinator/runLog.js";
import { sendEvent } from "../events.js";
import { getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { Workspace } from "../models/Workspace.js";
import { beginRun, isRunning } from "../runs.js";
import { getSetting } from "../settings.js";
import { hasUncommitted } from "../workspaceFiles.js";
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
async function loadSetup(res: Response): Promise<Setup | null> {
  const [linear, openRouterKey, model] = await Promise.all([
    getLinearClient(),
    getKey("openrouter"),
    getSetting("coordinatorModel"),
  ]);
  const missing = (error: string) => {
    res.status(409).json({ error });
    return null;
  };
  if (!linear) return missing("Linear isn't connected");
  if (!openRouterKey) return missing("OpenRouter isn't connected");
  if (!model) return missing("No coordinator model set");
  return { linear, openRouterKey, model };
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

// Checks, and narrows, a reply to what the pipeline is waiting on.
function readReply(body: unknown): PipelineResume | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.answers) && b.answers.every((a) => typeof a === "string")) {
    return { answers: b.answers as string[] };
  }
  if (b.approve === true) return { approve: true };
  if (typeof b.feedback === "string" && b.feedback.trim()) return { feedback: b.feedback.trim() };
  return null;
}

// Tells every connected webapp that the pipeline changed.
const notify = (issueId: string) => sendEvent({ type: "coordinator.updated", issueId });

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

  const run = { setup, issueId, notify: () => notify(issueId) };
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
  const fits =
    (waiting?.kind === "questions" && "answers" in reply && reply.answers.length === waiting.questions.length) ||
    (waiting?.kind === "approve_plan" && !("answers" in reply)) ||
    (waiting?.kind === "feedback" && "feedback" in reply);
  if (!fits) {
    res.status(409).json({
      error: waiting ? "That reply doesn't fit what the pipeline is waiting on" : "The pipeline isn't waiting on you",
    });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = { setup, issueId, notify: () => notify(issueId) };
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
