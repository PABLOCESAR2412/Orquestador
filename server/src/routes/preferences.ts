import { Hono } from "hono";
import { getPreferences, savePreferences, type Preferences } from "../preferences";
import { getModels, validateSelection } from "../models";

const ALLOWED_FIELDS = new Set([
  "modelVisibility",
  "defaultModel",
  "defaultEffort",
  "fallbackModel",
  "quotaFallbackModels",
  "fallbackMode",
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
  if (body.modelVisibility !== undefined && (!body.modelVisibility || Array.isArray(body.modelVisibility) || typeof body.modelVisibility !== "object" || Object.keys(body.modelVisibility).length > 3000 || Object.entries(body.modelVisibility).some(([id, visible]) => id.length > 200 || !id.includes("/") || typeof visible !== "boolean"))) {
    return c.json({ error: "invalid_body" }, 400);
  }
  if (!["selected", "configured", "automatic"].includes(next.fallbackMode)) return c.json({ error: "invalid_body" }, 400);

  if (next.defaultModel !== null) {
    if (typeof next.defaultModel !== "string") return c.json({ error: "invalid_model" }, 400);
  }
  if (next.defaultEffort !== null && typeof next.defaultEffort !== "string") {
    return c.json({ error: "invalid_effort" }, 400);
  }
  if (next.defaultEffort && !next.defaultModel) {
    return c.json({ error: "effort_requires_model" }, 400);
  }
  // Un modelo antiguo puede haber desaparecido del catálogo. No debe impedir guardar otros
  // ajustes; se valida cuando se cambia el modelo o su esfuerzo.
  if (next.defaultModel && (body.defaultModel !== undefined || body.defaultEffort !== undefined)) {
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

  if (body.quotaFallbackModels !== undefined) {
    if (!Array.isArray(body.quotaFallbackModels) || body.quotaFallbackModels.length > 20) {
      return c.json({ error: "invalid_quota_fallback_models" }, 400);
    }
    const ids = body.quotaFallbackModels;
    if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
      return c.json({ error: "invalid_quota_fallback_models" }, 400);
    }
    let catalogo;
    try {
      catalogo = await getModels();
    } catch (err) {
      return c.json({ error: "models_unavailable", detail: String(err) }, 503);
    }
    for (const id of ids as string[]) {
      const modelo = catalogo.find((item) => item.id === id);
      if (!modelo) return c.json({ error: "invalid_model" }, 400);
      // Los CLIs de sesión consumen su cupo propio y solo entran mediante esta elección explícita.
      if (!modelo.free && !["codex", "antigravity"].includes(modelo.provider)) return c.json({ error: "quota_fallback_requires_free_model" }, 400);
    }
    next.quotaFallbackModels = ids as string[];
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
