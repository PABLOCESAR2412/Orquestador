import { aislamientoActivo, prefijoAislamiento } from "./aislamiento";
import { hallarEjecutable } from "../ejecutable";
import { entornoDelAgente, estimarUso, type RunResult, type Usage } from "./opencode";
import { iniciarVigilante, leerConTope } from "./proteccion";
import type { ImagenAgente } from "../chat-adjuntos";
import { argumentosConfigMcpCodex, type ServidorMcpAgente } from "../conexiones-mcp";
import { deltaNoRegistrada, sumarTotales, totalesDelEventoTokenCount, type TotalesCodex } from "./tokens-codex";

// El texto que devuelve Codex rara vez pasa de 1 MB; si pasa, se conserva la cola.
const TOPE_TEXTO_AGENTE = 1024 * 1024;
const TOPE_STDERR_AGENTE = 1024 * 1024;

// Termina el grupo de procesos para que herramientas e hijos no queden como zombies huérfanos.
function terminarGrupo(proc: { pid: number; kill: () => void }) {
  if (process.platform === "win32") {
    try {
      proc.kill();
    } catch {}
    return;
  }
  const enviar = (señal: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid, señal);
    } catch {
      try {
        proc.kill();
      } catch {}
    }
  };
  enviar("SIGTERM");
  setTimeout(() => enviar("SIGKILL"), 3_000).unref();
}

interface OpcionesCodex {
  servidoresMcp?: ServidorMcpAgente[];
  prompt: string;
  model: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  // Vigilante de inactividad: corta el grupo del proceso si lleva sin emitir nada más del
  // tope (misma protección que el runner de OpenCode, ver proteccion.ts).
  tiempoSinActividadMs?: number | null;
  // Nivel de esfuerzo del modelo (variant); en Codex es el reasoning del modelo.
  variant?: string | null;
  signal?: AbortSignal;
  onSesion?: (sessionId: string) => void;
  onLinea?: (linea: string) => void;
  extraEnv?: Record<string, string>;
  soloLectura?: boolean;
  imagenes?: ImagenAgente[];
  onUso?: (uso: Usage) => void;
}

// Ejecución de tareas con el CLI de Codex cuando el modelo seleccionado es de Codex (codex/*).
// Utiliza la sesión activa autenticada con ChatGPT (`codex login --device-auth`).
export async function runCodex(opts: OpcionesCodex): Promise<RunResult> {
  const codex = hallarEjecutable("codex");
  if (!codex) {
    throw new Error("El CLI de Codex no está instalado en el servidor. Instálalo desde Ajustes para usar modelos de Codex.");
  }

  // Quitar el prefijo "codex/" para obtener el nombre del modelo que espera Codex (ej: gpt-6-luna)
  const modeloCodex = opts.model.startsWith("codex/") ? opts.model.slice("codex/".length) : opts.model;

  const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura, opts.imagenes);
  const rutasImagenes = (opts.imagenes ?? []).flatMap((imagen) => ["--image", aislamientoActivo() ? imagen.rutaVisible : imagen.ruta]);

  // Codex toma `-c` como prioridad de ejecución y lee MCP remoto desde la tabla mcp_servers.
  const ajustesMcp = argumentosConfigMcpCodex(opts.servidoresMcp ?? []);

  // Los reintentos ante 429/5xx y el respaldo viven a nivel ejecutar (reintento-transitorio.test.ts):
  // aquí corre una sola vez para no pisar esa política ni consumir su presupuesto de espera.
  return await intentoCodex({ ...opts, codex, modeloCodex, aislamiento, rutasImagenes, ajustesMcp });
}

