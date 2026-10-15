import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { publicar } from "./bus";
import { publicarEstado, registrarEvento } from "./eventos";
import { ejecutarAgente } from "./ejecutar";
import {
  hashPlan,
  instruccionAnalizador,
  instruccionObrero,
  leerPlan,
  leerReporte,
} from "./planificacion";
import { guardarMemoria } from "./memoria";
import { repositoryActions } from "./routes/repository-actions";
import { proyectoOcupado, reservarProyecto, soltarProyecto } from "./ocupacion";
import { capturarAlcance, comprobarAlcance, type AlcancePlan } from "./alcance-plan";
import {
  abrirRegistroSalida,
  ErrorTarea,
  iniciarLimpieza,
  limpiarCopiaCancelada,
  mensajeSeguro,
  prepararCopia,
  type RegistroSalida,
} from "./workspace";

// Un solo worker: ejecuta una tarea a la vez, en orden de llegada.
// Corre dentro del mismo proceso que la API, así que sigue activo aunque
// el teléfono o el navegador estén apagados.

const TASK_TIMEOUT_MS = 30 * 60_000;
const MENSAJE_INTERRUMPIDA =
  "El servidor se reinició mientras la tarea corría. Puedes reanudarla o reintentarla.";
// Tamaño máximo de cada línea de salida que viaja por el canal en vivo.
const MAX_LINEA_EN_VIVO = 4096;

const controllers = new Map<string, AbortController>();
const cancelRequested = new Set<string>();
let wake: (() => void) | null = null;

type QueuedTask = {
  id: string;
  prompt: string;
  model: string;
  effort: string | null;
  repo_path: string | null;
  project_id: string | null;
  provider_session_id: string | null;
  phase: string;
  plan: string | null;
  plan_hash: string | null;
  approved_hash: string | null;
  conversation_id: string | null;
};

// Despierta al worker cuando entra una tarea nueva.
export function notifyWorker() {
  wake?.();
}

function nextQueued(): QueuedTask | null {
  return db
    .query<
      QueuedTask,
      []
    >("SELECT t.*, p.repo_path AS repo_path FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status = 'queued' AND t.phase != 'waiting_approval' ORDER BY t.created_at ASC, t.rowid ASC LIMIT 1")
    .get();
}

function estadoActual(id: string): string | null {
  return (
    db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id)
      ?.status ?? null
  );
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
  publicarEstado(id);
  const conv = db
    .query<
      { conversation_id: string | null },
      [string]
    >("SELECT conversation_id FROM tasks WHERE id = ?")
    .get(id)?.conversation_id;
  if (conv)
    db.query(
      "INSERT INTO messages(id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)",
    ).run(crypto.randomUUID(), conv, fields.result ?? fields.error ?? status);
  // Una tarea cancelada sin cambios libera su copia; con cambios, queda para revisión.
  if (status === "cancelled") {
    limpiarCopiaCancelada(id).catch((err) =>
      console.error("Limpieza de la copia cancelada:", mensajeSeguro(err)),
    );
  }
}

function recortarLinea(linea: string): string {
  const bytes = new TextEncoder().encode(linea);
  return bytes.length <= MAX_LINEA_EN_VIVO
    ? linea
    : new TextDecoder().decode(bytes.subarray(0, MAX_LINEA_EN_VIVO));
}

function contextoChat(task: QueuedTask): string {
  if (!task.conversation_id) return task.prompt;
  const mensajes = db
    .query<
      { role: string; content: string },
      [string]
    >("SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20")
    .all(task.conversation_id)
    .reverse();
  return `Historial de esta conversación:\n${mensajes
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(-16000)}\nPetición actual:\n${task.prompt}`;
}

async function runTask(task: QueuedTask) {
  if (task.project_id && proyectoOcupado(task.project_id)) {
    await Bun.sleep(500);
    return;
  }
  if (task.project_id && !reservarProyecto(task.project_id)) return;
  try {
    await ejecutarTarea(task);
  } finally {
    if (task.project_id) soltarProyecto(task.project_id);
  }
}

