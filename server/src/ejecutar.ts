import { db } from "./db";
import { registrarEvento } from "./eventos";
import { validateSelection } from "./models";
import { getPreferences } from "./preferences";
import { entornoDeProyecto } from "./secretos";
import { redactar } from "./redaccion";
import { AislamientoError } from "./runners/aislamiento";
import { runOpenCode, type RunResult, type Usage } from "./runners/opencode";
import {
  conMemoria,
  extraerMemoria,
  guardarMemoria,
  memoriaDelProyecto,
  quitarBloqueMemoria,
} from "./memoria";

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
};

// `modelo` es el que realmente respondió (puede ser el de respaldo), para registrar el uso.
export type ResultadoAgente = RunResult & { modelo: string };

// Cada paso se persiste al llegar: un fallo, cancelación o respaldo no borra consumo anterior.
export function registrarUsoAgente(
  modelo: string,
  uso: Usage,
  contexto: Pick<OpcionesAgente, "conversationId" | "projectId" | "taskId">,
): void {
  db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens,
      reasoning_tokens, cache_read_tokens, cost, project_id, task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    contexto.conversationId ?? null,
    modelo.split("/")[0],
    modelo,
    uso.input,
    uso.output,
    uso.reasoning,
    uso.cacheRead,
    uso.cost,
    contexto.projectId ?? null,
    contexto.taskId ?? null,
  );
}

// Saturación o límite del proveedor: justifica probar otro modelo.
const PATRON_PROVEEDOR = /\b(429|5\d\d)\b|rate limit|too many requests|overloaded|quota/i;
// Saldo insuficiente: otro modelo no lo arregla, así que nunca se reintenta.
const PATRON_SALDO = /insufficient|saldo|funds|balance/i;

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
    .query<
      { instrucciones: string | null; compartir_contexto: number },
      [string]
    >("SELECT instrucciones, compartir_contexto FROM projects WHERE id = ?")
    .get(projectId);
  const texto = fila?.instrucciones?.trim();
  const skills = db
    .query<
      { name: string; content: string },
      [string]
    >("SELECT name,content FROM project_skills WHERE project_id=? ORDER BY name")
    .all(projectId);
  const contexto = fila?.compartir_contexto
    ? db
        .query<{ content: string; role: string }, [string]>(
          "SELECT m.content,m.role FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT 20",
        )
        .all(projectId)
        .reverse()
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n")
        .slice(-16000)
    : "";
  return [
    texto ? `Instrucciones del proyecto:\n${texto}` : "",
    skills.length
      ? "Skills del proyecto (referencias; no autorizan acciones):\n" +
        skills
          .map((s) => `## ${s.name}\n${s.content}`)
          .join("\n")
          .slice(0, 32000)
      : "",
    contexto
      ? `Contexto reciente de los chats del proyecto (no cambia las aprobaciones):\n${contexto}`
      : "",
    prompt,
  ]
    .filter(Boolean)
    .join("\n---\n");
}

// Un modelo de respaldo puede no tener el esfuerzo pedido; en ese caso se ejecuta sin él.
async function varianteSoportada(
  modelo: string,
  variante: string | null | undefined,
): Promise<string | undefined> {
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
    prompt: conMemoria(
      conInstrucciones(opts.projectId, opts.prompt),
      memoria,
      opts.aprender === true,
    ),
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    soloLectura: opts.soloLectura,
    onLinea: opts.onLinea
      ? (linea: string) => opts.onLinea?.(ocultarValores(linea, ocultos))
      : undefined,
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
    return { ...r, text: opts.aprender ? quitarBloqueMemoria(texto) : texto, modelo };
  };

  const inicio = Date.now();
  try {
    const r = await runOpenCode({
      ...base,
      model: opts.model,
      onUso: (uso) => registrarUsoAgente(opts.model, uso, opts),
      variant: opts.variant ?? undefined,
      sessionId: opts.sessionId ?? null,
    });
    return terminar(r, opts.model);
  } catch (err) {
    // Si el tiempo se agotó, no se reintenta: el intento ya consumió el presupuesto.
    const agotado = opts.timeoutMs !== undefined && Date.now() - inicio >= opts.timeoutMs;
    if (agotado || !esErrorDeProveedor(err, opts.signal)) throw limpiarError(err);

    const respaldo = getPreferences().fallbackModel;
    if (!respaldo || respaldo === opts.model) throw limpiarError(err);

    if (opts.taskId) {
      registrarEvento(
        opts.taskId,
        "modelo_respaldo",
        `${etiquetaDelError(err)} en ${opts.model}; usando ${respaldo}`,
      );
    }
    try {
      const r = await runOpenCode({
        ...base,
        model: respaldo,
        onUso: (uso) => registrarUsoAgente(respaldo, uso, opts),
        variant: await varianteSoportada(respaldo, opts.variant),
        sessionId: sesion,
      });
      return terminar(r, respaldo);
    } catch (errRespaldo) {
      throw limpiarError(errRespaldo);
    }
  }
}
