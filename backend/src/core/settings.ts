import { OPTIONAL_SETTINGS, type Settings } from "shared";
import { Setting } from "../models/Setting.js";

export type SettingKey = keyof Settings;
type SettingsChanges = Partial<Record<SettingKey, string>>;
const settingsListeners = new Set<(changes: SettingsChanges) => void>();

export function onSettingsSaved(listener: (changes: SettingsChanges) => void) {
  settingsListeners.add(listener);
  return () => { settingsListeners.delete(listener); };
}

// The settings that exist. Each is a row in the settings table once saved.
export const SETTING_KEYS: SettingKey[] = [
  "projectLeadProvider",
  "projectLeadModel",
  "forgeProvider",
  "forgeModel",
  "openwikiProvider",
  "openwikiModel",
  "githubRepo",
  "conductorEnabled",
];

export const isSettingKey = (key: string): key is SettingKey =>
  (SETTING_KEYS as string[]).includes(key);

export const isOptionalSetting = (key: SettingKey) =>
  (OPTIONAL_SETTINGS as readonly string[]).includes(key);

export async function getSetting(key: SettingKey) {
  const row = await Setting.findByPk(key);
  return row?.value ?? null;
}

export async function isConductorEnabled() {
  return (await getSetting("conductorEnabled")) !== "false";
}

export async function getSettings() {
  const rows = await Setting.findAll({ where: { key: SETTING_KEYS } });
  const settings = Object.fromEntries(SETTING_KEYS.map((key) => [key, null])) as Settings;
  for (const row of rows) settings[row.key as SettingKey] = row.value;
  return settings;
}

// An empty value clears the setting.
export async function saveSettings(changes: Partial<Record<SettingKey, string>>) {
  await Promise.all(
    Object.entries(changes).map(([key, value]) =>
      value ? Setting.upsert({ key, value }) : Setting.destroy({ where: { key } }),
    ),
  );
  for (const listener of settingsListeners) listener(changes);
}
