import { Hono } from "hono";
import { db } from "../db";
import { validateSelection } from "../models";
import { publicar } from "../bus";

type Row = { id: string; model: string | null; effort: string | null };
type Body = { model?: string | null; effort?: string | null; title?: string; pinned?: boolean };

export const settings = new Hono();
settings.get("/avisos-git", (c) => c.json(db.query(`SELECT a.id,a.conversation_id,a.action,a.state FROM repository_actions a WHERE a.state IN ('pending','failed','approved') AND a.conversation_id IS NOT NULL AND a.rowid IN (SELECT MAX(rowid) FROM repository_actions GROUP BY conversation_id,action) ORDER BY a.rowid DESC LIMIT 100`).all()));

// PATCH /api/conversations/:id  body: { model?, effort?, title?, pinned? }
// Un campo omitido conserva su valor actual; null lo borra (modelo o esfuerzo).
settings.patch("/conversations/:id", async (c) => {
  const id = c.req.param("id");
  const row = db
    .query<Row, [string]>("SELECT id, model, effort FROM conversations WHERE id = ?")
    .get(id);
  if (!row) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<Body>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid_request" }, 400);
  if (body.pinned !== undefined && typeof body.pinned !== "boolean") return c.json({ error: "invalid_request" }, 400);

  if (body.title !== undefined) {
    const titulo = typeof body.title === "string" ? body.title.trim() : "";
    if (!titulo || titulo.length > 80) return c.json({ error: "invalid_title" }, 400);
  }

  const cambiaConfiguracion = body.model !== undefined || body.effort !== undefined;
  let costWarning: string | null = null;
  let costTier: string | null = null;

  if (cambiaConfiguracion) {
    const model = body.model === undefined ? row.model : body.model;
    const effort = body.effort === undefined ? row.effort : body.effort;

    if (!model && effort) return c.json({ error: "effort_requires_model" }, 400);

    if (model) {
      const check = await validateSelection(model, effort);
      if (!check.ok) return c.json({ error: check.error }, 400);
      costWarning = check.info.costWarning;
      costTier = check.info.costTier;
    }
  }

  db.transaction(() => {
    if (body.title !== undefined) db.query("UPDATE conversations SET title = ? WHERE id = ?").run(body.title.trim(), id);
    if (body.pinned !== undefined) db.query("UPDATE conversations SET pinned_at = CASE WHEN ? THEN COALESCE(pinned_at, datetime('now')) ELSE NULL END WHERE id = ?").run(body.pinned ? 1 : 0, id);
    if (cambiaConfiguracion) db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ?").run(body.model === undefined ? row.model : body.model, body.effort === undefined ? row.effort : body.effort, id);
  })();
  if (cambiaConfiguracion) publicar({ tipo: "configuracion_chat", conversacion_id: id });

  const actual = db
    .query<{ id: string; title: string; model: string | null; effort: string | null; pinned_at: string | null }, [string]>(
      "SELECT id, title, model, effort, pinned_at FROM conversations WHERE id = ?",
    )
    .get(id);
  return c.json({ ...actual, costTier, costWarning });
});
