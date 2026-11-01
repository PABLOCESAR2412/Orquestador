import { db } from "./db";

// Preferencias de la app, guardadas como un solo documento JSON en app_settings.
export type Preferences = {
  defaultModel: string | null;
  defaultEffort: string | null;
  // Modelo de respaldo si el principal responde 429 o 5xx. Null: sin respaldo.
  fallbackModel: string | null;
  // Modelos probados en orden solo cuando el proveedor confirma que una cuota se agotó.
  quotaFallbackModels: string[];
  fallbackMode: "selected" | "configured" | "automatic";
  monthlyBudgetUsd: number | null;
  budgetAlertPercent: number;
  compartirContextoChats: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  defaultModel: null,
  defaultEffort: null,
  fallbackModel: null,
  quotaFallbackModels: [],
  fallbackMode: "selected",
  monthlyBudgetUsd: null,
  budgetAlertPercent: 80,
  compartirContextoChats: false,
};

const KEY = "preferences";

export function getPreferences(): Preferences {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key = ?")
    .get(KEY);
  if (!row) return { ...DEFAULT_PREFERENCES };
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Preferences) {
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, JSON.stringify(prefs));
}
