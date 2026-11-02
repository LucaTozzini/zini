import { Router } from "express";
import { z } from "zod";
import { findDocsPullRequest, getScanStatus, startScan } from "./generation.js";
import { refreshServingWorktree } from "./serving.js";
import { readLatestScanLog } from "./scanLog.js";
import { git } from "../repositories/git.js";
import { repoDir } from "../projects/projects.js";
import { currentProject } from "../routes/http.js";
import { errorMessage } from "../core/errors.js";

// The project's OpenWiki, at /api/projects/:projectId/openwiki.
export const openwiki = Router();

openwiki.post("/scan", async (_req, res) => {
  const r = await startScan(currentProject(res));
  if (!r.started) {
    res.status(409).json({ error: r.error });
    return;
  }
  res.status(202).json({ started: true });
});

openwiki.get("/status", (_req, res) => {
  res.json(getScanStatus(currentProject(res)));
});

// The docs pull request, so the page can say one is waiting to be merged. Once it's
// merged, pulls the latest default branch (refreshed: true), so the wiki shows up.
openwiki.post("/sync", async (_req, res) => {
  const project = currentProject(res);
  try {
    const pullRequest = await findDocsPullRequest(project);
    if (pullRequest?.state === "merged") await refreshServingWorktree(project);
    res.json({ pullRequest, refreshed: pullRequest?.state === "merged" });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// The latest scan's log, oldest first (see scanLog.ts).
openwiki.get("/log", async (_req, res) => {
  const log = await readLatestScanLog(currentProject(res));
  if (!log) {
    res.status(404).json({ error: "No scan has run yet" });
    return;
  }
  res.json(log);
});

async function hasWiki(projectId: number) {
  try {
    await git(["-C", repoDir(projectId), "cat-file", "-e", "origin/HEAD:openwiki"]);
    return true;
  } catch {
    return false;
  }
}

// Wiki page paths on the default branch, without the openwiki/ prefix.
openwiki.get("/pages", async (_req, res) => {
  const { id } = currentProject(res);
  if (!(await hasWiki(id))) {
    res.status(404).json({ error: "No wiki generated yet" });
    return;
  }
  const out = await git(["-C", repoDir(id), "ls-tree", "-r", "--name-only", "origin/HEAD", "openwiki/"]);
  const pages = out
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/^openwiki\//, ""));
  res.json({ pages });
});

const pagePath = z
  .string()
  .min(1)
  .refine((p) => !p.includes("..") && !p.startsWith("/") && !p.includes("\\"), "Invalid page path");

// Raw markdown of one wiki page. Express 5 passes the splat as its path segments.
openwiki.get("/pages/*splat", async (req, res) => {
  const parsed = pagePath.safeParse([req.params.splat].flat().join("/"));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid page path" });
    return;
  }
  try {
    const content = await git(["-C", repoDir(currentProject(res).id), "show", `origin/HEAD:openwiki/${parsed.data}`]);
    res.type("text/markdown").send(content);
  } catch {
    res.status(404).json({ error: "Page not found" });
  }
});
