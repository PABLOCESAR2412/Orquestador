import { Hono } from "hono";
import { getPreferences, savePreferences, type Preferences } from "../preferences";
import { validateSelection } from "../models";

const ALLOWED_FIELDS = new Set([
  "defaultModel",
  "defaultEffort",
  "fallbackModel",
  "monthlyBudgetUsd",
  "budgetAlertPercent",
  "compartirContextoChats",
]);

export const preferences = new Hono();

// GET /api/preferences
preferences.get("/preferences", (c) => c.json(getPreferences()));

// PUT /api/preferences  body: parcial. Un campo omitido conserva su valor.
preferences.put("/preferences", async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const unknown = Object.keys(body).find((k) => !ALLOWED_FIELDS.has(k));
  if (unknown) return c.json({ error: "unknown_field", field: unknown }, 400);

  const next: Preferences = { ...getPreferences(), ...(body as Partial<Preferences>) };

  if (next.defaultModel !== null) {
    if (typeof next.defaultModel !== "string") return c.json({ error: "invalid_model" }, 400);
  }
  if (next.defaultEffort !== null && typeof next.defaultEffort !== "string") {
    return c.json({ error: "invalid_effort" }, 400);
  }
  if (next.defaultEffort && !next.defaultModel) {
    return c.json({ error: "effort_requires_model" }, 400);
  }
  if (next.defaultModel) {
    try {
      const check = await validateSelection(next.defaultModel, next.defaultEffort);
      if (!check.ok) return c.json({ error: check.error }, 400);
    } catch (err) {
      return c.json({ error: "models_unavailable", detail: String(err) }, 503);
    }
  }

  // El respaldo se valida solo si la petición lo trae: no bloquea guardar otros campos.
  if (body.fallbackModel !== undefined && next.fallbackModel !== null) {
    if (typeof next.fallbackModel !== "string" || !next.fallbackModel) {
      return c.json({ error: "invalid_model" }, 400);
    }
    try {
      const check = await validateSelection(next.fallbackModel, null);
      if (!check.ok) return c.json({ error: "invalid_model" }, 400);
    } catch (err) {
      return c.json({ error: "models_unavailable", detail: String(err) }, 503);
    }
  }

  const budget = next.monthlyBudgetUsd;
  if (budget !== null && (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0)) {
    return c.json({ error: "invalid_budget" }, 400);
  }

  const alert = next.budgetAlertPercent;
  if (!Number.isInteger(alert) || alert < 50 || alert > 100) {
    return c.json({ error: "invalid_alert_percent" }, 400);
  }

  if (typeof next.compartirContextoChats !== "boolean") {
    return c.json({ error: "invalid_body" }, 400);
  }

  savePreferences(next);
  return c.json(next);
});
