import { aislamientoActivo, prefijoAislamiento, verificarPoliticaCredencialesCodex } from "./aislamiento";
import { prepararRedAgente } from "./red-agente";
import { join } from "node:path";
import { carpetaEntregables } from "../entregables";
import { hallarEjecutable } from "../ejecutable";
import { ErrorAgente, entornoDelAgente, estimarUso, type RunResult, type Usage } from "./opencode";
import { iniciarVigilante, leerConTope, leerLineasAcotadas, TIEMPO_PRIMERA_RESPUESTA_MS, ERROR_PRIMERA_RESPUESTA, esActividadUtil } from "./proteccion";
import type { ImagenAgente } from "../chat-adjuntos";
import { argumentosConfigMcpCodex, type ServidorMcpAgente } from "../conexiones-mcp";
import { deltaNoRegistrada, guardarTotalesSesion, leerTotalesSesion, sumarTotales, totalesDelEventoTokenCount, type TotalesCodex } from "./tokens-codex";

// El texto que devuelve Codex rara vez pasa de 1 MB; si pasa, se conserva la cola.
const TOPE_TEXTO_AGENTE = 1024 * 1024;
const TOPE_STDERR_AGENTE = 1024 * 1024;

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function normalizarErrorCodex(valor: unknown): { mensaje: string | null; detalleProveedor: string } {
  const evento = objeto(valor);
  const error = objeto(evento?.error);
  const data = objeto(error?.data);
  const item = objeto(evento?.item);
  const errorItem = objeto(item?.error);
  const mensajeInicial = [evento?.message, error?.message, data?.message, item?.message, errorItem?.message]
    .find((campo): campo is string => typeof campo === "string") ?? null;
  let embebido: Record<string, unknown> | null = null;
  if (mensajeInicial) {
    try { embebido = objeto(JSON.parse(mensajeInicial)); } catch { /* mensaje de texto normal */ }
  }
  const registros = [evento, error, data, item, errorItem, embebido, objeto(embebido?.error), objeto(embebido?.data)]
    .filter((registro): registro is Record<string, unknown> => registro !== null);
  const mensaje = registros
    .map((registro) => registro.message ?? registro.detail)
    .find((campo): campo is string => typeof campo === "string") ?? mensajeInicial;
  const statusCode = registros
    .map((registro) => registro.statusCode ?? registro.status ?? registro.httpStatus)
    .find((campo) => typeof campo === "number" || (typeof campo === "string" && /^\d{3}$/.test(campo))) ?? null;
  const code = registros
    .map((registro) => registro.code ?? registro.errorCode)
    .find((campo): campo is string => typeof campo === "string") ?? null;
  // No se guarda el evento completo: puede traer IDs de sesión, cabeceras u otros metadatos internos.
  return {
    mensaje,
    detalleProveedor: JSON.stringify({ type: "error", statusCode, code, message: mensaje?.slice(0, 500) ?? "" }),
  };
}

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
  perfilCodexDir?: string;
  servidoresMcp?: ServidorMcpAgente[];
  prompt: string;
  model: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  // Vigilante de inactividad: corta el grupo del proceso si lleva sin emitir nada más del
  // tope (misma protección que el runner de OpenCode, ver proteccion.ts).
  tiempoSinActividadMs?: number | null;
  tiempoPrimeraRespuestaMs?: number;
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

  if (aislamientoActivo()) {
    if (!opts.perfilCodexDir || !process.env.HOME) throw new Error("Codex requiere un perfil aislado de Telo para esta ejecución.");
    verificarPoliticaCredencialesCodex(process.env.HOME);
  }
  const red = aislamientoActivo() ? await prepararRedAgente({ modelos: [opts.model], brokerOpenCode: false }) : undefined;
  try {
    const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura, opts.imagenes, undefined, undefined, undefined, undefined, undefined, opts.perfilCodexDir, red?.directorio);
    const rutasImagenes = (opts.imagenes ?? []).flatMap((imagen) => ["--image", aislamientoActivo() ? imagen.rutaVisible : imagen.ruta]);

  // Codex toma `-c` como prioridad de ejecución y lee MCP remoto desde la tabla mcp_servers.
    const ajustesMcp = argumentosConfigMcpCodex(opts.servidoresMcp ?? []);

  // Los reintentos ante 429/5xx y el respaldo viven a nivel ejecutar (reintento-transitorio.test.ts):
  // aquí corre una sola vez para no pisar esa política ni consumir su presupuesto de espera.
    return await intentoCodex({ ...opts, entornoRed: red?.entorno, codex, modeloCodex, aislamiento, rutasImagenes, ajustesMcp });
  } finally { await red?.cerrar(); }
}

