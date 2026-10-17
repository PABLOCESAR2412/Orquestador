import { db } from "./db";
import { registrarEvento } from "./eventos";
import { validateSelection } from "./models";
import { getPreferences } from "./preferences";
import { entornoDeProyecto } from "./secretos";
import { entornoProveedores } from "./claves-proveedor";
import { redactar } from "./redaccion";
import { AislamientoError } from "./runners/aislamiento";
import { ErrorAgente, runOpenCode, type RunResult, type Usage } from "./runners/opencode";
import { conMemoria, extraerMemoria, guardarMemoria, guardarPropuestaMemoria, memoriaDelProyecto, quitarBloqueMemoria } from "./memoria";
import { conservarMemoriaSegunJev, puntuarMemoriaJev } from "./jev";
import { inyectarSkillsEnPrompt } from "./resolucion-skills";

// Longitud mínima de un valor de secreto para ocultarlo en la salida. Más corto, aparecería en texto normal.
const MINIMO_OCULTAR = 4;

// Punto único para lanzar un agente, lo usan tareas y chats. Añade el entorno del proyecto
// y, si el proveedor falla por saturación, reintenta una vez con el modelo de respaldo.

export type OpcionesAgente = {
  prompt: string;
  model: string;
  variant?: string | null;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onSesion?: (sessionId: string) => void;
  onLinea?: (linea: string) => void;
  // Solo para la tarea: registra el cambio de modelo en su historial.
  taskId?: string;
  projectId?: string | null;
  conversationId?: string | null;
  soloLectura?: boolean;
  // Solo para la tarea: pide al agente escribir la memoria del proyecto al final y la guarda.
  aprender?: boolean;
  // Solo para chats: añade instrucciones de estilo (respuestas concretas y verificables). Las tareas no lo usan.
  estilo?: "chat";
};

// `modelo` es el que realmente respondió (puede ser el de respaldo), para registrar el uso.
export type ResultadoAgente = RunResult & { modelo: string };

// Un único límite para chats y tareas, sin depender del proveedor elegido.
const MAX_AGENTES_SIMULTANEOS = 10;
let agentesActivos = 0;
const colaAgentes: { signal?: AbortSignal; resolve: () => void; reject: (error: Error) => void; cancelar?: () => void }[] = [];

function liberarAgente(): void {
  const siguiente = colaAgentes.shift();
  if (siguiente) {
    if (siguiente.cancelar) siguiente.signal?.removeEventListener("abort", siguiente.cancelar);
    siguiente.resolve();
    return;
  }
  agentesActivos -= 1;
}

async function reservarAgente(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new Error("Ejecución cancelada.");
  if (agentesActivos < MAX_AGENTES_SIMULTANEOS && colaAgentes.length === 0) {
    agentesActivos += 1;
    return liberarAgente;
  }
  await new Promise<void>((resolve, reject) => {
    const espera: (typeof colaAgentes)[number] = { signal, resolve, reject };
    if (signal) {
      espera.cancelar = () => {
        const indice = colaAgentes.indexOf(espera);
        if (indice !== -1) colaAgentes.splice(indice, 1);
        reject(new Error("Ejecución cancelada."));
      };
      signal.addEventListener("abort", espera.cancelar, { once: true });
    }
    colaAgentes.push(espera);
  });
  return liberarAgente;
}

export function canonicalizarModelo(modelo: string): string {
  if (modelo.startsWith("opencode/gemini-")) {
    return modelo.replace("opencode/gemini-", "google/gemini-");
  }
  return modelo;
}

export function proveedorDeModelo(modelo: string): string {
  const m = canonicalizarModelo(modelo);
  if (m.startsWith("google/") || m.includes("/google/") || /gemini/i.test(m)) {
    return "google";
  }
  if (m.startsWith("codex/") || m === "codex" || m.includes("/codex/")) {
    return "codex";
  }
  if (m.startsWith("openai/") || m.includes("/openai/")) {
    return "openai";
  }
  if (m.startsWith("groq/") || m.includes("/groq/")) {
    return "groq";
  }
  if (m.startsWith("nvidia/") || m.includes("/nvidia/")) {
    return "nvidia";
  }
  if (m.startsWith("openrouter/")) {
    return "openrouter";
  }
  return m.split("/")[0] || "opencode";
}

