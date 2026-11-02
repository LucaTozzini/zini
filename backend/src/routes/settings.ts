import { Router } from "express";
import { MODEL_PROVIDERS } from "shared";
import { z } from "zod";
import { getSettings, isOptionalSetting, saveSettings, SETTING_KEYS, type SettingKey } from "../core/settings.js";
import { parse } from "./http.js";

// The settings every project shares: which model each agent uses, and where it runs.
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

// The settings to change.
const settingsChange = z.strictObject(
  {
    ...(Object.fromEntries(SETTING_KEYS.map((key) => [key, setting(key).optional()])) as Record<
      SettingKey,
      z.ZodOptional<z.ZodString>
    >),
    projectLeadProvider: provider("projectLeadProvider"),
    forgeProvider: provider("forgeProvider"),
    openwikiProvider: provider("openwikiProvider"),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Unknown setting "${issue.keys[0]}". Known: ${SETTING_KEYS.join(", ")}`
        : "Expected an object of settings",
  },
);

settings.get("/", async (_req, res) => {
  res.json(await getSettings());
});

// Saves only the settings in the body; the rest stay as they are.
settings.put("/", async (req, res) => {
  const changes = parse(settingsChange, req.body, res);
  if (!changes) return;
  await saveSettings(changes);
  res.json(await getSettings());
});
