import { Router } from "express";
import { cloneRepo } from "../git.js";
import { getKey } from "../models/Integration.js";
import { Workspace } from "../models/Workspace.js";
import {
  getSetting,
  getSettings,
  isSettingKey,
  saveSettings,
  SETTING_KEYS,
  type SettingKey,
} from "../settings.js";

export const settings = Router();

settings.get("/", async (_req, res) => {
  res.json(await getSettings());
});

// Saves only the settings in the body; the rest stay as they are.
settings.put("/", async (req, res) => {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({ error: "Expected an object of settings" });
    return;
  }

  const changes: Partial<Record<SettingKey, string>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isSettingKey(key)) {
      res.status(400).json({ error: `Unknown setting "${key}". Known: ${SETTING_KEYS.join(", ")}` });
      return;
    }
    // Every setting is a non-empty string for now.
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      res.status(400).json({ error: `${key} must be a non-empty string` });
      return;
    }
    changes[key] = trimmed;
  }

  // The repo is only saved once it's cloned, which also checks the token can read it.
  if (changes.githubRepo) {
    const repo = changes.githubRepo;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      res.status(400).json({ error: "The repository must look like owner/name" });
      return;
    }
    if (!(await getKey("github"))) {
      res.status(400).json({ error: "Connect GitHub before setting the repository" });
      return;
    }
    // A different repo means a new clone, which would break every workspace's worktree.
    const current = await getSetting("githubRepo");
    if (current?.toLowerCase() !== repo.toLowerCase() && (await Workspace.count()) > 0) {
      res.status(400).json({ error: "Delete the workspaces before changing the repository" });
      return;
    }
    try {
      await cloneRepo(repo);
    } catch (err) {
      console.error(`Cloning ${repo} failed:`, err);
      res.status(400).json({
        error: `Couldn't clone ${repo}. Check the name, and that the GitHub token has access to it.`,
      });
      return;
    }
  }

  await saveSettings(changes);
  res.json(await getSettings());
});
