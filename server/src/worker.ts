import { createHash } from "node:crypto";
import { comprobarHerramientas, revisarDependencias } from "./comprobaciones-tarea";
import { itemDeLinea, registrarActividad } from "./actividad";
import { repositoryActions } from "./routes/repository-actions";
import { proyectoOcupado, reservarProyecto, soltarProyecto } from "./ocupacion";
import { capturarAlcance, comprobarAlcance } from "./alcance-plan";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { MAX_TAREAS_SIMULTANEAS } from "./limites";
import { db } from "./db";
import { prepararSubagentes } from "./subagentes";
import { publicar } from "./bus";
import { publicarEstado, registrarEvento } from "./eventos";
import { ejecutarAgente, ErrorCuota, promptContinuacion, type ResultadoAgente } from "./ejecutar";
import { sesionCompatible } from "./conversacion-contexto";
import { redactar } from "./redaccion";
import { clasificarTareaJev } from "./jev";
import {
  extraerJson,
  hashPlan,
  MAX_PLANES,
  promptAnalizador,
  promptObrero,
  promptReparacion,
  requiereAprobacion,
  sinNotas,
  validarPlan,
  validarReporte,
  type Plan,
  type Reporte,
  type Validacion,
} from "./plan";
import type { Usage } from "./runners/opencode";
import {
  abrirRegistroSalida,
  ErrorTarea,
  iniciarLimpieza,
  limpiarCopiaCancelada,
  mensajeSeguro,
  prepararCopia,
  type RegistroSalida,
} from "./workspace";

// Un worker coordina hasta diez tareas independientes en orden de llegada.
// Corre dentro del mismo proceso que la API, así que sigue activo aunque
// el teléfono o el navegador estén apagados.
//
// Una tarea pasa por dos fases: el analizador produce un plan y el obrero ejecuta el plan aprobado.
// Entre ambas, si el plan necesita aprobación, la tarea espera en `waiting_approval` sin ocupar el worker.

// Tiempo máximo de cada llamada al agente (el analizador y el obrero tienen la suya).
const TASK_TIMEOUT_MS = 30 * 60_000;
const MENSAJE_INTERRUMPIDA = "El servidor se reinició mientras la tarea corría. Puedes reanudarla o reintentarla.";
// Tamaño máximo de cada línea de salida que viaja por el canal en vivo.
const MAX_LINEA_EN_VIVO = 4096;
export const MAX_NOTAS = 2000;

const controllers = new Map<string, AbortController>();
const cancelRequested = new Set<string>();
const tareasEnEjecucion = new Set<string>();
const proyectosEnEjecucion = new Set<string>();
let wake: (() => void) | null = null;

// Error del analizador u obrero con texto pensado para el usuario.
class ErrorFase extends Error {}
// Una llamada al agente superó su tiempo.
class TiempoAgotado extends Error {}

type QueuedTask = {
  id: string;
  prompt: string;
  model: string;
  effort: string | null;
  repo_path: string | null;
  project_id: string | null;
  provider_session_id: string | null;
  provider_session_model: string | null;
  conversation_id: string | null;
  // 1 si el plan ya fue aprobado: la tarea va directo al obrero.
  aprobado: number;
  // 1 si la tarea se detuvo por cuota agotada y debe retomar su sesión (ver pausarPorCuota).
  continuar: number;
};

// Lo que cada fase necesita de la ejecución en curso.
type Contexto = {
  avisos?: string[];
  task: QueuedTask;
  cwd: string;
  controller: AbortController;
  salida: RegistroSalida;
  // Solo la primera llamada de la ejecución retoma la sesión (ver promptDeFase).
  continuar: boolean;
};

// Despierta al worker cuando entra una tarea nueva.
export function notifyWorker() {
  wake?.();
}

