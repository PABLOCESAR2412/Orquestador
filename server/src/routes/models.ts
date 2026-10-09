import { Hono } from "hono";
import { getModels } from "../models";

export const modelsRoute = new Hono();

// GET /api/models            -> modelos recomendados
// GET /api/models?all=1      -> catálogo completo
// GET /api/models?refresh=1  -> fuerza la actualización desde OpenCode
modelsRoute.get("/models", async (c) => {
  try {
    const all = await getModels(c.req.query("refresh") === "1");
    const models = c.req.query("all") === "1" ? all : all.filter((m) => m.recommended);
    return c.json({ models, total: all.length });
  } catch (err) {
    return c.json({ error: "models_unavailable", detail: String(err) }, 503);
  }
});
