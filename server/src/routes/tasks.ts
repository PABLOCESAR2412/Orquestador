import { Hono } from "hono";
import { db } from "../db";
import { listarEventos, registrarEvento } from "../eventos";
import { validateSelection } from "../models";
import { cancelTask, notifyWorker } from "../worker";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";

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
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

// reanudable: la tarea tiene la sesión del agente, así que puede continuar donde quedó.
const COLUMNS =
  "id, title, prompt, model, effort, status, result, error, project_id, retry_of, (provider_session_id IS NOT NULL) AS reanudable, created_at, started_at, finished_at";

const ESTADOS_REANUDABLES = ["interrupted", "failed"];
const ESTADOS_REINTENTABLES = ["interrupted", "failed", "cancelled"];

export const tasks = new Hono();

// SQLite devuelve los booleanos como 0 o 1.
function aTarea(row: TaskRow) {
  return { ...row, reanudable: row.reanudable === 1 };
}

function leerTarea(id: string) {
  const row = db.query<TaskRow, [string]>(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`).get(id);
  return row ? aTarea(row) : null;
}

// GET /api/tasks?limit=50  -> tareas más recientes primero
tasks.get("/tasks", (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const rows = db
    .query<TaskRow, [number]>(`SELECT ${COLUMNS} FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?`)
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

  const id = crypto.randomUUID();
  db.transaction(() => {
    db.query(
      "INSERT INTO tasks (id, title, prompt, model, effort, status, project_id) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
    ).run(id, prompt.slice(0, 60), prompt, model, effort, projectId);
    registrarEvento(id, "creada", `Modelo ${model}`);
  })();

  notifyWorker();

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
// Vuelve a la cola y continúa la misma sesión del agente, en la misma carpeta.
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

  notifyWorker();
  return c.json(leerTarea(id));
});

// POST /api/tasks/:id/reintentar
// Crea una tarea nueva con el mismo prompt, modelo y proyecto. No continúa la sesión anterior.
tasks.post("/tasks/:id/reintentar", (c) => {
  const original = leerTarea(c.req.param("id"));
  if (!original) return c.json({ error: "task_not_found" }, 404);
  if (!ESTADOS_REINTENTABLES.includes(original.status)) return c.json({ error: "task_not_retryable" }, 409);

  const nueva = crypto.randomUUID();
  db.transaction(() => {
    db.query(
      "INSERT INTO tasks (id, title, prompt, model, effort, status, project_id, retry_of) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
    ).run(
      nueva,
      original.title,
      original.prompt,
      original.model,
      original.effort,
      original.project_id,
      original.id,
    );
    registrarEvento(nueva, "creada", `Reintento de ${original.id.slice(0, 8)}`);
    registrarEvento(original.id, "reintento_creado", `Nueva tarea ${nueva.slice(0, 8)}`);
  })();

  notifyWorker();
  return c.json(leerTarea(nueva), 201);
});