function nextQueued(): QueuedTask | null {
  const pendientes = db
    .query<QueuedTask, []>(
      "SELECT t.id, t.prompt, t.model, t.effort, t.provider_session_id, t.provider_session_model, t.conversation_id, t.project_id, p.repo_path AS repo_path, (t.plan_aprobado_en IS NOT NULL) AS aprobado, t.continuar FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.status = 'queued' ORDER BY t.created_at ASC, t.rowid ASC",
    )
    .all();
  const candidata = pendientes.find((task) =>
    !tareasEnEjecucion.has(task.id) &&
    (!task.project_id || (!proyectosEnEjecucion.has(task.project_id) && !proyectoOcupado(task.project_id))),
  );
  if (!candidata) return null;
  if (candidata.project_id) {
    proyectosEnEjecucion.add(candidata.project_id);
    reservarProyecto(candidata.project_id);
  }
  return candidata;
}

function estadoActual(id: string): string | null {
  return db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id)?.status ?? null;
}

function finish(
  id: string,
  status: "done" | "failed" | "cancelled",
  fields: { result?: string; error?: string; reporte?: Reporte },
): boolean {
  const terminado = db.transaction(() => {
    const cambio = db.query(
      "UPDATE tasks SET status = ?, result = ?, error = ?, reporte = COALESCE(?, reporte), finished_at = datetime('now') WHERE id = ? AND status NOT IN ('done', 'failed', 'cancelled')",
    ).run(
      status,
      fields.result ?? null,
      fields.error ?? null,
      fields.reporte ? JSON.stringify(fields.reporte) : null,
      id,
    );
    if (cambio.changes !== 1) return false;
    registrarEvento(id, "terminada", fields.error ? `${status}: ${fields.error}` : status);
    return true;
  })();
  if (!terminado) return false;
  publicarEstado(id);
  // Una tarea cancelada sin cambios libera su copia; con cambios, queda para revisión.
  if (status === "cancelled") {
    limpiarCopiaCancelada(id).catch((err) => console.error("Limpieza de la copia cancelada:", mensajeSeguro(err)));
  }
  return true;
}

function formatearRespuestaTarea(reporte: Reporte, texto: string): string {
  let mensaje = reporte.resumen?.trim() || "";
  if (!mensaje && texto.trim()) {
    mensaje = texto.trim();
  }
  const detalles: string[] = [];
  if (reporte.cambios && reporte.cambios.length > 0) {
    const lista = reporte.cambios.map((c) => `- ${c.tipo.toUpperCase()}: \`${c.archivo}\``).join("\n");
    detalles.push(`**Cambios realizados:**\n${lista}`);
  }
  if (reporte.pruebas && reporte.pruebas.length > 0) {
    const lista = reporte.pruebas.map((p) => `- \`${p.comando}\`: ${p.resultado}`).join("\n");
    detalles.push(`**Pruebas:**\n${lista}`);
  }
  if (reporte.pendientes && reporte.pendientes.length > 0) {
    const lista = reporte.pendientes.map((p) => `- ${p}`).join("\n");
    detalles.push(`**Pendientes:**\n${lista}`);
  }
  if (detalles.length > 0) {
    return mensaje ? `${mensaje}\n\n${detalles.join("\n\n")}` : detalles.join("\n\n");
  }
  return mensaje || "El agente terminó sin devolver un resumen ni cambios o pruebas verificables. No se puede confirmar el resultado.";
}

function avisarChat(id: string, texto?: string, modelo?: { model: string; effort: string | null }) {
  const conv = db.query<{ conversation_id: string | null }, [string]>("SELECT conversation_id FROM tasks WHERE id=?").get(id)?.conversation_id;
  if (!conv) return;
  if (texto) {
    db.query("INSERT INTO messages(id,conversation_id,role,content,model,effort) VALUES (?,?,'assistant',?,?,?)")
      .run(crypto.randomUUID(), conv, redactar(texto), modelo?.model ?? null, modelo?.effort ?? null);
  }
  publicar({ tipo: "chat", conversacion_id: conv, estado: "terminado" });
}

