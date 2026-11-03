import { join } from "node:path";
import { autenticacionCommandCode, aislamientoActivo, prefijoAislamiento } from "./aislamiento";
import { hallarEjecutable, lanzarEnGrupo, matarGrupo } from "../ejecutable";
import { ErrorAgente, entornoDelAgente, estimarUso, type RunResult, type Usage } from "./opencode";
import { iniciarVigilante, leerConTope, leerLineasAcotadas } from "./proteccion";
import type { ImagenAgente } from "../chat-adjuntos";

const TOPE_TEXTO = 4 * 1024 * 1024;
const TOPE_STDERR = 1024 * 1024;
const SESION_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ESFUERZOS = new Set(["low", "medium", "high", "xhigh"]);

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : null;
}

function entero(...valores: unknown[]): number {
  const valor = valores.find((item) => typeof item === "number" && Number.isFinite(item));
  return typeof valor === "number" ? Math.max(0, Math.floor(valor)) : 0;
}

export function usoCommandCode(valor: unknown): Usage | null {
  const uso = objeto(valor);
  if (!uso) return null;
  const input = entero(uso.input_tokens, uso.inputTokens, uso.prompt_tokens, uso.promptTokens);
  const output = entero(uso.output_tokens, uso.outputTokens, uso.completion_tokens, uso.completionTokens);
  const reasoning = entero(uso.reasoning_tokens, uso.reasoningTokens, uso.thinking_tokens);
  const cacheRead = entero(uso.cached_input_tokens, uso.cache_read_tokens, uso.cacheReadTokens);
  if (input + output + reasoning + cacheRead === 0) return null;
  return { input, output, reasoning, cacheRead, cost: 0, tokensMedidos: true, costeDisponible: false };
}

function comandoCommandCode(): string | null {
  return hallarEjecutable("command-code") ?? (process.platform === "win32" ? hallarEjecutable("cmdc") : hallarEjecutable("cmd"));
}

