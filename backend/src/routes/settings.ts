import { Router } from "express";
import { MODEL_PROVIDERS } from "shared";
import { cloneRepo } from "../repositories/git.js";
import { getKey } from "../models/Integration.js";
import { Workspace } from "../models/Workspace.js";
import { changeRepository, RepositoryChangeError } from "../repositories/changeRepository.js";
import { deleteWorkspace, isForgeRunning } from "../workspaces/workspaces.js";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import { DEVELOPMENT_CHANGES, developmentEnvironmentStatus, saveDevelopmentEnvironment } from "../core/developmentEnvironment.js";
import { parseEnv } from "node:util";
import {
  getSetting,
  getSettings,
  isOptionalSetting,
  isSettingKey,
  saveSettings,
  SETTING_KEYS,
  type SettingKey,
} from "../core/settings.js";

export const settings = Router();

settings.get("/development-environment", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (req.query.repository && req.query.repository !== repo) { res.status(409).json({ error: "Repository changed; reload Settings" }); return; }
  res.json(repo ? await developmentEnvironmentStatus(repo) : { repository: null, variables: [] });
});
settings.put("/development-environment", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (!repo) { res.status(400).json({ error: "Select a GitHub repository first" }); return; }
  const body = DEVELOPMENT_CHANGES.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Expected variable names and values, or explicit removals" }); return; }
  if (body.data.repository !== repo) { res.status(409).json({ error: "Repository changed; reload Settings" }); return; }
  try { await saveDevelopmentEnvironment(repo, body.data.variables); }
  catch { res.status(400).json({ error: "Could not save development variables. Check names, reserved runtime variables and value lengths." }); return; }
  res.json(await developmentEnvironmentStatus(repo));
});
settings.post("/development-environment/import", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (!repo || req.body?.repository !== repo) { res.status(409).json({ error: "Repository changed; reload Settings" }); return; }
  if (typeof req.body.content !== "string" || req.body.content.length > 80000) { res.status(400).json({ error: "Expected a .env file under 80 KB" }); return; }
  try {
    const variables = Object.entries(parseEnv(req.body.content)).map(([name, value]) => ({ name, value: value ?? "" }));
    if (!variables.length || variables.length > 100) throw new Error("Invalid variable count");
    await saveDevelopmentEnvironment(repo, variables);
  } catch { res.status(400).json({ error: "Could not import .env. Check variable names, reserved runtime variables and value lengths." }); return; }
  res.json(await developmentEnvironmentStatus(repo));
});

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
  let confirmWorkspaceDeletion = false;
  for (const [key, value] of Object.entries(body)) {
    if (key === "confirmWorkspaceDeletion") {
      if (typeof value !== "boolean") {
        res.status(400).json({ error: "confirmWorkspaceDeletion must be a boolean" });
        return;
      }
      confirmWorkspaceDeletion = value;
      continue;
    }
    if (!isSettingKey(key)) {
      res.status(400).json({ error: `Unknown setting "${key}". Known: ${SETTING_KEYS.join(", ")}` });
      return;
    }
    // Every setting is a string; only optional ones can be cleared with "".
    if (typeof value !== "string") {
      res.status(400).json({ error: `${key} must be a string` });
      return;
    }
    const trimmed = value.trim();
    if (!trimmed && !isOptionalSetting(key)) {
      res.status(400).json({ error: `${key} must be a non-empty string` });
      return;
    }
    changes[key] = trimmed;
  }

  for (const key of ["projectLeadProvider", "forgeProvider"] as const) {
    const provider = changes[key];
    if (provider && !(MODEL_PROVIDERS as readonly string[]).includes(provider)) {
      res.status(400).json({ error: `${key} must be one of ${MODEL_PROVIDERS.join(", ")}` });
      return;
    }
  }

  if (changes.conductorEnabled !== undefined && !["true", "false"].includes(changes.conductorEnabled)) {
    res.status(400).json({ error: 'conductorEnabled must be "true" or "false"' });
    return;
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
    try {
      await changeRepository(repo, confirmWorkspaceDeletion, {
        current: () => getSetting("githubRepo"),
        workspaces: async () => (await Workspace.findAll({ attributes: ["issueId"] })).map((row) => row.issueId),
        busy: (id) => isForgeRunning(id) || workspaceApps.starting(id),
        clone: cloneRepo,
        remove: deleteWorkspace,
        save: () => saveSettings(changes),
      });
    } catch (err) {
      if (err instanceof RepositoryChangeError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error(`Changing repository to ${repo} failed:`, err);
      res.status(400).json({ error: `Couldn't switch repository: ${err instanceof Error ? err.message : String(err)}. Workspaces already deleted cannot be restored.` });
      return;
    }
    res.json(await getSettings());
    return;
  }

  await saveSettings(changes);
  res.json(await getSettings());
});
