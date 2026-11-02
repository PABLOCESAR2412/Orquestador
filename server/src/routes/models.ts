import { Hono } from "hono";
import { getModels } from "../models";
import { obtenerIndiceArtificial } from "../artificial-analysis";
import { db } from "../db";
import { getPreferences } from "../preferences";

export const modelsRoute = new Hono();

// Datos públicos del índice de Artificial Analysis. La clave solo vive en el servidor.
modelsRoute.get("/models/intelligence", async (c) => c.json(await obtenerIndiceArtificial()));

// Conteo de respuestas reales por modelo: permite priorizar lo que más se usa en este servidor.
modelsRoute.get("/models/usage", (c) => {
  const rows = db.query<{ model: string; total: number }, []>(
    "SELECT model, COUNT(*) AS total FROM messages WHERE role='assistant' AND model IS NOT NULL GROUP BY model",
  ).all();
  return c.json({ counts: Object.fromEntries(rows.map((row) => [row.model, row.total])) });
});

// GET /api/models            -> modelos recomendados
// GET /api/models?all=1      -> catálogo completo
// GET /api/models?refresh=1  -> fuerza la actualización desde OpenCode
modelsRoute.get("/models", async (c) => {
  try {
    const visibility = getPreferences().modelVisibility;
    const all = (await getModels(c.req.query("refresh") === "1")).map(model => ({ ...model, recommended: visibility[model.id] ?? model.recommended }));
    const models = c.req.query("all") === "1" ? all : all.filter((m) => m.recommended);
    return c.json({ models, total: all.length });
  } catch (err) {
    return c.json({ error: "models_unavailable", detail: String(err) }, 503);
  }
});