async function intentoCodex(opts: OpcionesCodex & {
  codex: string;
  modeloCodex: string;
  aislamiento: string[];
  rutasImagenes: string[];
  ajustesMcp: string[];
}): Promise<RunResult> {
  const args: string[] = ["codex", ...opts.ajustesMcp];
  // El nivel de esfuerzo del modelo va como ajuste puntual del CLI, igual que los MCP.
  if (opts.variant) args.push("-c", `model_reasoning_effort="${opts.variant}"`);
  if (opts.sessionId && /^[0-9a-fA-F-]+$/.test(opts.sessionId)) {
    args.push("exec", "resume", "--json", ...opts.rutasImagenes, "--dangerously-bypass-approvals-and-sandbox", "-m", opts.modeloCodex, opts.sessionId, opts.prompt);
  } else {
    args.push("exec", "--json", ...opts.rutasImagenes, "--dangerously-bypass-approvals-and-sandbox", "-m", opts.modeloCodex, "-C", opts.cwd, "--", opts.prompt);
  }

  const comandoCompleto = opts.aislamiento.length > 0 ? ["setsid", ...opts.aislamiento, ...args] : process.platform === "win32" ? ["cmd", "/c", ...args] : ["setsid", ...args];

  // Aislar variables sensibles usando entornoDelAgente para nunca filtrar TELO_* ni secretos del servidor
  const env = entornoDelAgente(opts.extraEnv);

  const proc = Bun.spawn(comandoCompleto, {
    cwd: opts.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Vigilante de inactividad compartido con OpenCode (proteccion.ts): corta el grupo si el
  // CLI lleva más del tope sin emitir una línea.
  const vigilante = iniciarVigilante({
    pid: proc.pid,
    tiempoSinActividadMs: opts.tiempoSinActividadMs,
    cortar: () => terminarGrupo(proc),
  });

  const timer = opts.timeoutMs === null ? null : setTimeout(() => {
    terminarGrupo(proc);
  }, opts.timeoutMs ?? 180_000);

  let sessionId: string | null = opts.sessionId ?? null;
  let text = "";
  let usage: Usage | null = null;
  let ultimoError: string | null = null;

  // Contabilidad incremental (A-m2): los `token_count` traen la cuenta acumulada de la
  // sesión; los `turn.completed` ya se registran como deltas. Al acabar (éxito, fallo o
  // cancelación) se registra solo lo que ningún turno completado haya contado ya.
  const porTurno: TotalesCodex = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let base: TotalesCodex | null = null;
  let ultimo: TotalesCodex | null = null;
  let pendienteRegistrado = false;
  const registrarPendiente = () => {
    if (pendienteRegistrado) return;
    pendienteRegistrado = true;
    const faltante = deltaNoRegistrada(base, ultimo, porTurno);
    if (faltante && (faltante.input > 0 || faltante.output > 0 || faltante.reasoning > 0)) {
      const pendiente: Usage = {
        input: faltante.input,
        output: faltante.output,
        reasoning: faltante.reasoning,
        cacheRead: faltante.cached,
        cost: 0,
        tokensMedidos: true,
        costeDisponible: false,
      };
      try {
        opts.onUso?.(pendiente);
      } catch {
        // Un fallo al registrar el uso no cambia el resultado de la ejecución.
      }
    }
  };

  const lector = async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let remanente = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        remanente += decoder.decode(value, { stream: true });
        const lineas = remanente.split("\n");
        remanente = lineas.pop() ?? "";

        for (const linea of lineas) {
          const l = linea.trim();
          if (!l) continue;
          vigilante.patada();
          opts.onLinea?.(l);

          try {
            const ev = JSON.parse(l);
            if (ev.type === "thread.started" && ev.thread_id) {
              sessionId = ev.thread_id;
              opts.onSesion?.(ev.thread_id);
            } else if (ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
              // Tope de RAM para la respuesta: si pasa, se conserva la cola.
              const siguiente = text + (text ? "\n\n" : "") + ev.item.text;
              text = siguiente.length > TOPE_TEXTO_AGENTE ? siguiente.slice(-TOPE_TEXTO_AGENTE) : siguiente;
            } else if (ev.item?.type === "error" && typeof ev.item.message === "string") {
              ultimoError = ev.item.message;
            } else if (ev.type === "turn.completed" && ev.usage) {
              const u = ev.usage;
              usage = {
                input: u.input_tokens ?? 0,
                output: u.output_tokens ?? 0,
                reasoning: u.reasoning_output_tokens ?? 0,
                cacheRead: u.cached_input_tokens ?? 0,
                cost: 0,
                tokensMedidos: true,
                costeDisponible: false,
              };
              if (usage.input > 0 || usage.output > 0) opts.onUso?.(usage);
              porTurno.input += Math.max(0, usage.input);
              porTurno.cached += Math.max(0, usage.cacheRead);
              porTurno.output += Math.max(0, usage.output);
              porTurno.reasoning += Math.max(0, usage.reasoning);
            } else {
              const totales = totalesDelEventoTokenCount(ev);
              if (totales) {
                if (!base) base = totales;
                ultimo = totales;
              }
            }
            if (ev.type === "error" || ev.type === "turn.failed") {
              const msg = ev.message ?? ev.error?.message;
              if (typeof msg === "string") {
                try {
                  const subJson = JSON.parse(msg);
                  ultimoError = subJson.error?.message || subJson.message || msg;
                } catch {
                  ultimoError = msg;
                }
              }
            }
          } catch {
            // Línea no JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const salidaPromesa = Promise.all([
    lector(),
    leerConTope(proc.stderr, TOPE_STDERR_AGENTE),
    proc.exited,
  ]);

  let onAbort: (() => void) | undefined;
  const abortado = new Promise<never>((_, reject) => {
    onAbort = () => {
      terminarGrupo(proc);
      reject(new Error("Ejecución cancelada"));
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  // Promise.race no consume el rechazo del perdedor si el proceso termina primero.
  void abortado.catch(() => {});

  let stderr = "";
  let code = 0;
  try {
    const res = await Promise.race([salidaPromesa, abortado]);
    stderr = res[1];
    code = res[2];

    if (code !== 0) {
      const detalle = ultimoError
        || stderr.trim()
        || (vigilante.silenciado()
          ? `El proceso de Codex no emitió nada durante ${Math.round(((opts.tiempoSinActividadMs as number) ?? 0) / 60_000)} minutos y se cortó por silencio`
          : `Codex terminó con código ${code}`);
      throw new Error(`Codex falló: ${detalle}`);
    }

    let usoFinal = usage as Usage | null;
    if (!usoFinal || (usoFinal.input === 0 && usoFinal.output === 0)) {
      usoFinal = estimarUso(opts.prompt, text.trim());
      opts.onUso?.(usoFinal);
    }

    registrarPendiente();
    return {
      text: text.trim(),
      textoFinal: text.trim(),
      sessionId,
      usage: usoFinal,
    };
  } finally {
    if (timer) clearTimeout(timer);
    vigilante.detener();
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    registrarPendiente();
  }
}