export function estimarCosteGemini(modelo: string, inputTokens: number, outputTokens: number): number {
  const esPro = /pro/i.test(modelo);
  const tarifaInput = esPro ? 1.25 / 1_000_000 : 0.075 / 1_000_000;
  const tarifaOutput = esPro ? 5.00 / 1_000_000 : 0.30 / 1_000_000;
  return Math.round((inputTokens * tarifaInput + outputTokens * tarifaOutput) * 10_000) / 10_000;
}

// Cada paso se persiste al llegar: fallos, cancelaciones y respaldos conservan el consumo previo.
export function registrarUsoAgente(
  modelo: string,
  uso: Usage,
  contexto: Pick<OpcionesAgente, "conversationId" | "projectId" | "taskId">,
): void {
  const modeloCanonico = canonicalizarModelo(modelo);
  const provider = proveedorDeModelo(modeloCanonico);
  let costo = uso.cost;
  let costPrecision = uso.costeDisponible === undefined ? "desconocida" : uso.costeDisponible ? "estimado" : "no_disponible";

  if (costo === 0 && (uso.input > 0 || uso.output > 0) && provider === "google") {
    costo = estimarCosteGemini(modeloCanonico, uso.input, uso.output);
    costPrecision = "estimado";
  }

  db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens,
      reasoning_tokens, cache_read_tokens, cost, project_id, task_id, tokens_precision, cost_precision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(), contexto.conversationId ?? null, provider, modeloCanonico,
    uso.input, uso.output, uso.reasoning, uso.cacheRead, costo,
    contexto.projectId ?? null, contexto.taskId ?? null,
    uso.tokensMedidos === undefined ? "desconocida" : uso.tokensMedidos ? "medida" : "no_disponible",
    costPrecision,
  );
}

// Saturación, error de servidor o límite del proveedor: justifica probar otro modelo.
const PATRON_PROVEEDOR = /\b(429|5\d\d)\b|rate limit|too many requests|overloaded|quota|server error|internal error|service unavailable|bad gateway|gateway timeout|temporarily unavailable/i;
// Saldo insuficiente: otro modelo no lo arregla, así que nunca se reintenta.
const PATRON_SALDO = /insufficient|saldo|funds|balance/i;
// Cuota agotada: el modelo ya no da más tokens (límite de uso, saldo o 429). Se distingue de un fallo
// genérico para que la tarea o el chat se detengan y el usuario elija otro modelo antes de seguir.
const PATRON_CUOTA = /\b429\b|rate.?limit|too many requests|quota|cuota|insufficient|saldo|funds|balance|usage limit|free usage|exhaust|agotad/i;

// Se lanza cuando el modelo se quedó sin cuota. `modelo` es el último que se intentó; `sessionId`, la
// sesión del agente (si llegó a abrirse), para continuarla después con otro modelo.
export class ErrorCuota extends Error {
  constructor(
    readonly modelo: string,
    readonly sessionId: string | null,
  ) {
    super(`Se acabó la cuota del modelo ${modelo}.`);
  }
}

