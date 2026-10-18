import { Router } from "express";
import { z } from "zod";
import { sendEvent } from "../core/events.js";
import { getServingStatus, hasServedWiki, refreshServingWorktree, searchWiki } from "./serving.js";
import { errorMessage } from "../core/errors.js";

// Serving/search routes for the repo's OpenWiki. Mounted at /api/openwiki alongside
// the generation routes (which live in routes.ts, owned separately).
export const openwikiServe = Router();

// Bring the served wiki up to the latest default branch.
openwikiServe.post("/refresh", async (_req, res) => {
  try {
    const { commit } = await refreshServingWorktree();
    sendEvent({ type: "openwiki.updated" });
    res.json({ commit });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// What the wiki is served from vs. what the bare clone has: the UI compares them to
// show whether the served wiki is stale.
openwikiServe.get("/serve-status", async (_req, res) => {
  res.json(await getServingStatus());
});

const searchBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

// Search-only Q&A over the served wiki: no model call, just ranked results.
openwikiServe.post("/search", async (req, res) => {
  const parsed = searchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Expected { query, limit? }" });
    return;
  }
  if (!hasServedWiki()) {
    res.status(404).json({ error: "No wiki available; generate documentation first" });
    return;
  }
  try {
    res.json(JSON.parse(await searchWiki(parsed.data.query, parsed.data.limit)));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});
