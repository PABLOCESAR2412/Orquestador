import { Hono } from "hono";
import { db } from "../db";
import { validateSelection } from "../models";

type Row = { id: string; model: string | null; effort: string | null };
type Body = { model?: string | null; effort?: string | null };

export const settings = new Hono();

// PATCH /api/conversations/:id  body: { model, effort }
// Un campo omitido conserva su valor actual; null lo borra.
settings.patch("/conversations/:id", async (c) => {
  const id = c.req.param("id");
  const row = db
    .query<Row, [string]>("SELECT id, model, effort FROM conversations WHERE id = ?")
    .get(id);
  if (!row) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const model = body.model === undefined ? row.model : body.model;
  const effort = body.effort === undefined ? row.effort : body.effort;

  if (!model && effort) return c.json({ error: "effort_requires_model" }, 400);

  let costWarning: string | null = null;
  let costTier: string | null = null;
  if (model) {
    const check = await validateSelection(model, effort);
    if (!check.ok) return c.json({ error: check.error }, 400);
    costWarning = check.info.costWarning;
    costTier = check.info.costTier;
  }

  db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ?").run(model, effort, id);

  return c.json({ id, model, effort, costTier, costWarning });
});
