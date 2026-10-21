import { Router, type Response } from "express";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import {
  forgeThreadId,
  continueForge,
  getForge,
  getForgeMessages,
  getToolResult,
  loadSetup as loadForgeSetup,
  messageForge,
  pendingApprovals,
  forgeRun,
  approvePlan,
  planApprovalError,
  readReply,
  replyFits,
  resumeForge,
  startForge,
} from "../forge/forge.js";
import { addViewer } from "../browser/agentBrowser.js";
import { listRunLogs, readRunLog } from "../forge/runLog.js";
import { Workspace } from "../models/Workspace.js";
import { beginRun, pauseRun } from "../agents/runs.js";
import { notifyForge } from "../forge/run.js";
import { messageInput } from "../projectLead/messageInput.js";
import { z } from "zod";
import { checkIssueId, parse } from "./http.js";

// An issue's Forge, at /api/forge/:issueId (see forge.ts).
export const forge = Router();
forge.param("issueId", checkIssueId);

const messagesQuery = z.object({
  agent: z.enum(["lead", "coder", "reviewer"], { error: "agent must be lead, coder or reviewer" }).default("lead"),
  delegation: z
    .string()
    .regex(/^[\w-]{1,200}$/, "Invalid delegation")
    .optional(),
});

// What the Forge needs to run, or null after sending a 409 naming what's missing.
async function loadSetup(res: Response) {
  const setup = await loadForgeSetup();
  if (typeof setup !== "string") return setup;
  res.status(409).json({ error: setup });
  return null;
}

// The Forge needs a checkout; environment preparation happens in the Forge.
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

// The issues whose Forge is waiting for an approval. Before /:issueId, which would
// otherwise take "approvals" for an issue id.
forge.get("/approvals", async (_req, res) => {
  res.json(await pendingApprovals());
});

forge.get("/:issueId", async (req, res) => {
  const { issueId } = req.params;
  res.json(await getForge(issueId));
});

// The Lead's conversation, or with ?agent=coder|reviewer&delegation=<call id>, that
// worker's run for the Lead's call.
forge.get("/:issueId/messages", async (req, res) => {
  const { issueId } = req.params;
  const query = parse(messagesQuery, req.query, res);
  if (!query) return;
  const { agent, delegation } = query;
  res.json(await getForgeMessages(issueId, agent, delegation));
});

// One tool call's result in that conversation, as { result }: the feed leaves them out.
forge.get("/:issueId/messages/:callId/result", async (req, res) => {
  const query = parse(messagesQuery, req.query, res);
  if (!query) return;
  if (!/^[\w-]{1,200}$/.test(req.params.callId)) {
    res.status(400).json({ error: "Invalid call id" });
    return;
  }
  const result = await getToolResult(req.params.issueId, query.agent, query.delegation, req.params.callId);
  if (result === undefined) res.status(404).json({ error: "That call has no result" });
  else res.json({ result });
});