export async function runCommandCode(opts: {
  prompt: string;
  model: string;
  variant?: string | null;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  tiempoSinActividadMs?: number | null;
  signal?: AbortSignal;
  onSesion?: (sessionId: string) => void;
  onLinea?: (linea: string) => void;
  extraEnv?: Record<string, string>;
  perfilCommandCodeDir?: string;
  soloLectura?: boolean;
  imagenes?: ImagenAgente[];
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  const cli = comandoCommandCode();
  if (!cli) throw new Error("Command Code CLI no está instalado en el servidor. Instálalo desde Ajustes para usar sus modelos.");
  if (!aislamientoActivo() || !opts.perfilCommandCodeDir || !process.env.HOME) {
    throw new Error("Command Code requiere el aislamiento de Telo activo y un perfil independiente por conversación.");
  }
  if (!autenticacionCommandCode()) {
    throw new Error("No hay una sesión válida de Command Code en el servidor. Entra por SSH y ejecuta `command-code login`.");
  }

  const modelo = opts.model.startsWith("commandcode/") ? opts.model.slice("commandcode/".length) : opts.model;
  if (!modelo || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(modelo) || modelo.startsWith("/") || modelo.includes("..")) {
    throw new Error("El identificador del modelo Command Code no es válido.");
  }
  const sessionId = opts.sessionId && SESION_VALIDA.test(opts.sessionId) ? opts.sessionId : null;
  const aislamiento = prefijoAislamiento(
    opts.cwd, opts.soloLectura, opts.imagenes, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, opts.perfilCommandCodeDir,
  );
  const adjuntos = (opts.imagenes ?? []).map((imagen) => imagen.rutaVisible || imagen.ruta);
  const prompt = adjuntos.length
    ? `${opts.prompt}\n\nImágenes adjuntas para esta solicitud (lee su contenido visual):\n${adjuntos.map((ruta) => `- ${ruta}`).join("\n")}`
    : opts.prompt;
  const args = [cli, "-p"];
  if (sessionId) args.push("--resume", sessionId);
  args.push(prompt, "--model", modelo, "--output-format", "json", "--trust", "--skip-onboarding", "--no-auto-update", "--max-turns", "30");
  if (!opts.soloLectura) args.push("--yolo");
  if (opts.variant && ESFUERZOS.has(opts.variant)) args.push("--effort", opts.variant);

  const env = entornoDelAgente(opts.extraEnv, [opts.model]);
  delete env.COMMAND_CODE_API_KEY;
  delete env.COMMANDCODE_API_KEY;
  env.HOME = "/tmp/telo-commandcode-home";
  env.COMMANDCODE_SKIP_UPDATES = "true";
  const proceso = lanzarEnGrupo([...aislamiento, ...args], env);
  const cerrarGrupo = () => matarGrupo(proceso);
  const vigilante = iniciarVigilante({ tiempoSinActividadMs: opts.tiempoSinActividadMs, cortar: cerrarGrupo });
  const timer = opts.timeoutMs === null ? null : setTimeout(cerrarGrupo, opts.timeoutMs ?? 180_000);
  opts.signal?.addEventListener("abort", cerrarGrupo, { once: true });

  let salida = "";
  let respuesta = "";
  let sesion: string | null = sessionId;
  let uso: Usage | null = null;
  const fallo: { value: { statusCode: number | null; code: string | null; message: string } | null } = { value: null };
  let subtipo: string | null = null;
  const anexar = (texto: string, parte: string) => (texto + parte).slice(-TOPE_TEXTO);
  const drenaje = new AbortController();
  const lectura = leerLineasAcotadas(proceso.stdout, TOPE_TEXTO, (linea) => {
    vigilante.patada();
    try { opts.onLinea?.(linea); } catch { /* La actividad no cambia la respuesta del agente. */ }
    try {
      const evento = objeto(JSON.parse(linea));
      if (!evento) return;
      if (evento.type === "event") {
        const detalle = objeto(evento.event);
        if (detalle) salida = anexar(salida, `${typeof detalle.type === "string" ? detalle.type : "event"}\n`);
      } else if (evento.type === "result") {
        if (typeof evento.sessionId === "string" && SESION_VALIDA.test(evento.sessionId)) {
          sesion = evento.sessionId;
          try { opts.onSesion?.(sesion); } catch {}
        }
        if (typeof evento.finalText === "string") respuesta = evento.finalText.slice(-TOPE_TEXTO);
        subtipo = typeof evento.subtype === "string" ? evento.subtype : null;
        uso = usoCommandCode(evento.usage) ?? uso;
        const error = objeto(evento.error);
        const status = entero(evento.statusCode, evento.status_code, error?.statusCode, error?.status_code) || null;
        const message = [evento.message, error?.message, evento.finalText]
          .find((texto): texto is string => typeof texto === "string" && texto.trim().length > 0) ?? "Command Code no completó la solicitud.";
        if (subtipo !== "success") fallo.value = { statusCode: status, code: typeof evento.code === "string" ? evento.code : null, message: message.slice(0, 500) };
      }
    } catch { /* Los avisos que no sean NDJSON no afectan la lectura de la respuesta. */ }
  }, drenaje.signal);
  const diagnostico = leerConTope(proceso.stderr, TOPE_STDERR, drenaje.signal);
  let cierreLectura: ReturnType<typeof setTimeout> | undefined;
  const salidaPromesa = Promise.all([lectura, diagnostico, proceso.exited]);
  const cierreConDrenaje = proceso.exited.then((codigo) => {
    cerrarGrupo();
    cierreLectura = setTimeout(() => drenaje.abort(), 3_000);
    return codigo;
  });
  void cierreConDrenaje;
  let onAbort: (() => void) | undefined;
  const abortado = new Promise<never>((_, reject) => {
    onAbort = () => { cerrarGrupo(); reject(new Error("Ejecución cancelada")); };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  void abortado.catch(() => {});

  let codigo = 0;
  let stderr = "";
  try {
    const resultado = await Promise.race([salidaPromesa, abortado]);
    codigo = resultado[2];
    stderr = resultado[1];
    if (uso) {
      try { opts.onUso?.(uso); } catch {}
    }
    if (vigilante.silenciado()) throw new ErrorAgente("Command Code dejó de responder y Telo cerró el proceso por inactividad.", "");
    if (opts.signal?.aborted) throw new Error("Ejecución cancelada");
    if (codigo !== 0 || (subtipo && subtipo !== "success")) {
      const porCodigo: Record<number, { statusCode: number | null; message: string }> = {
        3: { statusCode: 401, message: "Command Code no tiene una sesión iniciada." },
        4: { statusCode: 403, message: "Command Code denegó una herramienta según su política de permisos." },
        5: { statusCode: 429, message: "Command Code alcanzó un límite de uso (rate limit)." },
        6: { statusCode: 503, message: "Command Code no pudo conectar con el servicio." },
        7: { statusCode: 500, message: "El servicio de Command Code devolvió un error." },
        8: { statusCode: null, message: "Command Code alcanzó el máximo de turnos antes de completar la respuesta." },
        9: { statusCode: null, message: "El modelo de Command Code no devolvió una respuesta." },
        10: { statusCode: 402, message: "Command Code agotó los créditos disponibles del plan." },
      };
      const mapeado = porCodigo[codigo];
      const mensaje = fallo.value?.message ?? (codigo === 0 ? "Command Code no completó la respuesta." : mapeado?.message ?? (stderr.trim().slice(-600) || `Command Code terminó con código ${codigo}.`));
      const detalle = JSON.stringify({
        type: "error",
        statusCode: fallo.value?.statusCode ?? mapeado?.statusCode ?? null,
        code: fallo.value?.code ?? (mapeado ? `commandcode_exit_${codigo}` : null),
        message: mensaje.slice(0, 500),
      });
      throw new ErrorAgente(mensaje, detalle);
    }
    if (!respuesta.trim()) throw new ErrorAgente("Command Code terminó sin devolver una respuesta.", "");
    const usoFinal = uso ?? estimarUso(prompt, respuesta.trim());
    if (!uso) {
      try { opts.onUso?.(usoFinal); } catch {}
    }
    return { text: salida.trim() ? `${salida.trim()}\n\n${respuesta.trim()}` : respuesta.trim(), textoFinal: respuesta.trim(), sessionId: sesion, usage: usoFinal };
  } finally {
    cerrarGrupo();
    await Promise.allSettled([lectura]);
    drenaje.abort();
    if (cierreLectura) clearTimeout(cierreLectura);
    if (timer) clearTimeout(timer);
    vigilante.detener();
    opts.signal?.removeEventListener("abort", cerrarGrupo);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
  }
}
