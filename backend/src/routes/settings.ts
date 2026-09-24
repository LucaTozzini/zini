import { Router } from "express";
import { getSettings, isSettingKey, saveSettings, SETTING_KEYS, type SettingKey } from "../settings.js";

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

  await saveSettings(changes);
  res.json(await getSettings());
});
