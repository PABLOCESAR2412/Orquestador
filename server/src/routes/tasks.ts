import { Hono, type Context } from "hono";
import { db } from "../db";
import { listarEventos, publicarEstado, registrarEvento } from "../eventos";
import { validateSelection } from "../models";
import { cancelTask, notifyWorker } from "../worker";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";
import { crearTarea } from "../tareas";
import {
  aprobarTarea,
  diffDeTarea,
  ErrorTarea,
  esIdTarea,
  leerSalida,
  mensajeSeguro,
} from "../workspace";

const DEFAULT_MODEL = "opencode/big-pickle";
const MAX_PROMPT = 10_000;

type TaskRow = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  effort: string | null;
  status: string;
  result: string | null;
  error: string | null;
  project_id: string | null;
  retry_of: string | null;
  reanudable: number;
  rama: string | null;
  base_commit: string | null;
  project_name: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

// reanudable: la tarea tiene la sesión del agente, así que puede continuar donde quedó.
// rama y base_commit: solo tareas de un proyecto con Git.
const COLUMNS =
  "t.id, t.title, t.prompt, t.model, t.effort, t.status, t.result, t.error, t.project_id, t.retry_of, (t.provider_session_id IS NOT NULL) AS reanudable, t.rama, t.base_commit, p.name AS project_name, t.created_at, t.started_at, t.finished_at";
const DESDE = "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id";

const ESTADOS_REANUDABLES = ["interrupted", "failed"];
const ESTADOS_REINTENTABLES = ["interrupted", "failed", "cancelled"];

export const tasks = new Hono();

// SQLite devuelve los booleanos como 0 o 1.
function aTarea(row: TaskRow) {
  return { ...row, reanudable: row.reanudable === 1 };
}

function leerTarea(id: string) {
  const row = db.query<TaskRow, [string]>(`SELECT ${COLUMNS} ${DESDE} WHERE t.id = ?`).get(id);
  return row ? aTarea(row) : null;
}

// Traduce los errores de tareas y de Git a la forma { error, detail? } de la API.
function respuestaDeError(c: Context, err: unknown) {
  if (err instanceof ErrorTarea) {
    return c.json(err.detail ? { error: err.code, detail: err.detail } : { error: err.code }, err.status);
  }
  return c.json({ error: "tarea_error", detail: mensajeSeguro(err) }, 500);
}

// GET /api/tasks?limit=50  -> tareas más recientes primero
tasks.get("/tasks", (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const rows = db
    .query<TaskRow, [number]>(`SELECT ${COLUMNS} ${DESDE} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`)
    .all(limit);
  return c.json(rows.map(aTarea));
});

tasks.get("/tasks/:id", (c) => {
  const row = leerTarea(c.req.param("id"));
  if (!row) return c.json({ error: "task_not_found" }, 404);
  return c.json(row);
});

// GET /api/tasks/:id/eventos  -> historial en orden cronológico
tasks.get("/tasks/:id/eventos", (c) => {
  const id = c.req.param("id");
  if (!leerTarea(id)) return c.json({ error: "task_not_found" }, 404);
  return c.json(listarEventos(id));
});

// GET /api/tasks/:id/salida -> últimas 512 KB de la salida del agente (líneas JSON, sin procesar)
tasks.get("/tasks/:id/salida", async (c) => {
  const id = c.req.param("id");
  if (!esIdTarea(id) || !leerTarea(id)) return c.json({ error: "task_not_found" }, 404);
  try {
    return c.json(await leerSalida(id));
  } catch (err) {
    return respuestaDeError(c, err);
  }
});

// GET /api/tasks/:id/diff -> cambios del clon frente a base_commit, con el hash que exige aprobar
tasks.get("/tasks/:id/diff", async (c) => {
  const id = c.req.param("id");
  if (!esIdTarea(id) || !leerTarea(id)) return c.json({ error: "task_not_found" }, 404);
  try {
    return c.json(await diffDeTarea(id));
  } catch (err) {
    return respuestaDeError(c, err);
  }
});