// Solo cuenta lo que dijo el proveedor (ErrorAgente.detalleProveedor), no el mensaje completo.
export function esErrorDeCuota(err: unknown): boolean {
  if (err instanceof ErrorCuota) return true;
  if (err instanceof AislamientoError) return false;
  return PATRON_CUOTA.test(textoDelProveedor(err));
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Valores de secretos del proyecto que el agente pudo imprimir. Se ocultan en su salida, en el
// registro, en el canal en vivo y en el resultado. Se cubren también las versiones escapadas en JSON.
export function valoresAOcultar(propias?: Record<string, string>): string[] {
  const valores = new Set<string>();
  for (const valor of Object.values(propias ?? {})) {
    if (valor.length < 4) continue;
    valores.add(valor);
    const escapado = JSON.stringify(valor).slice(1, -1);
    if (escapado !== valor) valores.add(escapado);
  }
  // Primero los más largos, para que un valor no deje a medias a otro que lo contiene.
  return [...valores].sort((a, b) => b.length - a.length);
}

// Oculta los valores de secretos del proyecto y las credenciales con formato conocido.
export function ocultarValores(texto: string, valores: string[]): string {
  return redactar(texto, valores, MINIMO_OCULTAR);
}

// Lo que dijo el proveedor para clasificar un fallo. Con ErrorAgente, solo el evento de error o la cola
// de la salida sin rutas: el mensaje completo trae la ruta del servidor y del proyecto.
function textoDelProveedor(err: unknown): string {
  return err instanceof ErrorAgente ? err.detalleProveedor : mensajeDe(err);
}

// Saturación del proveedor (429, 5xx, límite): justifica reintentar con el modelo de respaldo. Como la
// cuota, mira solo lo que dijo el proveedor, para que una ruta con «429» no active el respaldo.
export function esErrorDeProveedor(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof AislamientoError) return false;
  if (signal?.aborted) return false;
  const texto = textoDelProveedor(err);
  if (PATRON_SALDO.test(texto)) return false;
  return PATRON_PROVEEDOR.test(texto);
}

// Solo el código HTTP, nunca el texto del error: el detalle llega a la interfaz.
function etiquetaDelError(err: unknown): string {
  const texto = textoDelProveedor(err);
  const codigo = texto.match(/\b(429|5\d\d)\b/);
  if (codigo) return codigo[1];
  if (/server error|internal error|service unavailable/i.test(texto)) return "500";
  if (/rate limit|too many requests/i.test(texto)) return "429";
  return "Error del proveedor";
}

// Obtiene un resumen conciso de los otros chats recientes del proyecto si compartir_contexto está activo.
export function contextoCompartidoProyecto(projectId: string, omitirConversationId?: string | null): string {
  const params: string[] = [projectId];
  let filtroConv = "";
  if (omitirConversationId) {
    filtroConv = "AND c.id != ?";
    params.push(omitirConversationId);
  }
  const filas = db
    .query<{ id: string; title: string; ultimo_mensaje: string | null }, string[]>(
      `SELECT c.id, c.title,
         (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user', 'assistant') ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS ultimo_mensaje
       FROM conversations c
       WHERE c.project_id = ? ${filtroConv}
       ORDER BY c.created_at DESC, c.rowid DESC
       LIMIT 3`,
    )
    .all(...params);

  if (filas.length === 0) return "";
  const resumenes = filas
    .filter((f) => f.title || f.ultimo_mensaje)
    .map((f) => {
      const extracto = f.ultimo_mensaje ? f.ultimo_mensaje.slice(0, 150).replace(/\s+/g, " ").trim() : "Sin actividad reciente";
      return `- Chat "${f.title || "Sin título"}": ${extracto}`;
    });
  if (resumenes.length === 0) return "";
  return `Contexto compartido de otros chats del proyecto:\n${resumenes.join("\n")}`;
}

// Instrucciones del proyecto: se anteponen al prompt de sus tareas y chats. No se guardan ni en
// tasks.prompt ni en el mensaje del chat, así que cambiarlas afecta a los siguientes envíos.
export function conInstrucciones(projectId: string | null | undefined, prompt: string, conversationId?: string | null): string {
  if (!projectId) return prompt;
  const fila = db
    .query<{ instrucciones: string | null; compartir_contexto: number }, [string]>("SELECT instrucciones, compartir_contexto FROM projects WHERE id = ?")
    .get(projectId);
  const texto = fila?.instrucciones?.trim();
  const compartido = fila?.compartir_contexto ? contextoCompartidoProyecto(projectId, conversationId) : "";

  if (!texto && !compartido) return prompt;
  const partes: string[] = [];
  if (texto) partes.push(`Instrucciones del proyecto (escritas por el dueño):\n${texto}`);
  if (compartido) partes.push(compartido);
  return `${partes.join("\n\n")}\n---\n${prompt}`;
}

