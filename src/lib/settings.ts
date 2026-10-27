import { query } from "./db";

export type Settings = {
  company_cooldown_days: number;
  duplicate_scope: "profile" | "global";
};

const DEFAULT_SETTINGS: Settings = {
  company_cooldown_days: 30,
  duplicate_scope: "profile",
};

export async function getSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const settings = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const row of rows) if (row.key in settings) settings[row.key] = row.value;
  return settings as Settings;
}
