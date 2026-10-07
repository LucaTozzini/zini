import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Decision } from "shared";
import { getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { PmThread } from "../models/PmThread.js";
import { chat, deleteThreadHistory, loadThread, resume } from "../productManager.js";
import { sendEvent } from "../events.js";
import { alreadyRunning, beginRun, forgetRun, isRunning, runStatus, stopRun } from "../runs.js";
import { getSetting } from "../settings.js";
import { loadConnection } from "../modelProvider.js";

export const productManager = Router();

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// The sender's username, from the cookie their profile sets; null if they haven't set one.
const username = (req: Request): string | null =>
  nonEmptyString(req.cookies?.username) ? req.cookies.username : null;

const isDecision = (d: unknown): d is Decision =>
  typeof d === "object" &&
  d !== null &&
  "type" in d &&
  (d.type === "approve" ||
    (d.type === "reject" && (!("message" in d) || typeof d.message === "string")));

// Everything the agent needs, or null after sending a 409 naming what's missing.
async function loadSetup(res: Response) {
  const [linear, connection, githubToken, model, repo] = await Promise.all([
    getLinearClient(),
    getSetting("productManagerProvider").then(loadConnection),
    getKey("github"),
    getSetting("productManagerModel"),
    getSetting("githubRepo"),
  ]);
  const missing = (error: string) => {
    res.status(409).json({ error });
    return null;
  };
  if (!linear) return missing("Linear isn't connected");
  if (typeof connection === "string") return missing(connection);
  if (!githubToken) return missing("GitHub isn't connected");
  if (!model) return missing("No model set");
  if (!repo) return missing("No GitHub repository set");
  return { linear, connection, model, repo };
}

// The chat with this id, or null after sending a 404.
async function findThread(id: string, res: Response) {
  const thread = await PmThread.findByPk(id);
  if (!thread) res.status(404).json({ error: "Chat not found" });
  return thread;
}

// Tells every connected webapp that the chat changed.
const broadcast = (threadId: string) => sendEvent({ type: "thread.updated", threadId });

// Starts a run on the chat (see beginRun), sending its event as it goes. start is
// handed the run's signal, which stops the run in flight (see stopRun).
const begin = (res: Response, threadId: string, start: Parameters<typeof beginRun>[2]) =>
  beginRun(res, threadId, start, () => broadcast(threadId));

// Newest first.
productManager.get("/threads", async (_req, res) => {
  const threads = await PmThread.findAll({
    attributes: ["id", "title", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
  res.json(
    threads.map(({ id, title, createdAt }) => ({
      id,
      title,
      createdAt,
      running: isRunning(id),
    })),
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
  const start = (signal: AbortSignal) =>
    chat(setup, thread.id, message, username(req), signal);
  if (!(await begin(res, thread.id, start))) {
    // Nothing was saved in it, so don't leave an empty chat behind.
    await thread.destroy();
    forgetRun(thread.id);
    return;
  }
  res
    .status(201)
    .json({ id: thread.id, title, createdAt: thread.createdAt, running: true });
});

productManager.get("/threads/:id", async (req, res) => {
  const thread = await findThread(req.params.id, res);
  if (!thread) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  res.json({
    id: thread.id,
    title: thread.title,
    ...(await loadThread(setup, thread.id, isRunning(thread.id))),
    ...runStatus(thread.id),
  });
});

// Sends a message, answering once it's saved; the agent's reply comes later, as the
// run goes on in the background. A conversation with a run going on it answers 409:
// the client steers it instead (see /steer).
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
  if (await begin(res, id, (signal) => chat(setup, id, message, username(req), signal))) res.status(202).end();
});

// Stops the run going on the chat. It shows as stopped straight away, while the run
// unwinds in the background (see stopRun).
productManager.post("/threads/:id/stop", async (req, res) => {
  if (!(await findThread(req.params.id, res))) return;

  const id = req.params.id;
  if (!stopRun(id)) {
    res.status(409).json({ error: "The agent isn't working on this conversation" });
    return;
  }
  broadcast(id);
  res.status(202).end();
});

// Sends a message that redirects the agent while it's working: stops the run and starts
// a new one, seeded with the message, from the checkpoint the stopped run left.
productManager.post("/threads/:id/steer", async (req, res) => {
  const { message } = req.body ?? {};
  if (!nonEmptyString(message)) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (!(await findThread(req.params.id, res))) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  const id = req.params.id;
  // No event for the stop: one now would have the webapp refetch the chat before the
  // message is saved, dropping the message it already shows. Starting the run sends one
  // once it is. A run paused on approval has already ended, so steering that one is just
  // a new turn. Stopping frees the run at once, so this one starts while the stopped run
  // is still unwinding. Unlike /messages, which answers 409 while the agent works (which
  // guards a send from another tab), this is how the client sends one while it works.
  stopRun(id);
  if (await begin(res, id, (signal) => chat(setup, id, message, username(req), signal))) res.status(202).end();
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
  const start = (signal: AbortSignal) => resume(setup, id, decisions, signal);
  if (await begin(res, id, start)) res.status(202).end();
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