// POST /api/tasks/:id/aprobar  body: { accion: "commit" | "push", hash, mensaje? }
tasks.post("/tasks/:id/aprobar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ accion?: unknown; hash?: unknown; mensaje?: unknown }>()
    .catch(() => ({}) as { accion?: unknown; hash?: unknown; mensaje?: unknown });

  if (body.accion !== "commit" && body.accion !== "push") return c.json({ error: "invalid_accion" }, 400);
  if (typeof body.hash !== "string" || !/^[0-9a-f]{64}$/i.test(body.hash)) {
    return c.json({ error: "invalid_hash" }, 400);
  }
  if (!esIdTarea(id) || !leerTarea(id)) return c.json({ error: "task_not_found" }, 404);

  try {
    const resultado = await aprobarTarea(id, {
      accion: body.accion,
      hash: body.hash.toLowerCase(),
      mensaje: body.mensaje,
    });
    return c.json(resultado);
  } catch (err) {
    return respuestaDeError(c, err);
  }
});

// POST /api/tasks  body: { prompt, model?, effort?, projectId? }
// Con projectId, la tarea trabaja dentro de la carpeta de ese proyecto.
tasks.post("/tasks", async (c) => {
  const body = await c.req
    .json<{ prompt?: string; model?: string | null; effort?: string | null; projectId?: string | null }>()
    .catch(() => ({}) as { prompt?: string; model?: string | null; effort?: string | null; projectId?: string | null });

  const prompt = body.prompt?.trim() ?? "";
  if (!prompt || prompt.length > MAX_PROMPT) return c.json({ error: "invalid_prompt" }, 400);

  const projectId = body.projectId || null;
  if (projectId && !projectRepoPath(projectId)) return c.json({ error: "project_not_found" }, 400);

  // Sin modelo explícito, la tarea usa el modelo y esfuerzo por defecto de Ajustes.
  const prefs = getPreferences();
  const model = body.model || prefs.defaultModel || DEFAULT_MODEL;
  const effort = body.model ? body.effort || null : body.effort || prefs.defaultEffort || null;

  try {
    const check = await validateSelection(model, effort);
    if (!check.ok) return c.json({ error: check.error }, 400);
  } catch (err) {
    return c.json({ error: "models_unavailable", detail: String(err) }, 503);
  }

  const id = crearTarea({ prompt, model, effort, projectId });
  return c.json(leerTarea(id), 201);
});

// POST /api/tasks/:id/cancel
// 200 si se canceló en cola; 202 si el proceso en curso recibió la señal.
tasks.post("/tasks/:id/cancel", (c) => {
  const outcome = cancelTask(c.req.param("id"));
  if (outcome === "not_found") return c.json({ error: "task_not_found" }, 404);
  if (outcome === "not_cancellable") return c.json({ error: "task_not_cancellable" }, 409);
  return c.json({ outcome }, outcome === "cancelling" ? 202 : 200);
});

// POST /api/tasks/:id/reanudar
// Vuelve a la cola y continúa la misma sesión del agente, en la misma carpeta (y el mismo clon).
tasks.post("/tasks/:id/reanudar", (c) => {
  const id = c.req.param("id");
  const row = leerTarea(id);
  if (!row) return c.json({ error: "task_not_found" }, 404);
  if (!ESTADOS_REANUDABLES.includes(row.status)) return c.json({ error: "task_not_resumable" }, 409);
  if (!row.reanudable) return c.json({ error: "task_without_session" }, 409);

  db.transaction(() => {
    db.query(
      "UPDATE tasks SET status = 'queued', result = NULL, error = NULL, finished_at = NULL WHERE id = ?",
    ).run(id);
    registrarEvento(id, "reanudada", `Estaba ${row.status === "interrupted" ? "interrumpida" : "fallida"}`);
  })();

  publicarEstado(id);
  notifyWorker();
  return c.json(leerTarea(id));
});

// POST /api/tasks/:id/reintentar
// Crea una tarea nueva con el mismo prompt, modelo y proyecto. No continúa la sesión anterior.
tasks.post("/tasks/:id/reintentar", (c) => {
  const original = leerTarea(c.req.param("id"));
  if (!original) return c.json({ error: "task_not_found" }, 404);
  if (!ESTADOS_REINTENTABLES.includes(original.status)) return c.json({ error: "task_not_retryable" }, 409);

  const nueva = crearTarea({
    prompt: original.prompt,
    model: original.model,
    effort: original.effort,
    projectId: original.project_id,
    titulo: original.title,
    retryOf: original.id,
  });
  return c.json(leerTarea(nueva), 201);
});
