import { Hono } from "hono";
import { db } from "../db";
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
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const COLUMNS =
  "id, title, prompt, model, effort, status, result, error, project_id, created_at, started_at, finished_at";

export const tasks = new Hono();

// GET /api/tasks?limit=50  -> tareas más recientes primero
tasks.get("/tasks", (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const rows = db
    .query<TaskRow, [number]>(`SELECT ${COLUMNS} FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit);
  return c.json(rows);
});

tasks.get("/tasks/:id", (c) => {
  const row = db
    .query<TaskRow, [string]>(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`)
    .get(c.req.param("id"));
  if (!row) return c.json({ error: "task_not_found" }, 404);
  return c.json(row);
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
  db.query(
    "INSERT INTO tasks (id, title, prompt, model, effort, status, project_id) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
  ).run(id, prompt.slice(0, 60), prompt, model, effort, projectId);

  notifyWorker();

  const row = db.query<TaskRow, [string]>(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`).get(id);
  return c.json(row, 201);
});

// POST /api/tasks/:id/cancel
// 200 si se canceló en cola; 202 si el proceso en curso recibió la señal.
tasks.post("/tasks/:id/cancel", (c) => {
  const outcome = cancelTask(c.req.param("id"));
  if (outcome === "not_found") return c.json({ error: "task_not_found" }, 404);
  if (outcome === "not_cancellable") return c.json({ error: "task_not_cancellable" }, 409);
  return c.json({ outcome }, outcome === "cancelling" ? 202 : 200);
});
