import { Hono } from "hono";
import { db } from "../db";
import { validateSelection } from "../models";
import { publicar } from "../bus";

type RolTrabajador = "arquitectura" | "seguridad" | "verificacion";
type Trabajador = { model: string; rol: RolTrabajador };
type Row = { id: string; model: string | null; effort: string | null; orquestacion_habilitada: number; orquestacion_modelos_personalizados: number; orquestacion_seleccion_automatica: number; orquestacion_trabajadores: string };
type Body = {
  model?: string | null;
  effort?: string | null;
  title?: string;
  apodo_oficina?: string | null;
  pinned?: boolean;
  work_mode?: "plan" | "build";
  orquestacion_habilitada?: boolean;
  orquestacion_modelos_personalizados?: boolean;
  orquestacion_seleccion_automatica?: boolean;
  orquestacion_trabajadores?: Trabajador[];
};

export const settings = new Hono();
settings.get("/avisos-git", (c) => c.json(db.query(`SELECT a.id,a.conversation_id,a.action,a.state FROM repository_actions a WHERE a.state IN ('pending','failed','approved') AND a.conversation_id IS NOT NULL AND a.rowid IN (SELECT MAX(rowid) FROM repository_actions GROUP BY conversation_id,action) ORDER BY a.rowid DESC LIMIT 100`).all()));

