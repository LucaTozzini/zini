import type { Settings } from "shared";
import { Setting } from "./models/Setting.js";

export type SettingKey = keyof Settings;

// The settings that exist. Each is a row in the settings table once saved.
export const SETTING_KEYS: SettingKey[] = ["productManagerModel"];

export const isSettingKey = (key: string): key is SettingKey =>
  (SETTING_KEYS as string[]).includes(key);

export async function getSetting(key: SettingKey) {
  const row = await Setting.findByPk(key);
  return row?.value ?? null;
}

export async function getSettings() {
  const rows = await Setting.findAll({ where: { key: SETTING_KEYS } });
  const settings = Object.fromEntries(SETTING_KEYS.map((key) => [key, null])) as Settings;
  for (const row of rows) settings[row.key as SettingKey] = row.value;
  return settings;
}

export async function saveSettings(changes: Partial<Record<SettingKey, string>>) {
  await Promise.all(
    Object.entries(changes).map(([key, value]) => Setting.upsert({ key, value })),
  );
}
