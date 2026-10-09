import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { runOpenCode, type Usage } from "./runners/opencode";

// Un solo worker: ejecuta una tarea a la vez, en orden de llegada.
// Corre dentro del mismo proceso que la API, así que sigue activo aunque
// el teléfono o el navegador estén apagados.

const TASK_TIMEOUT_MS = 30 * 60_000;

const controllers = new Map<string, AbortController>();
const cancelRequested = new Set<string>();
let wake: (() => void) | null = null;

type QueuedTask = {
  id: string;
  prompt: string;
  model: string;
  effort: string | null;
  repo_path: string | null;
};

// Despierta al worker cuando entra una tarea nueva.
export function notifyWorker() {
  wake?.();
}

function nextQueued(): QueuedTask | null {
  return db
    .query<QueuedTask, []>(
      "SELECT t.id, t.prompt, t.model, t.effort, p.repo_path AS repo_path FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status = 'queued' ORDER BY t.created_at ASC, t.rowid ASC LIMIT 1",
    )
    .get();
}

function finish(
  id: string,
  status: "done" | "failed" | "cancelled",
  fields: { result?: string; error?: string },
) {
  db.query(
    "UPDATE tasks SET status = ?, result = ?, error = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(status, fields.result ?? null, fields.error ?? null, id);
}

function recordUsage(model: string, u: Usage) {
  db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cost)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    model.split("/")[0],
    model,
    u.input,
    u.output,
    u.reasoning,
    u.cacheRead,
    u.cost,
  );
}

async function runTask(task: QueuedTask) {
  const workspace = join(config.dataDir, "tasks", task.id);
  mkdirSync(workspace, { recursive: true });

  // Con proyecto, la tarea trabaja dentro de la carpeta del proyecto; si no, en su carpeta temporal.
  const cwd = task.repo_path ?? workspace;

  db.query(
    "UPDATE tasks SET status = 'running', started_at = datetime('now'), workspace = ? WHERE id = ?",
  ).run(cwd, task.id);

  const controller = new AbortController();
  controllers.set(task.id, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TASK_TIMEOUT_MS);

  try {
    const result = await runOpenCode({
      prompt: task.prompt,
      model: task.model,
      variant: task.effort ?? undefined,
      cwd,
      timeoutMs: TASK_TIMEOUT_MS,
      signal: controller.signal,
    });
    finish(task.id, "done", { result: result.text });
    if (result.usage) recordUsage(task.model, result.usage);
  } catch (err) {
    if (cancelRequested.has(task.id)) {
      finish(task.id, "cancelled", { error: "Cancelada por el usuario." });
    } else if (timedOut) {
      finish(task.id, "failed", { error: "La tarea superó los 30 minutos." });
    } else {
      finish(task.id, "failed", { error: String(err) });
    }
  } finally {
    clearTimeout(timer);
    controllers.delete(task.id);
    cancelRequested.delete(task.id);
  }
}

async function loop() {
  for (;;) {
    const task = nextQueued();
    if (task) {
      try {
        await runTask(task);
      } catch (err) {
        console.error("Error inesperado en el worker:", err);
      }
      continue;
    }
    // Sin tareas: duerme hasta que llegue una. La consulta y la asignación
    // de `wake` ocurren sin await entre ellas, así que ningún aviso se pierde.
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
  }
}

// Llamar una sola vez al arrancar el servidor.
export function startWorker() {
  // Una tarea "running" al arrancar quedó huérfana por un reinicio.
  db.query(
    "UPDATE tasks SET status = 'failed', error = ?, finished_at = datetime('now') WHERE status = 'running'",
  ).run("El servidor se reinició mientras la tarea corría.");
  void loop();
}

export type CancelOutcome = "cancelled" | "cancelling" | "not_cancellable" | "not_found";

export function cancelTask(id: string): CancelOutcome {
  const row = db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id);
  if (!row) return "not_found";

  if (row.status === "queued") {
    finish(id, "cancelled", { error: "Cancelada por el usuario." });
    return "cancelled";
  }
  if (row.status === "running") {
    cancelRequested.add(id);
    controllers.get(id)?.abort();
    return "cancelling";
  }
  return "not_cancellable";
}
