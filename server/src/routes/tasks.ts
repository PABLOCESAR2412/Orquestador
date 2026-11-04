import { Hono, type Context } from "hono";
import { db } from "../db";
import { listarEventos, publicarEstado, registrarEvento } from "../eventos";
import { validateSelection } from "../models";
import { aprobarPlan, cancelTask, MAX_NOTAS, notifyWorker, rechazarPlan } from "../worker";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";
import { crearTarea } from "../tareas";
import {
  aprobarTarea,
  diffDeTarea,
  ErrorTarea,
  esIdTarea,
  faltaCopiaDeTarea,
  leerSalida,
  mensajeSeguro,
} from "../workspace";
import type { Plan, Reporte } from "../plan";
import { bloqueoContinuacionDrive } from "./google-drive-archives";

const DEFAULT_MODEL = "opencode/big-pickle";
const MAX_PROMPT = 10_000;

type TaskRow = {
  work_mode: "plan" | "build";
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
  plan: string | null;
  reporte: string | null;
  plan_aprobado_en: string | null;
  plan_hash: string | null;
  approved_hash: string | null;
  conversation_id: string | null;
  modelo_agotado: string | null;
  project_name: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

// reanudable: tiene una sesión de agente o quedó interrumpida y puede volver a ejecutar su fase guardada.
// rama y base_commit: solo tareas de un proyecto con Git.
// plan, reporte y plan_aprobado_en: el plan del analizador, el reporte del obrero y cuándo se aprobó el plan.
// modelo_agotado: el modelo que se quedó sin cuota (solo en tareas 'sin_cuota').
const COLUMNS =
  "t.id, t.work_mode, t.title, t.prompt, t.model, t.effort, t.status, t.result, t.error, t.project_id, t.retry_of, (t.provider_session_id IS NOT NULL OR t.status = 'interrupted') AS reanudable, t.rama, t.base_commit, t.plan, t.reporte, t.plan_aprobado_en, t.plan_hash, t.approved_hash, t.conversation_id, t.modelo_agotado, p.name AS project_name, t.created_at, t.started_at, t.finished_at";
const DESDE = "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id";

const ESTADOS_REANUDABLES = ["interrupted", "failed"];
const ESTADOS_REINTENTABLES = ["interrupted", "failed", "cancelled", "done"];
// Tareas detenidas por cuota agotada: se siguen con otro modelo (no se reintentan ni se reanudan).
const ESTADO_SEGUIBLE = "sin_cuota";

export const tasks = new Hono();

// SQLite devuelve los booleanos como 0 o 1. Plan y reporte se guardan como texto JSON.
function aTarea(row: TaskRow) {
  return {
    ...row,
    reanudable: row.reanudable === 1,
    plan: leerJson<Plan>(row.plan),
    reporte: leerJson<Reporte>(row.reporte),
  };
}

// Un JSON guardado que no se puede leer se muestra como ausente, sin tirar la tarea entera.
function leerJson<T>(texto: string | null): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

function leerTarea(id: string) {
  const row = db.query<TaskRow, [string]>(`SELECT ${COLUMNS} ${DESDE} WHERE t.id = ?`).get(id);
  return row ? aTarea(row) : null;
}

function bloqueoParaContinuar(id: string) {
  return bloqueoContinuacionDrive(id) ?? (faltaCopiaDeTarea(id) ? "task_workspace_missing" : null);
}

function detalleBloqueoContinuacion(codigo: string): string {
  if (codigo === "task_workspace_archived") return "Restaura primero el espacio de trabajo desde Ajustes > Servidor > Almacenamiento.";
  if (codigo === "task_workspace_missing") return "La copia de trabajo de esta tarea ya no está en el servidor. Restaura su respaldo si existe; si no, reinténtala desde el proyecto original. Los cambios locales que no se guardaron pueden haberse perdido.";
  return "Espera a que termine el archivado antes de continuar.";
}

function respuestaBloqueoContinuacion(c: Context, codigo: string) {
  return c.json({ error: codigo, detail: detalleBloqueoContinuacion(codigo) }, 409);
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
  const tarea = esIdTarea(id) ? leerTarea(id) : null;
  if (!tarea) return c.json({ error: "task_not_found" }, 404);
  // El cliente puede conservar por un instante el estado terminal anterior al reanudar.
  // No hay diff disponible mientras el obrero todavía modifica el workspace.
  if (["queued", "analyzing", "waiting_approval", "running"].includes(tarea.status)) {
    return c.json({ estado: "en_curso" as const });
  }
  try {
    return c.json(await diffDeTarea(id));
  } catch (err) {
    // La tarea puede reanudarse después de leer su estado arriba y antes de abrir el clon.
    if (err instanceof ErrorTarea && err.code === "task_running") {
      return c.json({ estado: "en_curso" as const });
    }
    // Una tarea sin clon (por ejemplo, un arranque fallido ya limpiado) no tiene diff.
    // Es un resultado de esta consulta; las operaciones de escritura siguen rechazándose.
    if (err instanceof ErrorTarea && err.code === "task_without_repo") {
      return c.json({ estado: "sin_repo" as const, rama: null, base_commit: null, commit: null,
        archivos: [], diff: "", truncado: false, hash: null, remoto: false,
        aprobaciones: { commit: null, push: null } });
    }
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
  if (body.accion === "push") {
    return c.json({
      error: "github_access",
      detail: "Las subidas a GitHub (push) requieren verificar credenciales de repositorio (GitHub App, SSH o token) y permisos de rama. Prepara la subida desde la tarjeta de repositorio o el panel de subida de la interfaz.",
    }, 409);
  }

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

// POST /api/tasks/:id/aprobar-plan  body: { plan_hash, notas? }
// Aprueba el plan que espera al usuario. El obrero lo ejecuta en la misma sesión y carpeta.
tasks.post("/tasks/:id/aprobar-plan", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ notas?: unknown; plan_hash?: unknown; secretos?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  if (typeof body.plan_hash !== "string" || !/^[0-9a-f]{64}$/i.test(body.plan_hash)) {
    return c.json({ error: "invalid_hash" }, 400);
  }
  if (body.notas !== undefined && body.notas !== null && typeof body.notas !== "string") {
    return c.json({ error: "invalid_notas" }, 400);
  }
  if (typeof body.notas === "string" && body.notas.length > MAX_NOTAS) return c.json({ error: "invalid_notas" }, 400);

  const bloqueo = bloqueoParaContinuar(id);
  if (bloqueo) return respuestaBloqueoContinuacion(c, bloqueo);

  const notas = typeof body.notas === "string" && body.notas.trim() ? body.notas.trim() : null;
  const resultado = aprobarPlan(id, notas, body.plan_hash.toLowerCase(), body.secretos);
  if (resultado === "secretos_no_confirmados" || resultado === "secretos_cambiaron") return c.json({ error: resultado }, 409);
  if (resultado === "not_found") return c.json({ error: "task_not_found" }, 404);
  if (resultado === "not_waiting") return c.json({ error: "task_not_waiting_plan" }, 409);
  if (resultado === "stale") return c.json({ error: "cambios_cambiaron" }, 409);
  return c.json(leerTarea(id));
});

// Tarjeta del plan en el chat: comparte la aprobación y rechazo canónicos de las tareas.
tasks.post("/tasks/:id/plan", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ hash?: unknown; plan_hash?: unknown; decision?: unknown; feedback?: unknown; secretos?: unknown }>()
    .catch(() => null);
  const rawHash = typeof body?.hash === "string" ? body.hash : typeof body?.plan_hash === "string" ? body.plan_hash : null;
  if (
    !body ||
    !rawHash ||
    !/^[0-9a-f]{64}$/i.test(rawHash) ||
    !["approve", "reject", "revise"].includes(String(body.decision))
  ) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const hash = rawHash.toLowerCase();
  const row = leerTarea(id);
  if (!row) return c.json({ error: "task_not_found" }, 404);
  if (row.status !== "waiting_approval" || row.plan_hash !== hash) {
    return c.json({ error: "cambios_cambiaron" }, 409);
  }
  if (body.decision !== "reject") {
    const bloqueo = bloqueoParaContinuar(id);
    if (bloqueo) return respuestaBloqueoContinuacion(c, bloqueo);
  }
  if (body.feedback !== undefined && (typeof body.feedback !== "string" || body.feedback.length > 8000)) {
    return c.json({ error: "invalid_content" }, 400);
  }
  if (body.decision === "approve") {
    if (row.error) return c.json({ error: "plan_needs_revision" }, 409);
    const feedbackTexto = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim() : null;
    const resultado = aprobarPlan(id, feedbackTexto, hash, body.secretos, true);
    if (resultado === "secretos_no_confirmados" || resultado === "secretos_cambiaron") return c.json({ error: resultado }, 409);
    if (resultado !== "ok") return c.json({ error: "cambios_cambiaron" }, 409);
  } else if (body.decision === "reject") {
    const feedbackTexto = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim() : null;
    const resultado = rechazarPlan(id, feedbackTexto);
    if (resultado !== "ok") return c.json({ error: "task_not_waiting_plan" }, 409);
  } else {
    if (typeof body.feedback !== "string" || !body.feedback.trim()) return c.json({ error: "invalid_content" }, 400);
    const feedbackTexto = body.feedback.trim();
    db.transaction(() => {
      db.query(
        "UPDATE tasks SET status='queued',plan_aprobado_en=NULL,approved_hash=NULL,error=NULL,prompt=prompt || ?,continuar=0 WHERE id=?",
      ).run("\nAclaración del usuario: " + feedbackTexto, id);
      registrarEvento(id, "plan_revision", feedbackTexto);
    })();
    publicarEstado(id);
    notifyWorker();
  }
  return c.json(leerTarea(id));
});