function recortarLinea(linea: string): string {
  const bytes = new TextEncoder().encode(linea);
  return bytes.length <= MAX_LINEA_EN_VIVO ? linea : new TextDecoder().decode(bytes.subarray(0, MAX_LINEA_EN_VIVO));
}

function contarPlanes(id: string): number {
  return (
    db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND kind = 'plan_creado'")
      .get(id)?.n ?? 0
  );
}

function planGuardado(id: string): Plan | null {
  const fila = db.query<{ plan: string | null }, [string]>("SELECT plan FROM tasks WHERE id = ?").get(id);
  if (!fila?.plan) return null;
  try {
    return JSON.parse(fila.plan) as Plan;
  } catch {
    return null;
  }
}

// Busca un plan válido primero en la parte final de la respuesta y después en todo el texto.
function leerPlan(respuesta: { text: string; textoFinal: string }): Validacion<Plan> {
  let motivo = "no se encontró un objeto JSON en la respuesta";
  for (const fuente of [respuesta.textoFinal, respuesta.text]) {
    const json = extraerJson(fuente);
    if (json === undefined) continue;
    const validacion = validarPlan(json);
    if (validacion.ok) return validacion;
    motivo = validacion.motivo;
  }
  return { ok: false, motivo };
}

// Una llamada al agente dentro de la tarea: usa su sesión, tiene su propio tiempo y registra su uso.
async function llamar(ctx: Contexto, prompt: string, aprender: boolean): Promise<ResultadoAgente> {
  const { task, controller, salida } = ctx;
  // Una cancelación entre dos llamadas evita lanzar la siguiente: el runner no la vería abortada.
  if (controller.signal.aborted) throw new Error("Tarea cancelada.");

  let agotado = false;
  const temporizador = setTimeout(() => {
    agotado = true;
    controller.abort();
  }, TASK_TIMEOUT_MS);
  const modeloSolicitado = task.model;
  const esfuerzoSolicitado = task.effort;
  let perfilesSubagente: Awaited<ReturnType<typeof prepararSubagentes>> = null;
  try {
    if (aprender) {
      perfilesSubagente = await prepararSubagentes({
        prompt: task.prompt,
        modelo: task.model,
        esfuerzo: task.effort,
        idEjecucion: crypto.randomUUID(),
      });
    }
    const promptAvisos = ctx.avisos?.length
      ? `${prompt}\n\nComprobaciones previas de Telo (incorpora su resolución al plan antes de ejecutar pruebas):\n${ctx.avisos.join("\n")}`
      : prompt;
    const result = await ejecutarAgente({
      prompt: perfilesSubagente ? `${perfilesSubagente.instruccion}\n\n${promptAvisos}` : promptAvisos,
      model: task.model,
      variant: task.effort,
      sessionId: task.provider_session_id,
      sessionModel: task.provider_session_model,
      cwd: ctx.cwd,
      timeoutMs: TASK_TIMEOUT_MS,
      signal: controller.signal,
      taskId: task.id,
      conversationId: task.conversation_id,
      soloLectura: estadoActual(task.id) === "analyzing",
      projectId: task.project_id,
      opencodeConfigDir: perfilesSubagente?.directorio,
      // Solo el obrero aprende del proyecto: al terminar, guarda su memoria.
      aprender,
      // Guarda la sesión apenas aparece, para poder reanudar si el servidor se reinicia a mitad.
      onSesion: (sid, model) => {
        if (sid === task.provider_session_id && model === task.provider_session_model) return;
        task.provider_session_id = sid;
        task.provider_session_model = model;
        db.query("UPDATE tasks SET provider_session_id = ?, provider_session_model = ? WHERE id = ?").run(sid, model, task.id);
        if (sid) registrarEvento(task.id, "sesion_asignada", `Modelo ${model}`);
        if (task.conversation_id) {
          db.query("UPDATE conversations SET runner_session_id = ?, runner_session_model = ? WHERE id = ?")
            .run(sid, model, task.conversation_id);
        }
      },
      onLinea: (linea) => {
        if (!linea.trim()) return;
        salida.linea(linea);
        if (task.conversation_id) {
          const turno = db.query<{id:string},[string]>("SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(task.conversation_id);
          const item = itemDeLinea(linea);
          if (turno && item) registrarActividad(task.conversation_id, turno.id, item);
        }
        publicar({ tipo: "salida", task_id: task.id, linea: recortarLinea(linea) });
      },
    });
    if (result.modelo !== modeloSolicitado || result.variante !== esfuerzoSolicitado) {
      task.model = result.modelo;
      task.effort = result.variante;
      db.query("UPDATE tasks SET model = ?, effort = ? WHERE id = ?").run(result.modelo, result.variante, task.id);
      if (task.conversation_id) {
        db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ? AND model IS ? AND effort IS ?")
          .run(result.modelo, result.variante, task.conversation_id, modeloSolicitado, esfuerzoSolicitado);
      }
    }
    return result;
  } catch (err) {
    if (agotado) throw new TiempoAgotado("El agente superó los 30 minutos sin terminar.");
    throw err;
  } finally {
    clearTimeout(temporizador);
    perfilesSubagente?.limpiar();
  }
}

// Tras una cuota agotada, la primera llamada de la ejecución retoma la sesión en vez de empezar de nuevo.
function promptDeFase(ctx: Contexto, prompt: string): string {
  if (!ctx.continuar) return prompt;
  ctx.continuar = false;
  return promptContinuacion(
    prompt,
    sesionCompatible(ctx.task.provider_session_id, ctx.task.provider_session_model, ctx.task.model),
  );
}

// Sin cuota: la tarea se detiene con el modelo que se quedó sin tokens, sin pasar por "fallida".
// Si ya tenía sesión, el usuario cambia de modelo y la sigue (ver seguirTarea); si no, se vuelve a
// ejecutar la fase desde el principio.
function pausarPorCuota(id: string, err: ErrorCuota, reanudable: boolean, conversationId: string | null) {
  db.transaction(() => {
    db.query(
      "UPDATE tasks SET status = 'sin_cuota', modelo_agotado = ?, error = ?, continuar = ?, finished_at = NULL WHERE id = ?",
    ).run(err.modelo, err.message, reanudable ? 1 : 0, id);
    if (conversationId) {
      db.query("UPDATE conversations SET cuota_modelo = ? WHERE id = ?").run(err.modelo, conversationId);
    }
    registrarEvento(id, "sin_cuota", `Modelo ${err.modelo}`);
  })();
  publicarEstado(id);
}

// Analizador: escribe el plan. Devuelve "espera" si el usuario debe aprobarlo antes del obrero,
// o "aprobado" si el plan no necesita aprobación. Tras una desviación siempre espera.
async function fasePlan(ctx: Contexto, replanificacion?: { motivo: string }): Promise<"espera" | "aprobado"> {
  const { task } = ctx;
  const contexto = replanificacion
    ? { planAnterior: planGuardado(task.id), motivo: replanificacion.motivo }
    : undefined;

  let respuesta = await llamar(ctx, promptDeFase(ctx, promptAnalizador(task.prompt, contexto)), false);
  let validacion = leerPlan(respuesta);
  if (!validacion.ok) {
    // Una reparación en la misma sesión: el analizador ya tiene el contexto de su respuesta.
    respuesta = await llamar(ctx, promptReparacion(validacion.motivo), false);
    validacion = leerPlan(respuesta);
    if (!validacion.ok) throw new ErrorFase(`El analizador no produjo un plan válido: ${validacion.motivo}.`);
  }

  const plan = validacion.valor;
  const numero = contarPlanes(task.id) + 1;
  db.transaction(() => {
    const contenido = JSON.stringify(plan), hash = hashPlan(plan);
    db.query("UPDATE tasks SET plan=?, plan_hash=?, approved_hash=NULL, plan_aprobado_en=NULL WHERE id=?").run(contenido, hash, task.id);
    registrarEvento(task.id, "plan_creado", `Versión ${numero}: ${plan.objetivo}`);
  })();

  if (!replanificacion && !requiereAprobacion(plan)) {
    db.query("UPDATE tasks SET plan_aprobado_en = datetime('now'), approved_hash=plan_hash WHERE id = ?").run(task.id);
    registrarEvento(task.id, "plan_aprobado", "Automático: el plan no necesita aprobación");
    return "aprobado";
  }

  db.query("UPDATE tasks SET status = 'waiting_approval' WHERE id = ?").run(task.id);
  registrarEvento(task.id, "plan_pendiente", "Esperando tu aprobación");
  publicarEstado(task.id);
  return "espera";
}

// Obrero: ejecuta solo el plan aprobado, en la misma sesión y carpeta que el analizador.
// Si necesita salirse del plan, devuelve el motivo en vez de un reporte.
async function faseObrero(
  ctx: Contexto,
): Promise<{ desviacion: string } | { reporte: Reporte; texto: string }> {
  const { task } = ctx;
  const plan = planGuardado(task.id);
  if (!plan) throw new ErrorFase("No hay un plan que ejecutar.");
  const aprobacion = db.query<{plan_hash:string|null; approved_hash:string|null},[string]>("SELECT plan_hash,approved_hash FROM tasks WHERE id=?").get(task.id)!;
  // Las notas se añaden al aprobar y no forman parte del hash del plan aprobado.
  if (aprobacion.plan_hash && (aprobacion.approved_hash !== aprobacion.plan_hash || hashPlan(sinNotas(plan)) !== aprobacion.plan_hash))
    throw new ErrorFase("El plan cambió después de su aprobación. Revisa y aprueba la versión actual.");
  const alcance = task.project_id ? await capturarAlcance(ctx.cwd, plan.pasos.flatMap(p => p.archivos)) : null;

  db.query("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id);
  publicarEstado(task.id);
  registrarEvento(task.id, "obrero_iniciado", `Modelo ${task.model} · ejecuta el plan aprobado`);

  const respuesta = await llamar(ctx, promptDeFase(ctx, promptObrero(plan)), true);
  if (alcance) {
    const fuera = await comprobarAlcance(alcance);
    if (fuera.length) return { desviacion: "Se detectaron cambios fuera del plan: " + fuera.slice(0,20).join(", ") + ". Se conservan para revisión." };
  }
  const reporte = validarReporte(extraerJson(respuesta.textoFinal) ?? extraerJson(respuesta.text), respuesta.textoFinal);
  if (reporte.desviacion) return { desviacion: reporte.desviacion };
  return { reporte, texto: respuesta.text };
}

// El obrero se salió del plan: la tarea vuelve al analizador con su motivo. Sin el plan aprobado
// vigente, nada se ejecuta hasta que el usuario lo apruebe de nuevo.
function pedirReplanificacion(id: string, motivo: string) {
  db.transaction(() => {
    db.query("UPDATE tasks SET status = 'analyzing', plan_aprobado_en = NULL, approved_hash=NULL WHERE id = ?").run(id);
    registrarEvento(id, "replanificada", motivo);
  })();
  publicarEstado(id);
}

async function runTask(task: QueuedTask) {
  try {
    await ejecutarTarea(task);
  } finally {
    if (task.project_id) {
      proyectosEnEjecucion.delete(task.project_id);
      soltarProyecto(task.project_id);
    }
  }
}

async function ejecutarTarea(task: QueuedTask) {
  if (estadoActual(task.id) !== "queued") return;
  const errores = comprobarHerramientas(Boolean(task.project_id));
  if (errores.length) {
    const mensaje = errores.join("\n");
    registrarEvento(task.id, "comprobacion_fallida", mensaje);
    if (finish(task.id, "failed", { error: mensaje })) {
      avisarChat(task.id, mensaje, { model: task.model, effort: task.effort });
    }
    return;
  }
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
        ? err.code === "proyecto_sin_git" ? "Inicializa Git desde la configuración del proyecto antes de lanzar una tarea." : "La copia de trabajo de la tarea no está disponible."
        : mensajeSeguro(err);
    finish(task.id, "failed", { error: `No se pudo preparar la tarea: ${texto}` });
    return;
  }

  const aprobado = task.aprobado === 1;
  // La condición evita pisar una cancelación que llegó durante la preparación.
  // Al arrancar, la marca de continuar se consume: si esta ejecución vuelve a quedarse sin cuota, se vuelve a fijar.
  const marcada = db
    .query("UPDATE tasks SET status = ?, started_at = datetime('now'), finished_at = NULL, workspace = ?, continuar = 0 WHERE id = ? AND status = 'queued'")
    .run(aprobado ? "running" : "analyzing", cwd, task.id);
  if (marcada.changes === 0) return;
  publicarEstado(task.id);
  if (!aprobado) registrarEvento(task.id, "iniciada", `Analizador · modelo ${task.model}`);

  const controller = new AbortController();
  controllers.set(task.id, controller);

  // Jev clasifica cada tarea una vez; la sugerencia no cambia el modelo ni los permisos.
  if (!db.query(
    "SELECT 1 AS ok FROM task_events WHERE task_id = ? AND kind = 'clasificacion_jev' LIMIT 1",
  ).get(task.id)) {
    void clasificarTareaJev({
      prompt: task.prompt,
      proyectoId: task.project_id,
      tareaId: task.id,
      signal: controller.signal,
    }).then((sugerencia) => {
      if (!sugerencia) return;
      const nombre: Record<string, string> = {
        correccion: "corrección",
        funcion: "función",
        interfaz: "interfaz",
        documentacion: "documentación",
        investigacion: "investigación",
        mantenimiento: "mantenimiento",
        operaciones: "operaciones",
      };
      const confianza = sugerencia.confianza > 0 ? ` · ${Math.round(sugerencia.confianza * 100)} % de confianza` : "";
      registrarEvento(
        task.id,
        "clasificacion_jev",
        `Jev sugiere «${nombre[sugerencia.categoria] ?? sugerencia.categoria}»${confianza}. Es informativo: Telo conserva el modelo y las aprobaciones.`,
      );
    }).catch(() => {
      // Clasificar es auxiliar: si Jev falla, la tarea sigue su flujo normal.
    });
  }

  let salida: RegistroSalida;
  try {
    salida = abrirRegistroSalida(task.id);
  } catch {
    // Sin registro en disco la tarea sigue; solo se pierde el historial de salida.
    salida = { linea() {}, cerrar() {} };
  }
  const avisos = revisarDependencias(cwd);
  for (const aviso of avisos) registrarEvento(task.id, "comprobacion_aviso", aviso);
  const ctx: Contexto = { task, cwd, controller, salida, continuar: task.continuar === 1, avisos };

  try {
    if (!aprobado) {
      const decision = await fasePlan(ctx);
      if (decision === "espera") return;
    }

    const resultado = await faseObrero(ctx);
    if ("desviacion" in resultado) {
      if (contarPlanes(task.id) >= MAX_PLANES) {
        throw new ErrorFase(`El obrero se desvió del plan ${MAX_PLANES} veces. Revisa el plan y reintenta la tarea.`);
      }
      pedirReplanificacion(task.id, resultado.desviacion);
      await fasePlan(ctx, { motivo: resultado.desviacion });
      return;
    }

    const { reporte, texto } = resultado;
    if (reporte.estado === "fallo") {
      if (finish(task.id, "failed", { result: texto, reporte, error: reporte.resumen })) {
        avisarChat(task.id, reporte.resumen || "La tarea no se pudo completar.", { model: task.model, effort: task.effort });
      }
    } else {
      const messageId = task.conversation_id
        ? db.query<{ id: string }, [string]>("SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(task.conversation_id)?.id
        : undefined;
      if (!finish(task.id, "done", { result: texto, reporte })) return;
      if (task.conversation_id) db.query("UPDATE conversations SET cuota_modelo=NULL WHERE id=?").run(task.conversation_id);
      avisarChat(task.id, formatearRespuestaTarea(reporte, texto), { model: task.model, effort: task.effort });
      if (task.conversation_id && task.project_id) {
        const accion = ["push","commit","pr"].find(a => planGuardado(task.id)?.requiere_aprobacion.includes(a as "commit"|"push"|"pr"));
        if (accion) {
          const resAccion = await repositoryActions.request(`http://telo/projects/${task.project_id}/acciones`, {
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:accion,conversationId:task.conversation_id,taskId:task.id,messageId}),
          });
          if (resAccion.status === 409 && accion === "push" && planGuardado(task.id)?.requiere_aprobacion.includes("commit")) {
            await repositoryActions.request(`http://telo/projects/${task.project_id}/acciones`, {
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"commit",conversationId:task.conversation_id,taskId:task.id,messageId}),
            });
          }
        }
      }
    }
  } catch (err) {
    if (cancelRequested.has(task.id)) {
      if (finish(task.id, "cancelled", { error: "Cancelada por el usuario." })) {
        avisarChat(task.id, "La tarea fue cancelada.", { model: task.model, effort: task.effort });
      }
    } else if (err instanceof ErrorCuota) {
      pausarPorCuota(task.id, err, task.provider_session_id !== null, task.conversation_id);
    } else if (err instanceof TiempoAgotado || err instanceof ErrorFase) {
      if (finish(task.id, "failed", { error: err.message })) {
        avisarChat(task.id, err.message, { model: task.model, effort: task.effort });
      }
    } else {
      if (finish(task.id, "failed", { error: mensajeSeguro(err) })) {
        avisarChat(task.id, `Error en la tarea: ${mensajeSeguro(err)}`, { model: task.model, effort: task.effort });
      }
    }
  } finally {
    salida.cerrar();
    controllers.delete(task.id);
    cancelRequested.delete(task.id);
  }
}

