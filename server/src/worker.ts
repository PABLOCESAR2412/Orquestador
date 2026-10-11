import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { registrarEvento } from "./eventos";
import { runOpenCode, type Usage } from "./runners/opencode";

// Un solo worker: ejecuta una tarea a la vez, en orden de llegada.
// Corre dentro del mismo proceso que la API, así que sigue activo aunque
// el teléfono o el navegador estén apagados.

const TASK_TIMEOUT_MS = 30 * 60_000;
const MENSAJE_INTERRUMPIDA = "El servidor se reinició mientras la tarea corría. Puedes reanudarla o reintentarla.";

const controllers = new Map<string, AbortController>();
const cancelRequested = new Set<string>();
let wake: (() => void) | null = null;

type QueuedTask = {
  id: string;
  prompt: string;
  model: string;
  effort: string | null;
  repo_path: string | null;
  provider_session_id: string | null;
};

// Despierta al worker cuando entra una tarea nueva.
export function notifyWorker() {
  wake?.();
}

function nextQueued(): QueuedTask | null {
  return db
    .query<QueuedTask, []>(
      "SELECT t.id, t.prompt, t.model, t.effort, t.provider_session_id, p.repo_path AS repo_path FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status = 'queued' ORDER BY t.created_at ASC, t.rowid ASC LIMIT 1",
    )
    .get();
}

function finish(
  id: string,
  status: "done" | "failed" | "cancelled",
  fields: { result?: string; error?: string },
) {
  db.transaction(() => {
    db.query(
      "UPDATE tasks SET status = ?, result = ?, error = ?, finished_at = datetime('now') WHERE id = ?",
    ).run(status, fields.result ?? null, fields.error ?? null, id);
    registrarEvento(id, "terminada", fields.error ? `${status}: ${fields.error}` : status);
  })();
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
    "UPDATE tasks SET status = 'running', started_at = datetime('now'), finished_at = NULL, workspace = ? WHERE id = ?",
  ).run(cwd, task.id);
  registrarEvento(
    task.id,
    "iniciada",
    `Modelo ${task.model}${task.provider_session_id ? " · continúa la sesión anterior" : ""}`,
  );

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
      sessionId: task.provider_session_id,
      cwd,
      timeoutMs: TASK_TIMEOUT_MS,
      signal: controller.signal,
      // Guarda la sesión apenas aparece, para poder reanudar si el servidor se reinicia a mitad.
      onSesion: (sid) => {
        if (sid === task.provider_session_id) return;
        task.provider_session_id = sid;
        db.query("UPDATE tasks SET provider_session_id = ? WHERE id = ?").run(sid, task.id);
        registrarEvento(task.id, "sesion_asignada", sid);
      },
    });
    finish(task.id, "done", { result: result.text });
    if (result.usage) recordUsage(task.model, result.usage);
  } catch (err) {
    if (cancelRequested.has(task.id)) {
      finish(task.id, "cancelled", { error: "Cancelada por el usuario." });
    } else if (timedOut) {
      finish(task.id, "failed", { error: "La tarea superó los 30 minutos." });
    } else {
      finish(task.id, "failed", { error: err instanceof Error ? err.message : String(err) });
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
  // Una tarea "running" al arrancar quedó sin proceso por un reinicio: se marca
  // como interrumpida, no como fallida, para que el usuario decida qué hacer.
  db.transaction(() => {
    const enCurso = db.query<{ id: string }, []>("SELECT id FROM tasks WHERE status = 'running'").all();
    db.query("UPDATE tasks SET status = 'interrupted', error = ? WHERE status = 'running'").run(
      MENSAJE_INTERRUMPIDA,
    );
    for (const t of enCurso) registrarEvento(t.id, "interrumpida", MENSAJE_INTERRUMPIDA);
  })();
  void loop();
}

export type CancelOutcome = "cancelled" | "cancelling" | "not_cancellable" | "not_found";

export function cancelTask(id: string): CancelOutcome {
  const row = db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id);
  if (!row) return "not_found";

  // Una tarea interrumpida no tiene proceso: se cierra directamente.
  if (row.status === "queued" || row.status === "interrupted") {
    finish(id, "cancelled", { error: "Cancelada por el usuario." });
    return "cancelled";
  }
  if (row.status === "running") {
    cancelRequested.add(id);
    registrarEvento(id, "cancelacion_pedida");
    controllers.get(id)?.abort();
    return "cancelling";
  }
  return "not_cancellable";
}
