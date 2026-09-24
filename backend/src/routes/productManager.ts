import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import type { Decision } from "shared";
import { getLinearClient } from "../linear.js";
import { getKey } from "../models/Integration.js";
import { PmThread } from "../models/PmThread.js";
import { chat, deleteThreadHistory, loadThread, resume } from "../productManager.js";
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
  const [linear, openRouterKey, model] = await Promise.all([
    getLinearClient(),
    getKey("openrouter"),
    getSetting("productManagerModel"),
  ]);
  const missing = (error: string) => {
    res.status(409).json({ error });
    return null;
  };
  if (!linear) return missing("Linear isn't connected");
  if (!openRouterKey) return missing("OpenRouter isn't connected");
  if (!model) return missing("No model set");
  return { linear, openRouterKey, model };
}

// The chat with this id, or null after sending a 404.
async function findThread(id: string, res: Response) {
  const thread = await PmThread.findByPk(id);
  if (!thread) res.status(404).json({ error: "Chat not found" });
  return thread;
}

// Newest first.
productManager.get("/threads", async (_req, res) => {
  const threads = await PmThread.findAll({
    attributes: ["id", "title", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
  res.json(threads);
});

// Starts a chat with its first message, which also becomes its title.
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
  const response = await chat(setup, thread.id, message);
  res.json({ id: thread.id, title, createdAt: thread.createdAt, ...response });
});

productManager.get("/threads/:id", async (req, res) => {
  const thread = await findThread(req.params.id, res);
  if (!thread) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  res.json({ id: thread.id, title: thread.title, ...(await loadThread(setup, thread.id)) });
});

productManager.post("/threads/:id/messages", async (req, res) => {
  const { message } = req.body ?? {};
  if (!nonEmptyString(message)) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (!(await findThread(req.params.id, res))) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  res.json(await chat(setup, req.params.id, message));
});

// Approves or rejects the actions a thread is paused on, one decision per action.
productManager.post("/threads/:id/resume", async (req, res) => {
  const { decisions } = req.body ?? {};
  if (!Array.isArray(decisions) || !decisions.length || !decisions.every(isDecision)) {
    res.status(400).json({ error: "decisions must be a list of approve/reject decisions" });
    return;
  }
  if (!(await findThread(req.params.id, res))) return;

  const setup = await loadSetup(res);
  if (!setup) return;
  res.json(await resume(setup, req.params.id, decisions));
});

// Deletes the chat and its saved conversation. Doesn't need Linear or OpenRouter.
productManager.delete("/threads/:id", async (req, res) => {
  const thread = await findThread(req.params.id, res);
  if (!thread) return;

  await deleteThreadHistory(thread.id);
  await thread.destroy();
  res.status(204).end();
});
