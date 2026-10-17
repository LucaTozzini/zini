import { Router, type Response } from "express";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import {
  forgeThreadId,
  continuePipeline,
  getPipeline,
  getPipelineMessages,
  loadSetup as loadPipelineSetup,
  messagePipeline,
  pendingApprovals,
  pipelineRun,
  readReply,
  replyFits,
  resumePipeline,
  startPipeline,
} from "../forge/forge.js";
import { addViewer } from "../browser/agentBrowser.js";
import { listRunLogs, readRunLog } from "../forge/runLog.js";
import { Workspace } from "../models/Workspace.js";
import { beginRun, pauseRun } from "../agents/runs.js";
import { sendEvent } from "../core/events.js";
import { isIssueId } from "../workspaces/workspaces.js";
import { parseMessageInput } from "../projectLead/messageInput.js";

// An issue's Forge, at /api/forge/:issueId (see forge.ts).
export const forge = Router();

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

// The pipeline needs a checkout; environment preparation happens in the pipeline.
async function requireWorkspace(issueId: string, res: Response) {
  if (workspaceApps.starting(issueId)) {
    res.status(409).json({ error: "The user app is still being prepared" });
    return false;
  }
  const workspace = await Workspace.findByPk(issueId);
  if (!workspace) {
    res.status(404).json({ error: "This issue has no workspace" });
    return false;
  }
  return true;
}

// The issues whose pipeline is waiting for an approval. Before /:issueId, which would
// otherwise take "approvals" for an issue id.
forge.get("/approvals", async (_req, res) => {
  res.json(await pendingApprovals());
});

forge.get("/:issueId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  res.json(await getPipeline(issueId));
});

// The Lead's conversation, or with ?agent=coder|reviewer, that worker's.
forge.get("/:issueId/messages", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const agent = req.query.agent ?? "lead";
  if (agent !== "lead" && agent !== "coder" && agent !== "reviewer") {
    res.status(400).json({ error: "agent must be lead, coder or reviewer" });
    return;
  }
  res.json(await getPipelineMessages(issueId, agent));
});

// Starts the Forge, with an optional note for the Lead. Answers once it's started;
// the Lead works in the background.
forge.post("/:issueId/start", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const { note } = req.body ?? {};
  if (note !== undefined && typeof note !== "string") {
    res.status(400).json({ error: "note must be a string" });
    return;
  }
  if (!(await requireWorkspace(issueId, res))) return;
  if ((await getPipeline(issueId)).started) {
    res.status(409).json({ error: "The pipeline has already started" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = pipelineRun(setup, issueId, req.user!.username);
  const started = await beginRun(
    res,
    forgeThreadId(issueId),
    (signal) => startPipeline(run, (note ?? "").trim(), signal),
    run.notify,
  );
  if (started) res.status(202).end();
});

// Replies to what the Forge is waiting on: { answers } to questions, or { approve: true }
// or { feedback } on the plan. Other messages use /message.
forge.post("/:issueId/resume", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const reply = readReply(req.body);
  if (!reply) {
    res.status(400).json({ error: "Expected { answers }, { approve: true } or { feedback }" });
    return;
  }
  if (!(await requireWorkspace(issueId, res))) return;

  const { waiting } = await getPipeline(issueId);
  if (!replyFits(waiting, reply)) {
    res.status(409).json({
      error: waiting ? "That reply doesn't fit what the pipeline is waiting on" : "The pipeline isn't waiting on you",
    });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = pipelineRun(setup, issueId, req.user!.username);
  const started = await beginRun(res, forgeThreadId(issueId), (signal) => resumePipeline(run, reply, signal), run.notify);
  if (started) res.status(202).end();
});

// Manual recovery only. Human approval/answer pauses still use /resume above.
forge.post("/:issueId/continue", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId || !(await requireWorkspace(issueId, res))) return;
  if (!(await getPipeline(issueId)).canResume) {
    res.status(409).json({ error: "The pipeline has no interrupted work to resume" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;
  const run = pipelineRun(setup, issueId, req.user!.username);
  if (await beginRun(res, forgeThreadId(issueId), (signal) => continuePipeline(run, signal), run.notify)) res.status(202).end();
});

// Sends the Lead a message ({ message, images? }), e.g. changes to make after it
// finished. Not while it's working or waiting on a reply (see /resume).
forge.post("/:issueId/message", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  let input;
  try { input = parseMessageInput(req.body); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); return; }
  if (!await requireWorkspace(issueId, res)) return;
  const pipeline = await getPipeline(issueId);
  if (!pipeline.started) { res.status(409).json({ error: "Start the Forge first" }); return; }
  if (pipeline.waiting) { res.status(409).json({ error: "The Forge is waiting on your reply" }); return; }
  const setup = await loadSetup(res);
  if (!setup) return;
  const run = pipelineRun(setup, issueId, req.user!.username);
  if (await beginRun(res, forgeThreadId(issueId), (signal) => messagePipeline(run, input.message.trim(), signal, input.images), run.notify)) res.status(202).end();
});

forge.post("/:issueId/pause", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (!pauseRun(forgeThreadId(issueId))) {
    res.status(409).json({ error: "The Forge isn't running or is already pausing" });
    return;
  }
  sendEvent({ type: "forge.updated", issueId });
  res.status(202).end();
});

// The Reviewer's browser, live, as MJPEG (an <img> shows it), while it's open; 404 when
// it isn't. Ends when the browser closes.
forge.get("/:issueId/browser", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  if (!(await addViewer(issueId, res))) res.status(404).json({ error: "The Reviewer's browser isn't open" });
});

// The issue's agent runs, oldest first, for inspecting their logs (see runLog.ts).
forge.get("/:issueId/logs", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  res.json(await listRunLogs(issueId));
});

// One run's log. Each line added sends a forge.log event.
forge.get("/:issueId/logs/:runId", async (req, res) => {
  const issueId = readIssueId(req.params.issueId, res);
  if (!issueId) return;
  const log = await readRunLog(issueId, req.params.runId);
  if (!log) {
    res.status(404).json({ error: "No such run" });
    return;
  }
  res.json(log);
});