// PATCH /api/conversations/:id  body: { model?, effort?, title?, pinned? }
// Un campo omitido conserva su valor actual; null lo borra (modelo o esfuerzo).
settings.patch("/conversations/:id", async (c) => {
  const id = c.req.param("id");
  const row = db
    .query<Row, [string]>("SELECT id, model, effort, orquestacion_habilitada, orquestacion_modelos_personalizados, orquestacion_seleccion_automatica, orquestacion_trabajadores FROM conversations WHERE id = ?")
    .get(id);
  if (!row) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<Body>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid_request" }, 400);
  if (body.work_mode !== undefined && body.work_mode !== "plan" && body.work_mode !== "build") return c.json({ error: "invalid_request" }, 400);
  if (body.pinned !== undefined && typeof body.pinned !== "boolean") return c.json({ error: "invalid_request" }, 400);
  if (body.orquestacion_habilitada !== undefined && typeof body.orquestacion_habilitada !== "boolean") return c.json({ error: "invalid_request" }, 400);
  if (body.orquestacion_modelos_personalizados !== undefined && typeof body.orquestacion_modelos_personalizados !== "boolean") return c.json({ error: "invalid_request" }, 400);
  if (body.orquestacion_seleccion_automatica !== undefined && typeof body.orquestacion_seleccion_automatica !== "boolean") return c.json({ error: "invalid_request" }, 400);

  if (body.title !== undefined) {
    const titulo = typeof body.title === "string" ? body.title.trim() : "";
    if (!titulo || titulo.length > 80) return c.json({ error: "invalid_title" }, 400);
  }
  if (body.apodo_oficina != null && (typeof body.apodo_oficina !== "string" || body.apodo_oficina.trim().length > 60)) {
    return c.json({ error: "invalid_office_alias" }, 400);
  }

  const cambiaConfiguracion = body.model !== undefined || body.effort !== undefined;
  const cambiaOrquestacion = body.orquestacion_modelos_personalizados !== undefined || body.orquestacion_habilitada !== undefined || body.orquestacion_seleccion_automatica !== undefined || body.orquestacion_trabajadores !== undefined;
  if (body.orquestacion_trabajadores !== undefined) {
    const trabajadores = body.orquestacion_trabajadores;
    const roles = new Set<RolTrabajador>(["arquitectura", "seguridad", "verificacion"]);
    if (!Array.isArray(trabajadores) || trabajadores.length > 3 || trabajadores.some((t) =>
      !t || typeof t !== "object" || Array.isArray(t) || typeof t.model !== "string" || !t.model.trim() || t.model.length > 200 || !roles.has(t.rol),
    )) return c.json({ error: "invalid_orchestration_workers" }, 400);
    if (new Set(trabajadores.map((t) => t.model)).size !== trabajadores.length) return c.json({ error: "duplicate_orchestration_worker" }, 400);
  }
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

  if (cambiaOrquestacion) {
    let trabajadoresActuales: Trabajador[] = [];
    try { trabajadoresActuales = JSON.parse(row.orquestacion_trabajadores); } catch {}
    const trabajadores = body.orquestacion_trabajadores ?? trabajadoresActuales;
    const habilitada = body.orquestacion_habilitada ?? Boolean(row.orquestacion_habilitada);
    const personalizados = body.orquestacion_modelos_personalizados ?? Boolean(row.orquestacion_modelos_personalizados);
    const modeloCoordinador = body.model === undefined ? row.model : body.model;
    if (habilitada && !modeloCoordinador) return c.json({ error: "orchestration_requires_coordinator" }, 400);
    if (habilitada && personalizados && trabajadores.some((trabajador) => trabajador.model === modeloCoordinador)) return c.json({ error: "orchestration_coordinator_cannot_be_worker" }, 400);
    const validarModelos = personalizados || (body.orquestacion_modelos_personalizados === undefined && body.orquestacion_trabajadores !== undefined);
    for (const trabajador of validarModelos ? trabajadores : []) {
      const check = await validateSelection(trabajador.model, null);
      if (!check.ok) return c.json({ error: "invalid_orchestration_model", model: trabajador.model }, 400);
    }
  }

  db.transaction(() => {
    if (body.work_mode !== undefined) db.query("UPDATE conversations SET work_mode=? WHERE id=?").run(body.work_mode, id);
    if (body.title !== undefined) db.query("UPDATE conversations SET title = ? WHERE id = ?").run(body.title.trim(), id);
    if (body.apodo_oficina !== undefined) db.query("UPDATE conversations SET apodo_oficina=? WHERE id=?").run(body.apodo_oficina?.trim() || null, id);
    if (body.pinned !== undefined) db.query("UPDATE conversations SET pinned_at = CASE WHEN ? THEN COALESCE(pinned_at, datetime('now')) ELSE NULL END WHERE id = ?").run(body.pinned ? 1 : 0, id);
    if (cambiaConfiguracion) db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ?").run(body.model === undefined ? row.model : body.model, body.effort === undefined ? row.effort : body.effort, id);
    if (cambiaOrquestacion) {
      const campos: string[] = [];
      const valores: (string | number)[] = [];
      if (body.orquestacion_modelos_personalizados !== undefined) { campos.push("orquestacion_modelos_personalizados=?"); valores.push(body.orquestacion_modelos_personalizados ? 1 : 0); }
      if (body.orquestacion_habilitada !== undefined) { campos.push("orquestacion_habilitada=?"); valores.push(body.orquestacion_habilitada ? 1 : 0); }
      if (body.orquestacion_seleccion_automatica !== undefined) { campos.push("orquestacion_seleccion_automatica=?"); valores.push(body.orquestacion_seleccion_automatica ? 1 : 0); }
      if (body.orquestacion_trabajadores !== undefined) { campos.push("orquestacion_trabajadores=?"); valores.push(JSON.stringify(body.orquestacion_trabajadores)); }
      if (campos.length) db.query(`UPDATE conversations SET ${campos.join(", ")} WHERE id=?`).run(...valores, id);
    }
  })();
  if (cambiaConfiguracion || cambiaOrquestacion || body.work_mode !== undefined || body.apodo_oficina !== undefined) {
    publicar({ tipo: "configuracion_chat", conversacion_id: id });
  }

  const actual = db
    .query<{ id: string; work_mode: "plan" | "build"; title: string; apodo_oficina: string | null; model: string | null; effort: string | null; pinned_at: string | null; orquestacion_habilitada: number; orquestacion_modelos_personalizados: number; orquestacion_seleccion_automatica: number; orquestacion_trabajadores: string }, [string]>(
      "SELECT id, work_mode, title, apodo_oficina, model, effort, pinned_at, orquestacion_habilitada, orquestacion_modelos_personalizados, orquestacion_seleccion_automatica, orquestacion_trabajadores FROM conversations WHERE id = ?",
    )
    .get(id);
  let trabajadores: Trabajador[] = [];
  try { trabajadores = JSON.parse(actual?.orquestacion_trabajadores ?? "[]"); } catch {}
  return c.json({ ...actual, orquestacion_habilitada: Boolean(actual?.orquestacion_habilitada), orquestacion_modelos_personalizados: Boolean(actual?.orquestacion_modelos_personalizados), orquestacion_seleccion_automatica: Boolean(actual?.orquestacion_seleccion_automatica), orquestacion_trabajadores: trabajadores, costTier, costWarning });
});
