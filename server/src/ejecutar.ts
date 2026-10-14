import { db } from "./db";
import { registrarEvento } from "./eventos";
import { validateSelection } from "./models";
import { getPreferences } from "./preferences";
import { entornoDeProyecto } from "./secretos";
import { redactar } from "./redaccion";
import { AislamientoError } from "./runners/aislamiento";
import { ErrorAgente, runOpenCode, type RunResult } from "./runners/opencode";
import { conMemoria, extraerMemoria, guardarMemoria, memoriaDelProyecto, quitarBloqueMemoria } from "./memoria";

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
  // Solo para la tarea: pide al agente escribir la memoria del proyecto al final y la guarda.
  aprender?: boolean;
  // Solo para chats: añade instrucciones de estilo (respuestas concretas y verificables). Las tareas no lo usan.
  estilo?: "chat";
};

// `modelo` es el que realmente respondió (puede ser el de respaldo), para registrar el uso.
export type ResultadoAgente = RunResult & { modelo: string };

// Saturación o límite del proveedor: justifica probar otro modelo.
const PATRON_PROVEEDOR = /\b(429|5\d\d)\b|rate limit|too many requests|overloaded|quota/i;
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
  if (err instanceof ErrorAgente) return PATRON_CUOTA.test(err.detalleProveedor);
  if (err instanceof AislamientoError) return false;
  return PATRON_CUOTA.test(mensajeDe(err));
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

function esErrorDeProveedor(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof AislamientoError) return false;
  if (signal?.aborted) return false;
  const mensaje = mensajeDe(err);
  if (PATRON_SALDO.test(mensaje)) return false;
  return PATRON_PROVEEDOR.test(mensaje);
}

// Solo el código HTTP, nunca el texto del error: el detalle llega a la interfaz.
function etiquetaDelError(err: unknown): string {
  const codigo = mensajeDe(err).match(/\b(429|5\d\d)\b/);
  return codigo ? codigo[1] : "Error del proveedor";
}

// Instrucciones del proyecto: se anteponen al prompt de sus tareas y chats. No se guardan ni en
// tasks.prompt ni en el mensaje del chat, así que cambiarlas afecta a los siguientes envíos.
export function conInstrucciones(projectId: string | null | undefined, prompt: string): string {
  if (!projectId) return prompt;
  const fila = db
    .query<{ instrucciones: string | null }, [string]>("SELECT instrucciones FROM projects WHERE id = ?")
    .get(projectId);
  const texto = fila?.instrucciones?.trim();
  if (!texto) return prompt;
  return `Instrucciones del proyecto (escritas por el dueño):\n${texto}\n---\n${prompt}`;
}

// Estilo de respuesta de los chats: concreto, con rutas y resultados, y sin repetir la pregunta.
// Va delante del prompt en cada envío; la sesión de OpenCode no lo guarda por sí sola.
export const ESTILO_CHAT = [
  "Estilo de respuesta (no lo menciones en la respuesta):",
  "- Empieza con una frase que diga qué vas a hacer y por qué.",
  "- Sé concreto: cita rutas de archivo (con línea cuando aplique) y nombres exactos de funciones, comandos y configuraciones.",
  "- Si ejecutaste un comando, muestra el resultado que importa, no solo la conclusión.",
  "- Si cambiaste archivos, lista cada uno y di qué cambió en él.",
  "- Si verificaste algo, di cómo (comando o prueba) y qué resultado dio. Si no pudiste comprobarlo, dilo sin rodeos.",
].join("\n");

export function conEstilo(prompt: string, estilo?: "chat"): string {
  return estilo === "chat" ? `${ESTILO_CHAT}\n---\n${prompt}` : prompt;
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

export async function ejecutarAgente(opts: OpcionesAgente): Promise<ResultadoAgente> {
  const propias = opts.projectId ? entornoDeProyecto(opts.projectId) : undefined;
  const ocultos = valoresAOcultar(propias);

  // La sesión se recuerda aunque el primer intento falle, para continuarla con el respaldo.
  let sesion = opts.sessionId ?? null;
  const alSesion = (id: string) => {
    sesion = id;
    opts.onSesion?.(id);
  };
  const memoria = opts.projectId ? memoriaDelProyecto(opts.projectId).texto : null;
  const base = {
    prompt: conEstilo(conMemoria(conInstrucciones(opts.projectId, opts.prompt), memoria, opts.aprender === true), opts.estilo),
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    onLinea: opts.onLinea ? (linea: string) => opts.onLinea?.(ocultarValores(linea, ocultos)) : undefined,
    extraEnv: propias,
    onSesion: alSesion,
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
        try {
          guardarMemoria(opts.projectId, nueva);
        } catch (err) {
          console.error("Guardar la memoria del proyecto:", mensajeDe(err));
        }
      }
    }
    return { ...r, text: opts.aprender ? quitarBloqueMemoria(texto) : texto, textoFinal, modelo };
  };

  const inicio = Date.now();
  try {
    const r = await runOpenCode({
      ...base,
      model: opts.model,
      variant: opts.variant ?? undefined,
      sessionId: opts.sessionId ?? null,
    });
    return terminar(r, opts.model);
  } catch (err) {
    // Si el tiempo se agotó o se canceló, no se reintenta ni se trata como cuota.
    const agotado = opts.timeoutMs !== undefined && Date.now() - inicio >= opts.timeoutMs;
    if (agotado || opts.signal?.aborted) throw limpiarError(err);
    // Un modelo sin cuota se marca como tal (ver ErrorCuota); cualquier otro error sigue como antes.
    const comoCuota = (e: unknown, modelo: string): unknown =>
      esErrorDeCuota(e) ? new ErrorCuota(modelo, sesion) : limpiarError(e);
    if (!esErrorDeProveedor(err, opts.signal)) throw comoCuota(err, opts.model);

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
      });
      return terminar(r, respaldo);
    } catch (errRespaldo) {
      throw comoCuota(errRespaldo, respaldo);
    }
  }
}