// Estilo de respuesta de los chats: concreto, con rutas y resultados, y sin repetir la pregunta.
// Va delante del prompt en cada envío; la sesión de OpenCode no lo guarda por sí sola.
export const ESTILO_CHAT = [
  "Estilo de respuesta, presentación y razonamiento nativo de Telo (no lo menciones en la respuesta):",
  "- Investiga antes de actuar: inspecciona los archivos, dependencias, documentación o skills relevantes del proyecto antes de proponer cambios.",
  "- Si necesitas documentarte sobre librerías o frameworks modernos, usa skills del proyecto (como context7) o inspecciona el código existente.",
  "- Si una tarea requiere investigación profunda o pasos complejos, organízate paso a paso y puedes coordinar o apoyarte en subagentes especializados.",
  "- Jerarquía y títulos Markdown: Usa ## (H2) para secciones clave estructuradas (ej. ## Diagnóstico, ## Solución, ## Cambios) y ### (H3) para subsecciones. EVITA el uso de títulos gigantes # (H1) en respuestas de chat para preservar la armonía visual.",
  "- Respuestas directas en un solo párrafo: Si la pregunta o consulta es conceptual, breve o directa, responde en un único párrafo claro, conciso y directo, sin forzar listas innecesarias ni encabezados.",
  "- Cuándo usar listas numeradas vs viñetas:",
  "  * Usa listas numeradas (1., 2., 3.) ÚNICAMENTE cuando exista un orden secuencial estricto, una guía de pasos cronológicos o prioridades ordenadas.",
  "  * Usa viñetas con guiones (-) para listas de elementos independientes, inventario de archivos modificados, características o hallazgos sin orden secuencial.",
  "- Patrón Diagnóstico (Problema -> Causa -> Solución): Al explicar anomalías, errores o bugs técnicos, presenta de forma estructurada:",
  "  * **Problema:** Qué falló o qué comportamiento indeseado ocurre.",
  "  * **Causa:** Por qué ocurrió, citando la condición o línea exacta.",
  "  * **Solución:** Cómo se resuelve o se resolvió de forma verificable.",
  "- Tablas Markdown: Úsalas para comparar alternativas, resumir parámetros de configuración, métricas o contrastar estados antes/después.",
  "- Diagramas visuales Mermaid: Al explicar arquitectura, flujos de datos, dependencias o máquinas de estados, genera un bloque ```mermaid (usando flowchart TD, flowchart LR, sequenceDiagram o stateDiagram) cuando el gráfico aporte claridad inmediata.",
  "- Cita de archivos y código: Cita siempre las rutas relativas exactas de los archivos entre comillas invertidas (ej. `web/src/components/chat-comandos.tsx` o `server/src/plan.ts`) para que el visor interactivo de Telo genere automáticamente las pastillas de archivo navegables.",
  "- Comprobaciones y Clean Code: Si ejecutaste un comando o prueba, reporta el resultado concreto. Mantén clean code, tipos estrictos y no dejes stubs ni regresiones.",
].join("\n");

export function conEstilo(prompt: string, estilo?: "chat", esChatDeProyecto = false): string {
  if (estilo !== "chat") return prompt;
  const formatoVisual = esChatDeProyecto
    ? [
        "- Al explicar la arquitectura o relaciones de este proyecto, incluye un bloque ```mermaid con un flowchart válido cuando el gráfico ayude a entenderlo; evita diagramas en respuestas simples o cuando falte información.",
        "- Para comparar opciones o componentes usa una tabla Markdown; para mostrar la estructura de carpetas usa un bloque ```text con un árbol legible. No inventes archivos ni relaciones.",
      ].join("\n")
    : "";
  return `${ESTILO_CHAT}${formatoVisual ? `\n${formatoVisual}` : ""}\n---\n${prompt}`;
}