async function ejecutarSlot(task: QueuedTask): Promise<void> {
  try {
    await runTask(task);
  } catch (err) {
    console.error("Error inesperado en el worker:", mensajeSeguro(err));
    try {
      db.query(
        "UPDATE tasks SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ? AND status IN ('queued', 'analyzing', 'running')",
      ).run(`Error inesperado del worker: ${mensajeSeguro(err)}`, task.id);
      publicarEstado(task.id);
    } catch {
      // Si tampoco se puede escribir, la tarea queda como está hasta el siguiente arranque.
    }
  } finally {
    tareasEnEjecucion.delete(task.id);
    if (task.project_id) {
      proyectosEnEjecucion.delete(task.project_id);
      soltarProyecto(task.project_id);
    }
    notifyWorker();
  }
}

async function esperarWorker(): Promise<void> {
  let hayTareasEnCola = false;
  try {
    hayTareasEnCola = !!db.query("SELECT 1 FROM tasks WHERE status='queued' LIMIT 1").get();
  } catch {
    await Bun.sleep(2_000);
    return;
  }
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const despertar = () => {
      if (wake === despertar) wake = null;
      if (timer) clearTimeout(timer);
      resolve();
    };
    wake = despertar;
    // Una revisión externa de Git o un chat de proyecto pueden liberar la siguiente tarea.
    if (tareasEnEjecucion.size < MAX_TAREAS_SIMULTANEAS && hayTareasEnCola) timer = setTimeout(despertar, 500);
  });
}

