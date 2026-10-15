import { Router } from "express";
import { z } from "zod";
import { getScanStatus, startScan } from "./generation.js";
import { REPO_DIR, git } from "../repositories/git.js";

export const openwiki = Router();

openwiki.post("/scan", async (_req, res) => {
  const r = await startScan();
  if (!r.started) {
    res.status(409).json({ error: r.error });
    return;
  }
  res.status(202).json({ started: true });
});

openwiki.get("/status", (_req, res) => {
  res.json(getScanStatus());
});

async function hasWiki() {
  try {
    await git(["-C", REPO_DIR, "cat-file", "-e", "origin/HEAD:openwiki"]);
    return true;
  } catch {
    return false;
  }
}

// Wiki page paths on the default branch, without the openwiki/ prefix.
openwiki.get("/pages", async (_req, res) => {
  if (!(await hasWiki())) {
    res.status(404).json({ error: "No wiki generated yet" });
    return;
  }
  const out = await git(["-C", REPO_DIR, "ls-tree", "-r", "--name-only", "origin/HEAD", "openwiki/"]);
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

// Raw markdown of one wiki page.
openwiki.get("/pages/*splat", async (req, res) => {
  const parsed = pagePath.safeParse(req.params.splat);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid page path" });
    return;
  }
  try {
    const content = await git(["-C", REPO_DIR, "show", `origin/HEAD:openwiki/${parsed.data}`]);
    res.type("text/markdown").send(content);
  } catch {
    res.status(404).json({ error: "Page not found" });
  }
});