// Starts the Forge, with an optional note for the Lead. Answers once it's started;
// the Lead works in the background.
forge.post("/:issueId/start", async (req, res) => {
  const { issueId } = req.params;
  const body = parse(z.object({ note: z.string({ error: "note must be a string" }).trim().default("") }), req.body, res);
  if (!body) return;
  if (!(await requireWorkspace(issueId, res))) return;
  if ((await getForge(issueId)).started) {
    res.status(409).json({ error: "The Forge has already started" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = forgeRun(setup, issueId, req.user!.username);
  const started = await beginRun(res, forgeThreadId(issueId), (signal) => startForge(run, body.note, signal), run.notify);
  if (started) res.status(202).end();
});

// Answers the Lead's questions: { answers }, one per question in order. Feedback on the
// plan, and other messages, use /message.
forge.post("/:issueId/resume", async (req, res) => {
  const { issueId } = req.params;
  const reply = readReply(req.body);
  if (!reply) {
    res.status(400).json({ error: "Expected { answers }" });
    return;
  }
  if (!(await requireWorkspace(issueId, res))) return;

  const { waiting } = await getForge(issueId);
  if (!replyFits(waiting, reply)) {
    res.status(409).json({
      error: waiting ? "That reply doesn't fit what the Forge is waiting on" : "The Forge isn't waiting on you",
    });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = forgeRun(setup, issueId, req.user!.username);
  const started = await beginRun(res, forgeThreadId(issueId), (signal) => resumeForge(run, reply, signal), run.notify);
  if (started) res.status(202).end();
});

// Approves the plan revision the user reviewed ({ revision }), and starts the Lead on it.
forge.post("/:issueId/approve-plan", async (req, res) => {
  const { issueId } = req.params;
  const body = parse(z.object({ revision: z.number().int().positive() }), req.body, res, "Expected { revision }");
  if (!body) return;
  if (!(await requireWorkspace(issueId, res))) return;
  const error = await planApprovalError(issueId, body.revision);
  if (error) {
    res.status(409).json({ error });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;

  const run = forgeRun(setup, issueId, req.user!.username);
  const started = await beginRun(res, forgeThreadId(issueId), (signal) => approvePlan(run, body.revision, signal), run.notify);
  if (started) res.status(202).end();
});

// Manual recovery only. Human approval/answer pauses still use /resume above.
forge.post("/:issueId/continue", async (req, res) => {
  const { issueId } = req.params;
  if (!(await requireWorkspace(issueId, res))) return;
  if (!(await getForge(issueId)).canResume) {
    res.status(409).json({ error: "The Forge has no interrupted work to resume" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;
  const run = forgeRun(setup, issueId, req.user!.username);
  if (await beginRun(res, forgeThreadId(issueId), (signal) => continueForge(run, signal), run.notify)) res.status(202).end();
});

// Sends the Lead a message ({ message, images? }), e.g. changes to make after it
// finished. Not while it's working or waiting on a reply (see /resume).
forge.post("/:issueId/message", async (req, res) => {
  const { issueId } = req.params;
  const input = parse(messageInput, req.body, res);
  if (!input) return;
  if (!(await requireWorkspace(issueId, res))) return;
  const state = await getForge(issueId);
  if (!state.started) {
    res.status(409).json({ error: "Start the Forge first" });
    return;
  }
  if (state.waiting) {
    res.status(409).json({ error: "The Forge is waiting on your reply" });
    return;
  }
  const setup = await loadSetup(res);
  if (!setup) return;
  const run = forgeRun(setup, issueId, req.user!.username);
  if (
    await beginRun(
      res,
      forgeThreadId(issueId),
      (signal) => messageForge(run, input.message.trim(), signal, input.images),
      run.notify,
    )
  )
    res.status(202).end();
});

forge.post("/:issueId/pause", async (req, res) => {
  const { issueId } = req.params;
  if (!pauseRun(forgeThreadId(issueId))) {
    res.status(409).json({ error: "The Forge isn't running or is already pausing" });
    return;
  }
  notifyForge(issueId);
  res.status(202).end();
});

// The Reviewer's browser, live, as MJPEG (an <img> shows it), while it's open; 404 when
// it isn't. Ends when the browser closes.
forge.get("/:issueId/browser", async (req, res) => {
  const { issueId } = req.params;
  if (!(await addViewer(issueId, res))) res.status(404).json({ error: "The Reviewer's browser isn't open" });
});

// The issue's agent runs, oldest first, for inspecting their logs (see runLog.ts).
forge.get("/:issueId/logs", async (req, res) => {
  const { issueId } = req.params;
  res.json(await listRunLogs(issueId));
});

// One run's log. Each line added sends a forge.log event.
forge.get("/:issueId/logs/:runId", async (req, res) => {
  const { issueId } = req.params;
  const log = await readRunLog(issueId, req.params.runId);
  if (!log) {
    res.status(404).json({ error: "No such run" });
    return;
  }
  res.json(log);
});
