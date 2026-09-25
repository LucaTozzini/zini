import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import type { Decision } from "shared";
import { getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { PmThread } from "../models/PmThread.js";
import { chat, deleteThreadHistory, loadThread, resume } from "../productManager.js";
import { broadcast, forgetRun, isRunning, runStatus, startRun, subscribe } from "../runs.js";
import { getSetting } from "../settings.js";

export const productManager = Router();

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

const isDecision = (d: unknown): d is Decision =>
  typeof d === "object" &&
  d !== null &&
  "type" in d &&
  (d.type === "approve" ||
    (d.type === "reject" && (!("message" in d) || typeof d.message === "string")));

// Everything the agent needs, or null after sending a 409 naming what's missing.
async function loadSetup(res: Response) {
  const [linear, openRouterKey, githubToken, model, repo] = await Promise.all([
    getLinearClient(),
    getKey("openrouter"),
    getKey("github"),
    getSetting("productManagerModel"),
    getSetting("githubRepo"),
  ]);
  const missing = (error: string) => {
    res.status(409).json({ error });
    return null;
  };
  if (!linear) return missing("Linear isn't connected");
  if (!openRouterKey) return missing("OpenRouter isn't connected");
  if (!githubToken) return missing("GitHub isn't connected");
  if (!model) return missing("No model set");
  if (!repo) return missing("No GitHub repository set");
  return { linear, openRouterKey, model, repo };
}

// The chat with this id, or null after sending a 404.
async function findThread(id: string, res: Response) {
  const thread = await PmThread.findByPk(id);
  if (!thread) res.status(404).json({ error: "Chat not found" });
  return thread;
}

const alreadyRunning = (res: Response) =>
  res.status(409).json({ error: "The product manager is still working on this chat" });

// Starts a run and waits until its input is saved; true then. Otherwise sends a 409
// (already running) or a 500 (the run failed before that) and returns false.
async function begin(res: Response, threadId: string, start: Parameters<typeof startRun>[1]) {
  try {
    if (await startRun(threadId, start)) return true;
    alreadyRunning(res);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
  return false;
}

// Server-sent events: { type: "thread.updated", threadId } whenever a chat changes
// (a run starts, finishes a step, ends or fails; a chat is created or deleted).
productManager.get("/events", (_req, res) => {
  subscribe(res);
});

// Newest first.
productManager.get("/threads", async (_req, res) => {
  const threads = await PmThread.findAll({
    attributes: ["id", "title", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
  res.json(
    threads.map(({ id, title, createdAt }) => ({ id, title, createdAt, running: isRunning(id) })),
  );
});

// Starts a chat with its first message, which also becomes its title, answering once
// the message is saved. The reply comes later: the run goes on in the background.
productManager.post("/threads", async (req, res) => {
  const { message } = req.body ?? {};
  if (!nonEmptyString(message)) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const setup = await loadSetup(res);
  if (!setup) return;

  const title = message.trim().replace(/\s+/g, " ").slice(0, 60);
  const thread = await PmThread.create({ id: randomUUID(), title });
  if (!(await begin(res, thread.id, () => chat(setup, thread.id, message)))) {
    // Nothing was saved in it, so don't leave an empty chat behind.
    await thread.destroy();
    forgetRun(thread.id);
    return;
  }
  res.status(201).json({ id: thread.id, title, createdAt: thread.createdAt, running: true });
});

productManager.get("/threads/:id", async (req, res) => {
  const thread = await findThread(req.params.id, res);
  if (!thread) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  res.json({
    id: thread.id,
    title: thread.title,
    ...(await loadThread(setup, thread.id)),
    ...runStatus(thread.id),
  });
});

// Sends a message, answering once it's saved; the agent's reply comes later, as the
// run goes on in the background.
productManager.post("/threads/:id/messages", async (req, res) => {
  const { message } = req.body ?? {};
  if (!nonEmptyString(message)) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (!(await findThread(req.params.id, res))) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  const id = req.params.id;
  if (await begin(res, id, () => chat(setup, id, message))) res.status(202).end();
});

// Approves or rejects the actions a thread is paused on, one decision per action.
// The run then carries on in the background.
productManager.post("/threads/:id/resume", async (req, res) => {
  const { decisions } = req.body ?? {};
  if (!Array.isArray(decisions) || !decisions.length || !decisions.every(isDecision)) {
    res.status(400).json({ error: "decisions must be a list of approve/reject decisions" });
    return;
  }
  if (!(await findThread(req.params.id, res))) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  const id = req.params.id;
  if (await begin(res, id, () => resume(setup, id, decisions))) res.status(202).end();
});

// Deletes the chat and its saved conversation. Doesn't need Linear or OpenRouter.
// Not while it's running, since the run would keep writing to it.
productManager.delete("/threads/:id", async (req, res) => {
  const thread = await findThread(req.params.id, res);
  if (!thread) return;
  if (isRunning(thread.id)) {
    alreadyRunning(res);
    return;
  }

  await deleteThreadHistory(thread.id);
  await thread.destroy();
  forgetRun(thread.id);
  broadcast(thread.id);
  res.status(204).end();
});