// POST /api/tasks/:id/rechazar-plan  body: { motivo? }
// El plan no se ejecuta y la tarea termina cancelada. Para intentarlo de nuevo, se reintenta.
tasks.post("/tasks/:id/rechazar-plan", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ motivo?: unknown }>().catch(() => ({}) as { motivo?: unknown });
  if (typeof body.motivo === "string" && body.motivo.length > MAX_NOTAS) return c.json({ error: "invalid_notas" }, 400);

  const motivo = typeof body.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;
  const resultado = rechazarPlan(id, motivo);
  if (resultado === "not_found") return c.json({ error: "task_not_found" }, 404);
  if (resultado === "not_waiting") return c.json({ error: "task_not_waiting_plan" }, 409);
  return c.json(leerTarea(id));
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
// Vuelve a la cola y continúa en la misma carpeta (y el mismo clon). El worker reutiliza la sesión
// solo si conoce que pertenece al modelo seleccionado; si no, guía al agente desde el estado guardado.
tasks.post("/tasks/:id/reanudar", (c) => {
  const id = c.req.param("id");
  const row = leerTarea(id);
  if (!row) return c.json({ error: "task_not_found" }, 404);
  if (!ESTADOS_REANUDABLES.includes(row.status)) return c.json({ error: "task_not_resumable" }, 409);
  if (!row.reanudable) return c.json({ error: "task_without_session" }, 409);
  const bloqueo = bloqueoParaContinuar(id);
  if (bloqueo) return respuestaBloqueoContinuacion(c, bloqueo);

  let bloqueoFinal: string | null = null;
  db.transaction(() => {
    bloqueoFinal = bloqueoParaContinuar(id);
    if (bloqueoFinal) return;
    db.query(
      "UPDATE tasks SET status = 'queued', result = NULL, error = NULL, finished_at = NULL, continuar = CASE WHEN provider_session_id IS NULL THEN 0 ELSE 1 END WHERE id = ?",
    ).run(id);
    registrarEvento(id, "reanudada", `Estaba ${row.status === "interrupted" ? "interrumpida" : "fallida"}`);
  })();
  if (bloqueoFinal) return respuestaBloqueoContinuacion(c, bloqueoFinal);

  publicarEstado(id);
  notifyWorker();
  return c.json(leerTarea(id));
});