// Primer prompt tras una cuota agotada: retoma la sesión del agente en vez de empezar de nuevo.
// Pide no repetir lo hecho y responder con el mismo formato que el prompt original.
export function promptContinuacion(prompt: string): string {
  return [
    "Continúa donde te quedaste. La ejecución anterior se detuvo porque se agotó la cuota del modelo que la llevaba.",
    "Ya tienes el contexto de lo que hiciste: no repitas pasos completados ni empieces de cero.",
    "Si una acción no llegó a terminar, revísala antes de repetirla. Después termina lo que falta.",
    "Responde con el mismo formato que pide la instrucción de abajo.",
    "---",
    prompt,
  ].join("\n");
}

// Un modelo de respaldo puede no tener el esfuerzo pedido; en ese caso se ejecuta sin él.
async function varianteSoportada(modelo: string, variante: string | null | undefined): Promise<string | undefined> {
  if (!variante) return undefined;
  try {
    const check = await validateSelection(modelo, variante);
    return check.ok ? variante : undefined;
  } catch {
    return undefined;
  }
}

async function ejecutarAgenteReservado(opts: OpcionesAgente): Promise<ResultadoAgente> {
  // Claves de proveedor (Ajustes) y secretos del proyecto. Si un nombre se repite, gana el del proyecto.
  const propias: Record<string, string> = {
    ...entornoProveedores(),
    ...(opts.projectId ? entornoDeProyecto(opts.projectId) : {}),
  };
  const ocultos = valoresAOcultar(propias);

  // La sesión se recuerda aunque el primer intento falle, para continuarla con el respaldo.
  let sesion = opts.sessionId ?? null;
  const alSesion = (id: string) => {
    sesion = id;
    opts.onSesion?.(id);
  };
  const memoria = opts.projectId ? memoriaDelProyecto(opts.projectId).texto : null;
  const base = {
    prompt: conEstilo(
      conMemoria(
        conInstrucciones(opts.projectId, inyectarSkillsEnPrompt(opts.prompt, opts.projectId).promptFinal, opts.conversationId),
        memoria,
        opts.aprender === true,
      ),
      opts.estilo,
      opts.estilo === "chat" && Boolean(opts.projectId),
    ),
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    onLinea: opts.onLinea ? (linea: string) => opts.onLinea?.(ocultarValores(linea, ocultos)) : undefined,
    extraEnv: propias,
    onSesion: alSesion,
    soloLectura: opts.soloLectura,
  };

  // Un error puede traer fragmentos de la salida del agente: también se limpia.
  const limpiarError = (err: unknown): unknown => {
    if (err instanceof Error && !(err instanceof AislamientoError)) {
      err.message = ocultarValores(err.message, ocultos);
    }
    return err;
  };

  // El resultado sale con los secretos ocultos. Si la tarea aprende, el bloque de memoria se guarda
  // (ya limpio de secretos) y no se muestra en el resultado.
  const terminar = (r: RunResult, modelo: string): ResultadoAgente => {
    const texto = ocultarValores(r.text, ocultos);
    const textoFinal = ocultarValores(r.textoFinal, ocultos);
    if (opts.aprender && opts.projectId) {
      const nueva = extraerMemoria(texto);
      if (nueva) {
        const projectId = opts.projectId;
        // La memoria es auxiliar: no retiene un turno del agente mientras Jev responde.
        void (async () => {
          try {
            const memoriaAnterior = memoriaDelProyecto(projectId).texto;
            const proyecto = db.query<{ name: string }, [string]>("SELECT name FROM projects WHERE id = ?").get(projectId)?.name ?? "Proyecto";
            let puntuacion: number | null = null;
            let evaluadaPorJev = false;
            try {
              puntuacion = await puntuarMemoriaJev({
                proyectoId: projectId,
                tareaId: opts.taskId,
                signal: opts.signal,
                estado: {
                  proyecto,
                  tarea: opts.prompt.slice(0, 10_000),
                  memoriaAnterior,
                  propuesta: nueva,
                },
              });
              evaluadaPorJev = puntuacion !== null;
            } catch {
              evaluadaPorJev = false;
            }

            if (evaluadaPorJev && puntuacion !== null) {
              const guardar = conservarMemoriaSegunJev(puntuacion) === true;
              if (opts.taskId) {
                try {
                  registrarEvento(
                    opts.taskId,
                    "memoria_evaluada",
                    `Jev puntuó la propuesta ${puntuacion.toFixed(2)} de 3. Telo ${guardar ? "la guardó" : "la dejó fuera"} por su relevancia para futuras tareas.`,
                  );
                } catch {
                  // Si la tarea se borró antes de la evaluación, la decisión aún se puede aplicar al proyecto.
                }
              }
              if (guardar) guardarMemoria(projectId, nueva);
            } else {
              // Jev no estuvo disponible o no pudo evaluar: se guarda como propuesta pendiente de revisión por el usuario
              guardarPropuestaMemoria(projectId, nueva, opts.taskId);
              if (opts.taskId) {
                try {
                  registrarEvento(
                    opts.taskId,
                    "memoria_propuesta",
                    "La memoria no pudo ser evaluada por Jev; quedó guardada como propuesta pendiente de revisión por el usuario.",
                  );
                } catch {
                  // Se ignora si la tarea ya no existe
                }
              }
            }
          } catch (err) {
            console.error("Guardar la memoria del proyecto:", mensajeDe(err));
          }
        })();
      }
    }
    return { ...r, text: opts.aprender ? quitarBloqueMemoria(texto) : texto, textoFinal: opts.aprender ? quitarBloqueMemoria(textoFinal) : textoFinal, modelo };
  };

  const inicio = Date.now();
  try {
    const r = await runOpenCode({
      ...base,
      model: opts.model,
      variant: opts.variant ?? undefined,
      sessionId: opts.sessionId ?? null,
      onUso: (uso) => registrarUsoAgente(opts.model, uso, opts),
    });
    return terminar(r, opts.model);
  } catch (err) {
    // Si el tiempo se agotó o se canceló, no se reintenta ni se trata como cuota.
    const agotado = opts.timeoutMs !== undefined && Date.now() - inicio >= opts.timeoutMs;
    if (agotado || opts.signal?.aborted) throw limpiarError(err);
    // Un modelo sin cuota se marca como tal (ver ErrorCuota); cualquier otro error sigue como antes.
    const comoCuota = (e: unknown, modelo: string): unknown =>
      esErrorDeCuota(e) ? new ErrorCuota(modelo, sesion) : limpiarError(e);
    // Ante fallo transitorio del servidor (HTTP 5xx o error inesperado del proveedor),
    // intentamos un reintento breve antes de recurrir al respaldo o detener la tarea.
    if (
      esErrorDeProveedor(err, opts.signal) &&
      /server error|internal error|5\d\d|service unavailable/i.test(textoDelProveedor(err))
    ) {
      await Bun.sleep(1200);
      if (!opts.signal?.aborted) {
        try {
          const r = await runOpenCode({
            ...base,
            model: opts.model,
            variant: opts.variant ?? undefined,
            sessionId: opts.sessionId ?? null,
            onUso: (uso) => registrarUsoAgente(opts.model, uso, opts),
          });
          return terminar(r, opts.model);
        } catch (reintentoErr) {
          err = reintentoErr;
        }
      }
    }

    const respaldo = getPreferences().fallbackModel;
    if (!respaldo || respaldo === opts.model) throw comoCuota(err, opts.model);

    if (opts.taskId) {
      registrarEvento(opts.taskId, "modelo_respaldo", `${etiquetaDelError(err)} en ${opts.model}; usando ${respaldo}`);
    }
    try {
      const r = await runOpenCode({
        ...base,
        model: respaldo,
        variant: await varianteSoportada(respaldo, opts.variant),
        sessionId: sesion,
        onUso: (uso) => registrarUsoAgente(respaldo, uso, opts),
      });
      return terminar(r, respaldo);
    } catch (errRespaldo) {
      throw comoCuota(errRespaldo, respaldo);
    }
  }
}

export async function ejecutarAgente(opts: OpcionesAgente): Promise<ResultadoAgente> {
  const liberar = await reservarAgente(opts.signal);
  try {
    return await ejecutarAgenteReservado(opts);
  } finally {
    liberar();
  }
}