async function ejecutarTarea(task: QueuedTask) {
  // Con proyecto de Git, la tarea trabaja en su clon; con proyecto sin Git, en la carpeta del proyecto;
  // sin proyecto, en su carpeta temporal.
  let cwd: string;
  try {
    const workspace = join(config.dataDir, "tasks", task.id);
    mkdirSync(workspace, { recursive: true });
    cwd = workspace;
    if (task.project_id && task.repo_path) {
      cwd = (await prepararCopia(task.id, task.repo_path, task.project_id)).cwd;
    }
  } catch (err) {
    // Si la preparación falla, la tarea queda fallida y no vuelve a la cola: repetirla sin
    // corregir la causa solo gastaría el reintento del worker. Si se canceló mientras
    // preparaba, la cancelación ya quedó registrada.
    if (estadoActual(task.id) !== "queued") return;
    const texto =
      err instanceof ErrorTarea
        ? err.code === "proyecto_sin_git"
          ? "Inicializa Git y el primer commit desde la configuración del proyecto antes de lanzar una tarea."
          : "La copia de trabajo de la tarea no está disponible."
        : mensajeSeguro(err);
    finish(task.id, "failed", { error: `No se pudo preparar la tarea: ${texto}` });
    return;
  }

  // La condición evita pisar una cancelación que llegó durante la preparación.
  const marcada = db
    .query(
      "UPDATE tasks SET status = 'running', started_at = datetime('now'), finished_at = NULL, workspace = ? WHERE id = ? AND status = 'queued'",
    )
    .run(cwd, task.id);
  if (marcada.changes === 0) return;
  publicarEstado(task.id);
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

  let salida: RegistroSalida;
  try {
    salida = abrirRegistroSalida(task.id);
  } catch {
    // Sin registro en disco la tarea sigue; solo se pierde el historial de salida.
    salida = { linea() {}, cerrar() {} };
  }

  let alcance: AlcancePlan | null = null;
  try {
    const analizando = task.phase === "analyzing" || !task.plan;
    if (!analizando && (!task.plan || task.plan_hash !== task.approved_hash))
      throw new Error("El plan necesita aprobación antes de ejecutar.");
    const plan = task.plan ? leerPlan(task.plan) : null;
    if (!analizando && task.project_id)
      alcance = await capturarAlcance(
        cwd,
        plan!.pasos.flatMap((p) => p.archivos),
      );
    const result = await ejecutarAgente({
      prompt: analizando
        ? instruccionAnalizador(contextoChat(task))
        : instruccionObrero(plan!, task.prompt),
      model: task.model,
      variant: task.effort,
      sessionId: analizando ? null : task.provider_session_id,
      cwd,
      timeoutMs: TASK_TIMEOUT_MS,
      signal: controller.signal,
      taskId: task.id,
      projectId: task.project_id,
      conversationId: task.conversation_id,
      soloLectura: analizando,
      // Las tareas de un proyecto aprenden de él: al terminar, guardan su memoria.
      aprender: false,
      // Guarda la sesión apenas aparece, para poder reanudar si el servidor se reinicia a mitad.
      onSesion: (sid) => {
        if (analizando) return;
        if (sid === task.provider_session_id) return;
        task.provider_session_id = sid;
        db.query("UPDATE tasks SET provider_session_id = ? WHERE id = ?").run(sid, task.id);
        registrarEvento(task.id, "sesion_asignada", sid);
      },
      onLinea: (linea) => {
        if (!linea.trim()) return;
        salida.linea(linea);
        publicar({ tipo: "salida", task_id: task.id, linea: recortarLinea(linea) });
      },
    });
    if (controller.signal.aborted) throw new Error("ejecución cancelada");
    if (alcance) {
      const fuera = await comprobarAlcance(alcance);
      if (fuera.length) {
        const mensaje =
          "Hay cambios fuera de los archivos aprobados: " +
          fuera.slice(0, 20).join(", ") +
          ". Los cambios se conservan; revisa el diff y solicita otro plan.";
        db.query(
          "UPDATE tasks SET status='interrupted',phase='waiting_approval',approved_hash=NULL,error=? WHERE id=?",
        ).run(mensaje, task.id);
        registrarEvento(task.id, "plan_revision", mensaje);
        publicarEstado(task.id);
        return;
      }
    }
    if (analizando) {
      const nuevo = leerPlan(result.text);
      const json = JSON.stringify(nuevo);
      const hash = hashPlan(nuevo);
      db.transaction(() => {
        db.query(
          "UPDATE tasks SET status='queued', phase='waiting_approval', plan=?, plan_hash=?, approved_hash=NULL WHERE id=?",
        ).run(json, hash, task.id);
        db.query("INSERT INTO task_plans(task_id, plan, hash) VALUES (?, ?, ?)").run(
          task.id,
          json,
          hash,
        );
      })();
      registrarEvento(task.id, "plan_listo", "Revisa el plan antes de ejecutar.");
      publicarEstado(task.id);
      return;
    }
    const reporte = leerReporte(result.text);
    if ("requiere_revision" in reporte) {
      db.query(
        "UPDATE tasks SET status='interrupted', phase='waiting_approval', approved_hash=NULL, error=? WHERE id=?",
      ).run(reporte.requiere_revision, task.id);
      registrarEvento(task.id, "plan_revision", reporte.requiere_revision);
      publicarEstado(task.id);
      return;
    }
    if (reporte.memoria?.trim() && task.project_id)
      guardarMemoria(task.project_id, reporte.memoria.trim());
    db.query("UPDATE tasks SET report=?, phase='completed' WHERE id=?").run(
      JSON.stringify(reporte),
      task.id,
    );
    const pruebasFallidas = reporte.pruebas.some((p) => p.resultado === "fallo");
    finish(task.id, pruebasFallidas ? "failed" : "done", {
      result: reporte.resumen,
      ...(pruebasFallidas
        ? { error: "Las pruebas del obrero fallaron. Revisa el reporte y los cambios." }
        : {}),
    });
    if (!pruebasFallidas && task.conversation_id && task.project_id) {
      const accion = ["commit", "push", "pr"].find((a) =>
        plan!.requiere_aprobacion.includes(a as "commit" | "push" | "pr"),
      );
      if (accion)
        await repositoryActions.request(`http://telo/projects/${task.project_id}/acciones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: accion,
            conversationId: task.conversation_id,
            taskId: task.id,
          }),
        });
    }
  } catch (err) {
    if (alcance && !cancelRequested.has(task.id)) {
      try {
        const fuera = await comprobarAlcance(alcance);
        if (fuera.length) {
          const mensaje =
            "La ejecución se detuvo con cambios fuera del plan: " +
            fuera.slice(0, 20).join(", ") +
            ". Los cambios se conservan para revisión.";
          db.query(
            "UPDATE tasks SET status='interrupted',phase='waiting_approval',approved_hash=NULL,error=? WHERE id=?",
          ).run(mensaje, task.id);
          registrarEvento(task.id, "plan_revision", mensaje);
          publicarEstado(task.id);
          return;
        }
      } catch {
        /* El error original sigue visible y el workspace se conserva. */
      }
    }
    if (cancelRequested.has(task.id)) {
      finish(task.id, "cancelled", { error: "Cancelada por el usuario." });
    } else if (timedOut) {
      finish(task.id, "failed", { error: "La tarea superó los 30 minutos." });
    } else {
      finish(task.id, "failed", { error: mensajeSeguro(err) });
    }
  } finally {
    salida.cerrar();
    clearTimeout(timer);
    controllers.delete(task.id);
    cancelRequested.delete(task.id);
  }
}

async function loop() {
  for (;;) {
    let task: QueuedTask | null = null;
    try {
      task = nextQueued();
      if (task) {
        await runTask(task);
        continue;
      }
    } catch (err) {
      console.error("Error inesperado en el worker:", mensajeSeguro(err));
      // Si la base falla, esperar evita un bucle apretado que impediría atender peticiones.
      if (task) {
        try {
          db.query(
            "UPDATE tasks SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ? AND status IN ('queued', 'running')",
          ).run(`Error inesperado del worker: ${mensajeSeguro(err)}`, task.id);
          publicarEstado(task.id);
        } catch {
          // Si tampoco se puede escribir, la tarea queda como está hasta el siguiente arranque.
        }
      }
      await Bun.sleep(2_000);
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
  db.query(
    "UPDATE repository_actions SET state='failed', result='El servidor se reinició durante la acción. Comprueba el repositorio antes de solicitarla otra vez.' WHERE state='executing'",
  ).run();
  // Una tarea "running" al arrancar quedó sin proceso por un reinicio: se marca
  // como interrumpida, no como fallida, para que el usuario decida qué hacer.
  db.transaction(() => {
    const enCurso = db
      .query<{ id: string }, []>("SELECT id FROM tasks WHERE status = 'running'")
      .all();
    db.query("UPDATE tasks SET status = 'interrupted', error = ? WHERE status = 'running'").run(
      MENSAJE_INTERRUMPIDA,
    );
    for (const t of enCurso) {
      registrarEvento(t.id, "interrumpida", MENSAJE_INTERRUMPIDA);
      publicarEstado(t.id);
    }
  })();
  iniciarLimpieza();
  void loop();
}

export type CancelOutcome = "cancelled" | "cancelling" | "not_cancellable" | "not_found";

export function cancelTask(id: string): CancelOutcome {
  const row = db
    .query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?")
    .get(id);
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