// POST /api/tasks/:id/seguir  body: { model?, effort? }
// Tras una cuota agotada: la tarea vuelve a la cola con otro modelo (o el mismo, si ya tiene cuota de nuevo)
// y retoma su sesión desde donde se quedó. Elegir el modelo agotado otra vez se rechaza.
tasks.post("/tasks/:id/seguir", async (c) => {
  const id = c.req.param("id");
  const row = leerTarea(id);
  if (!row) return c.json({ error: "task_not_found" }, 404);
  if (row.status !== ESTADO_SEGUIBLE) return c.json({ error: "task_not_continuable" }, 409);
  const bloqueo = bloqueoParaContinuar(id);
  if (bloqueo) return respuestaBloqueoContinuacion(c, bloqueo);

  const body = await c.req
    .json<{ model?: unknown; effort?: unknown }>()
    .catch(() => ({}) as { model?: unknown; effort?: unknown });
  if (body.model !== undefined && body.model !== null && typeof body.model !== "string") {
    return c.json({ error: "invalid_model" }, 400);
  }
  const cambiaModelo = typeof body.model === "string" && body.model.trim() !== "" && body.model.trim() !== row.model;
  const model = cambiaModelo ? (body.model as string).trim() : row.model;
  const effort = cambiaModelo
    ? typeof body.effort === "string" && body.effort
      ? body.effort
      : null
    : row.effort;

  if (model === row.modelo_agotado) return c.json({ error: "modelo_sin_cambio" }, 409);
  try {
    const check = await validateSelection(model, effort);
    if (!check.ok) return c.json({ error: check.error }, 400);
  } catch (err) {
    return c.json({ error: "models_unavailable", detail: String(err) }, 503);
  }

  // La condición del UPDATE evita seguir una tarea que cambió de estado mientras se validaba el modelo.
  let bloqueoFinal: string | null = null;
  const encolada = db.transaction(() => {
    bloqueoFinal = bloqueoParaContinuar(id);
    if (bloqueoFinal) return false;
    const r = db
      .query(
        "UPDATE tasks SET status = 'queued', model = ?, effort = ?, modelo_agotado = NULL, error = NULL, finished_at = NULL, continuar = 1 WHERE id = ? AND status = ?",
      )
      .run(model, effort, id, ESTADO_SEGUIBLE);
    if (r.changes === 0) return false;
    registrarEvento(id, "seguida", cambiaModelo ? `Modelo ${model} (antes ${row.model})` : `Modelo ${model}`);
    return true;
  })();
  if (bloqueoFinal) return respuestaBloqueoContinuacion(c, bloqueoFinal);
  if (!encolada) return c.json({ error: "task_not_continuable" }, 409);

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
    workMode: original.work_mode,
  });
  return c.json(leerTarea(nueva), 201);
});