async function loop() {
  for (;;) {
    try {
      while (tareasEnEjecucion.size < MAX_TAREAS_SIMULTANEAS) {
        const task = nextQueued();
        if (!task) break;
        tareasEnEjecucion.add(task.id);
        void ejecutarSlot(task);
      }
    } catch (err) {
      console.error("Error inesperado en el worker:", mensajeSeguro(err));
      await Bun.sleep(2_000);
    }
    // Espera un cambio cuando no hay nada listo; vuelve a revisar si la cola solo está bloqueada.
    await esperarWorker();
  }
}

// Llamar una sola vez al arrancar el servidor.
export function startWorker() {
  db.query("UPDATE repository_actions SET state='failed',result='El servidor se reinició durante la acción. Comprueba el repositorio antes de solicitarla otra vez.' WHERE state='executing'").run();
  // Una tarea "running" o "analyzing" al arrancar quedó sin proceso por un reinicio: se marca
  // como interrumpida, no como fallida, para que el usuario decida qué hacer.
  // Una tarea en "waiting_approval" no tiene proceso: sigue esperando al usuario.
  db.transaction(() => {
    const enCurso = db
      .query<{ id: string }, []>("SELECT id FROM tasks WHERE status IN ('running', 'analyzing')")
      .all();
    db.query("UPDATE tasks SET status = 'interrupted', error = ? WHERE status IN ('running', 'analyzing')").run(
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
  const row = db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id);
  if (!row) return "not_found";

  // Sin proceso en marcha (en cola, interrumpida o con el plan esperando al usuario): se cierra directamente.
  if (row.status === "queued" || row.status === "interrupted" || row.status === "waiting_approval" || row.status === "sin_cuota") {
    if (finish(id, "cancelled", { error: "Cancelada por el usuario." })) return "cancelled";
    return estadoActual(id) === "cancelled" ? "cancelled" : "not_cancellable";
  }
  if (row.status === "running" || row.status === "analyzing") {
    cancelRequested.add(id);
    registrarEvento(id, "cancelacion_pedida");
    controllers.get(id)?.abort();
    return "cancelling";
  }
  return "not_cancellable";
}

export type ResultadoPlan = "ok" | "not_found" | "not_waiting" | "stale";

// El usuario aprueba el plan: la tarea vuelve a la cola y el obrero lo ejecuta.
// Las notas se guardan en el plan y el obrero las recibe junto a él.
export function aprobarPlan(id: string, notas: string | null, hash: string): ResultadoPlan {
  const fila = db
    .query<{ status: string; plan: string | null; plan_hash:string|null }, [string]>("SELECT status, plan, plan_hash FROM tasks WHERE id = ?")
    .get(id);
  if (!fila) return "not_found";
  if (fila.status !== "waiting_approval" || !fila.plan) return "not_waiting";

  if (!hash || hash !== fila.plan_hash) return "stale";
  const plan = JSON.parse(fila.plan) as Plan;
  if (notas) plan.notas = redactar(notas).slice(0, MAX_NOTAS);
  let resultado: ResultadoPlan = "ok";
  db.transaction(() => {
    const actualizado = db.query(
      "UPDATE tasks SET status = 'queued', plan = ?, plan_aprobado_en = datetime('now'), approved_hash = ? WHERE id = ? AND status = 'waiting_approval' AND plan_hash = ? AND plan IS NOT NULL",
    ).run(
      JSON.stringify(plan),
      hash,
      id,
      hash,
    );
    if (actualizado.changes !== 1) {
      const actual = db.query<{ status: string; plan: string | null }, [string]>("SELECT status, plan FROM tasks WHERE id = ?").get(id);
      resultado = !actual ? "not_found" : actual.status !== "waiting_approval" || !actual.plan ? "not_waiting" : "stale";
      return;
    }
    registrarEvento(id, "plan_aprobado", notas ? "Con notas para el obrero" : null);
  })();
  if (resultado !== "ok") return resultado;
  publicarEstado(id);
  notifyWorker();
  return "ok";
}

// El usuario no aprueba el plan: la tarea termina como cancelada. Para intentarlo de nuevo, se reintenta.
export function rechazarPlan(id: string, motivo: string | null): ResultadoPlan {
  const estado = estadoActual(id);
  if (estado === null) return "not_found";
  if (estado !== "waiting_approval") return "not_waiting";
  registrarEvento(id, "plan_rechazado", motivo);
  finish(id, "cancelled", { error: "Plan rechazado por el usuario." });
  return "ok";
}
