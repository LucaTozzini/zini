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
import { z } from "zod";
import { getSetting, getSettings, isOptionalSetting, saveSettings, SETTING_KEYS, type SettingKey } from "../core/settings.js";
import { errorMessage } from "../core/errors.js";
import { parse } from "./http.js";

export const settings = Router();

// Every setting is a string, trimmed; only optional ones can be cleared with "".
const setting = (key: SettingKey) =>
  isOptionalSetting(key)
    ? z.string({ error: `${key} must be a string` }).trim()
    : z
        .string({ error: `${key} must be a string` })
        .trim()
        .min(1, `${key} must be a non-empty string`);
const provider = (key: SettingKey) =>
  setting(key)
    .refine(
      (value) => !value || (MODEL_PROVIDERS as readonly string[]).includes(value),
      `${key} must be one of ${MODEL_PROVIDERS.join(", ")}`,
    )
    .optional();

// The settings to change, and (when changing the repository) whether to delete the old
// one's workspaces.
const settingsChange = z.strictObject(
  {
    ...(Object.fromEntries(SETTING_KEYS.map((key) => [key, setting(key).optional()])) as Record<
      SettingKey,
      z.ZodOptional<z.ZodString>
    >),
    projectLeadProvider: provider("projectLeadProvider"),
    forgeProvider: provider("forgeProvider"),
    openwikiProvider: provider("openwikiProvider"),
    conductorEnabled: z.enum(["true", "false"], { error: 'conductorEnabled must be "true" or "false"' }).optional(),
    githubRepo: setting("githubRepo")
      .refine((repo) => !repo || /^[\w.-]+\/[\w.-]+$/.test(repo), "The repository must look like owner/name")
      .optional(),
    confirmWorkspaceDeletion: z.boolean({ error: "confirmWorkspaceDeletion must be a boolean" }).default(false),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Unknown setting "${issue.keys[0]}". Known: ${SETTING_KEYS.join(", ")}`
        : "Expected an object of settings",
  },
);

settings.get("/development-environment", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (req.query.repository && req.query.repository !== repo) {
    res.status(409).json({ error: "Repository changed; reload Settings" });
    return;
  }
  res.json(repo ? await developmentEnvironmentStatus(repo) : { repository: null, variables: [] });
});
settings.put("/development-environment", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (!repo) {
    res.status(400).json({ error: "Select a GitHub repository first" });
    return;
  }
  const body = parse(DEVELOPMENT_CHANGES, req.body, res, "Expected variable names and values, or explicit removals");
  if (!body) return;
  if (body.repository !== repo) {
    res.status(409).json({ error: "Repository changed; reload Settings" });
    return;
  }
  try {
    await saveDevelopmentEnvironment(repo, body.variables);
  } catch {
    res
      .status(400)
      .json({ error: "Could not save development variables. Check names, reserved runtime variables and value lengths." });
    return;
  }
  res.json(await developmentEnvironmentStatus(repo));
});
settings.post("/development-environment/import", async (req, res) => {
  const repo = await getSetting("githubRepo");
  if (!repo || req.body?.repository !== repo) {
    res.status(409).json({ error: "Repository changed; reload Settings" });
    return;
  }
  const body = parse(z.object({ content: z.string().max(80000) }), req.body, res, "Expected a .env file under 80 KB");
  if (!body) return;
  try {
    const variables = Object.entries(parseEnv(body.content)).map(([name, value]) => ({ name, value: value ?? "" }));
    if (!variables.length || variables.length > 100) throw new Error("Invalid variable count");
    await saveDevelopmentEnvironment(repo, variables);
  } catch {
    res.status(400).json({ error: "Could not import .env. Check variable names, reserved runtime variables and value lengths." });
    return;
  }
  res.json(await developmentEnvironmentStatus(repo));
});

settings.get("/", async (_req, res) => {
  res.json(await getSettings());
});

// Saves only the settings in the body; the rest stay as they are.
settings.put("/", async (req, res) => {
  const body = parse(settingsChange, req.body, res);
  if (!body) return;
  const { confirmWorkspaceDeletion, ...changes } = body;

  // The repo is only saved once it's cloned, which also checks the token can read it.
  if (changes.githubRepo) {
    const repo = changes.githubRepo;
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
      res
        .status(400)
        .json({ error: `Couldn't switch repository: ${errorMessage(err)}. Workspaces already deleted cannot be restored.` });
      return;
    }
    res.json(await getSettings());
    return;
  }

  await saveSettings(changes);
  res.json(await getSettings());
});