async function intentoCodex(opts: OpcionesCodex & {
  entornoRed?: Record<string, string>;
  codex: string;
  modeloCodex: string;
  aislamiento: string[];
  rutasImagenes: string[];
  ajustesMcp: string[];
}): Promise<RunResult> {
  const sesionPrevia = opts.sessionId && /^[0-9a-fA-F-]{1,128}$/.test(opts.sessionId) ? opts.sessionId : null;
  const cero: TotalesCodex = { input: 0, cached: 0, output: 0, reasoning: 0 };
  const base = sesionPrevia ? await leerTotalesSesion(sesionPrevia, opts.perfilCodexDir) : cero;
  if (opts.signal?.aborted) throw new Error("Ejecución cancelada");
  // Los workspaces de tarea de Telo no siempre son clones Git. Esta opción pertenece
  // a `codex exec`, no a la raíz del CLI; el aislamiento y el sandbox siguen activos.
  const args: string[] = ["codex", "-c", 'approval_policy="never"', "-c", `sandbox_mode="${opts.soloLectura ? "read-only" : "workspace-write"}"`, ...opts.ajustesMcp];
  if (!opts.soloLectura) args.push("-c", "sandbox_workspace_write.network_access=true", "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify([carpetaEntregables(opts.cwd)])}`);
  // El nivel de esfuerzo del modelo va como ajuste puntual del CLI, igual que los MCP.
  if (opts.variant) args.push("-c", `model_reasoning_effort="${opts.variant}"`);
  if (sesionPrevia) {
    args.push("exec", "--skip-git-repo-check", "resume", "--json", ...opts.rutasImagenes, "-m", opts.modeloCodex, sesionPrevia, opts.prompt);
  } else {
    args.push("exec", "--skip-git-repo-check", "--json", ...opts.rutasImagenes, "-m", opts.modeloCodex, "-C", opts.cwd, "--", opts.prompt);
  }

  const comandoCompleto = opts.aislamiento.length > 0 ? ["setsid", ...opts.aislamiento, ...args] : process.platform === "win32" ? ["cmd", "/c", ...args] : ["setsid", ...args];

  // Aislar variables sensibles usando entornoDelAgente para nunca filtrar TELO_* ni secretos del servidor
  const env = entornoDelAgente(opts.extraEnv, [opts.model]);
  Object.assign(env, opts.entornoRed);
  if (opts.perfilCodexDir) env.CODEX_HOME = aislamientoActivo() ? join(process.env.HOME!, ".codex") : opts.perfilCodexDir;

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
  let ultimoErrorProveedor: string | null = null;
  let falloFatalCodex = false;

  // Contabilidad incremental (A-m2): los `token_count` traen la cuenta acumulada de la
  // sesión; los `turn.completed` ya se registran como deltas. Al acabar (éxito, fallo o
  // cancelación) se registra solo lo que ningún turno completado haya contado ya.
  const porTurno: TotalesCodex = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let ultimo: TotalesCodex | null = null;
  let pendienteRegistrado = false;
  const registrarPendiente = () => {
    if (pendienteRegistrado) return;
    pendienteRegistrado = true;
    // Sin base verificable de una sesión antigua no se factura su historial como gasto nuevo.
    const faltante = base ? deltaNoRegistrada(base, ultimo, porTurno) : null;
    const completados = base ? sumarTotales(base, porTurno) : cero;
    if (ultimo) guardarTotalesSesion(sessionId, {
      input: Math.max(ultimo.input, completados.input), cached: Math.max(ultimo.cached, completados.cached),
      output: Math.max(ultimo.output, completados.output), reasoning: Math.max(ultimo.reasoning, completados.reasoning),
    });
    else if (base) guardarTotalesSesion(sessionId, completados);
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

  const drenaje = new AbortController();
  const primeraRespuesta = iniciarVigilante({ tiempoSinActividadMs: opts.tiempoPrimeraRespuestaMs ?? TIEMPO_PRIMERA_RESPUESTA_MS, cortar: () => terminarGrupo(proc) });
  const lectura = leerLineasAcotadas(proc.stdout, 2 * 1024 * 1024, (l) => {
          vigilante.patada();
          try { opts.onLinea?.(l); } catch { /* La actividad no interrumpe la lectura de uso. */ }

          try {
            const ev = JSON.parse(l);
            if (esActividadUtil(ev)) primeraRespuesta.detener();
            if (ev.type === "thread.started" && ev.thread_id) {
              sessionId = ev.thread_id;
              opts.onSesion?.(ev.thread_id);
            } else if (ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
              // Tope de RAM para la respuesta: si pasa, se conserva la cola.
              const siguiente = text + (text ? "\n\n" : "") + ev.item.text;
              text = siguiente.length > TOPE_TEXTO_AGENTE ? siguiente.slice(-TOPE_TEXTO_AGENTE) : siguiente;
            } else if (ev.item?.type === "error") {
              const error = normalizarErrorCodex(ev);
              ultimoError = error.mensaje ?? ultimoError;
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
                ultimo = totales;
              }
            }
            if (ev.type === "error" || ev.type === "turn.failed") {
              falloFatalCodex = true;
              const error = normalizarErrorCodex(ev);
              ultimoError = error.mensaje ?? ultimoError;
              ultimoErrorProveedor = error.detalleProveedor;
            }
          } catch {
            // Línea no JSON
          }
  }, drenaje.signal);

  // Un descendiente que conserve stdout abierto no puede retener el slot tras morir el padre.
  // Se drena primero para conservar los últimos tokens y después se cierran las tuberías.
  let relojDrenaje: ReturnType<typeof setTimeout> | undefined;
  const cerrarGrupo = () => {
    if (relojDrenaje) return;
    terminarGrupo(proc);
    relojDrenaje = setTimeout(() => drenaje.abort(), 4_000);
  };
  const finalizado = proc.exited.then((codigo) => { cerrarGrupo(); return codigo; });

  const salidaPromesa = Promise.all([
    lectura,
    leerConTope(proc.stderr, TOPE_STDERR_AGENTE, drenaje.signal),
    finalizado,
  ]);

  let onAbort: (() => void) | undefined;
  const abortado = new Promise<never>((_, reject) => {
    onAbort = () => {
      cerrarGrupo();
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

    if (primeraRespuesta.silenciado()) throw new ErrorAgente(ERROR_PRIMERA_RESPUESTA, "");
    if (code !== 0 || falloFatalCodex) {
      const detalle = ultimoError
        || stderr.trim()
        || (vigilante.silenciado()
          ? `El proceso de Codex no emitió nada durante ${Math.round(((opts.tiempoSinActividadMs as number) ?? 0) / 60_000)} minutos y se cortó por silencio`
          : falloFatalCodex ? "Codex informó que el turno falló." : `Codex terminó con código ${code}`);
      const detalleProveedor = ultimoErrorProveedor ?? JSON.stringify({
        message: detalle.slice(-800).replace(/\S*[\\/]\S*/g, " "),
      });
      throw new ErrorAgente(`Codex falló: ${detalle}`, detalleProveedor);
    }

    let usoFinal = usage as Usage | null;
    const medidoPendiente = base ? deltaNoRegistrada(base, ultimo, porTurno) : null;
    if ((!usoFinal || (usoFinal.input === 0 && usoFinal.output === 0)) && medidoPendiente) {
      usoFinal = { input: medidoPendiente.input, output: medidoPendiente.output, reasoning: medidoPendiente.reasoning, cacheRead: medidoPendiente.cached, cost: 0, tokensMedidos: true, costeDisponible: false };
    } else if (!usoFinal || (usoFinal.input === 0 && usoFinal.output === 0)) {
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
    cerrarGrupo();
    // También al cancelar se conservan los eventos que ya estaban en las tuberías.
    await Promise.allSettled([lectura]);
    drenaje.abort();
    if (relojDrenaje) clearTimeout(relojDrenaje);
    if (timer) clearTimeout(timer);
    vigilante.detener();
    primeraRespuesta.detener();
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    registrarPendiente();
  }
}
