import { createHash } from "node:crypto";
import { db } from "../db";
import { hallarEjecutable, matarGrupo } from "../ejecutable";
import { archivosSesionAntigravity } from "../antigravity";
import type { ImagenAgente } from "../chat-adjuntos";
import { aislamientoActivo, prefijoAislamiento } from "./aislamiento";
import { prepararRedAgente } from "./red-agente";
import { entornoDelAgente, ErrorAgente, type RunResult, type Usage } from "./opencode";
import { ERROR_PRIMERA_RESPUESTA, TIEMPO_PRIMERA_RESPUESTA_MS, iniciarVigilante, leerConTope, leerLineasAcotadas } from "./proteccion";

type Totales = { input: number; output: number; reasoning: number; cacheRead: number };
const CERO: Totales = { input: 0, output: 0, reasoning: 0, cacheRead: 0 };
const sesionValida = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
const suma = (a: Totales, b: Totales): Totales => ({ input: a.input + b.input, output: a.output + b.output, reasoning: a.reasoning + b.reasoning, cacheRead: a.cacheRead + b.cacheRead });
const delta = (a: Totales, b: Totales): Totales => ({ input: Math.max(0, a.input - b.input), output: Math.max(0, a.output - b.output), reasoning: Math.max(0, a.reasoning - b.reasoning), cacheRead: Math.max(0, a.cacheRead - b.cacheRead) });
const positivo = (a: Totales) => a.input + a.output + a.reasoning > 0;

// AGY incluye thinking_tokens dentro de output_tokens; separarlos evita sumar dos veces el razonamiento.
export function usoAntigravity(valor: unknown): Totales | null {
  if (!valor || typeof valor !== "object") return null;
  const u = valor as Record<string, unknown>;
  if (![u.input_tokens, u.output_tokens].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  const numero = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  const reasoning = Math.min(numero(u.thinking_tokens), numero(u.output_tokens));
  return { input: numero(u.input_tokens), output: numero(u.output_tokens) - reasoning, reasoning, cacheRead: numero(u.cache_read_tokens) };
}

const claveTotales = (modelo: string, sesion: string) => `antigravity_uso:${modelo}:${sesion}`;
function leerTotales(modelo: string, sesion: string): Totales | null {
  const fila = db.query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key=?").get(claveTotales(modelo, sesion));
  try {
    const u = fila ? JSON.parse(fila.value) : null;
    return u && [u.input, u.output, u.reasoning, u.cacheRead].every(n => Number.isFinite(n) && n >= 0) ? u : null;
  } catch { return null; }
}
function guardarTotales(modelo: string, sesion: string, uso: Totales): void {
  db.query("INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(claveTotales(modelo, sesion), JSON.stringify(uso));
}

export type OpcionesAntigravity = {
  prompt: string; model: string; cwd: string; sessionId?: string | null; variant?: string | null;
  perfilAntigravityDir?: string; imagenes?: ImagenAgente[]; soloLectura?: boolean;
  timeoutMs?: number | null; tiempoSinActividadMs?: number | null; tiempoPrimeraRespuestaMs?: number;
  signal?: AbortSignal; extraEnv?: Record<string, string>;
  onSesion?: (id: string) => void; onLinea?: (linea: string) => void; onUso?: (uso: Usage) => void;
};

export async function runAntigravity(opts: OpcionesAntigravity): Promise<RunResult> {
  const agy = hallarEjecutable("agy");
  if (!agy) throw new Error("Antigravity CLI no está instalado en el servidor.");
  if (!/^antigravity\/[a-z][a-z0-9_.:-]{1,119}$/.test(opts.model)) throw new Error("El modelo de Antigravity no es válido.");
  if (opts.signal?.aborted) throw new Error("Ejecución cancelada");
  if (aislamientoActivo() && (!opts.perfilAntigravityDir || !archivosSesionAntigravity().length)) {
    throw new Error("Antigravity necesita su sesión de archivos iniciada por SSH como usuario orquestador. El keyring de otra máquina no se comparte con la VM.");
  }
  const red = aislamientoActivo() ? await prepararRedAgente({ modelos: [opts.model], brokerOpenCode: false }) : undefined;
  try {
    const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura, opts.imagenes, undefined, undefined, undefined, undefined, undefined, undefined, red?.directorio, opts.perfilAntigravityDir);
    const args = [agy, "-p", opts.prompt, "--output-format", "stream-json", "--model", opts.model.slice("antigravity/".length), "--sandbox", "--mode", opts.soloLectura ? "plan" : "accept-edits", "--disable-slash-commands"];
    if (sesionValida(opts.sessionId)) args.push("--conversation", opts.sessionId);
    if (opts.variant) args.push("--effort", opts.variant);
    const env = entornoDelAgente(opts.extraEnv, [opts.model]);
    // Las rutas XDG del host podrían apuntar a sesiones/credenciales de otra integración.
    for (const clave of Object.keys(env)) if (/^(XDG_|OPENCODE_|AGY_|GOOGLE_|GEMINI_)/.test(clave)) delete env[clave];
    Object.assign(env, red?.entorno);
    if (opts.perfilAntigravityDir && !aislamientoActivo()) env.HOME = opts.perfilAntigravityDir;
    const comando = aislamiento.length ? ["setsid", ...aislamiento, ...args] : process.platform === "win32" ? args : ["setsid", ...args];
    const proc = Bun.spawn(comando, { cwd: opts.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const cortar = () => { try { matarGrupo(proc); } catch { /* Ya terminó. */ } };
    const vigilante = iniciarVigilante({ tiempoSinActividadMs: opts.tiempoSinActividadMs, cortar });
    const primera = iniciarVigilante({ tiempoSinActividadMs: opts.tiempoPrimeraRespuestaMs ?? TIEMPO_PRIMERA_RESPUESTA_MS, cortar });
    const reloj = opts.timeoutMs === null ? null : setTimeout(cortar, opts.timeoutMs ?? 180_000);
    const drenaje = new AbortController();
    const abortar = () => { cortar(); drenaje.abort(); };
    opts.signal?.addEventListener("abort", abortar, { once: true });
    let sessionId = sesionValida(opts.sessionId) ? opts.sessionId : null;
    let acumulado = sessionId ? leerTotales(opts.model, sessionId) : { ...CERO };
    let texto = "";
    let resultado: Record<string, any> | null = null;
    let politicaVerificada = !aislamientoActivo();
    let falloPolitica = false;
    let usoTurno = { ...CERO };
    const pasos = new Set<number>();
    const emitirUso = (u: Totales, identificador: string) => {
      if (!positivo(u)) return;
      opts.onUso?.({ ...u, cost: 0, tokensMedidos: true, costeDisponible: false, providerEventId: `antigravity:${opts.model}:${sessionId}:${identificador}` });
      usoTurno = suma(usoTurno, u);
    };
    const alSesion = (id: unknown) => {
      if (sesionValida(id) && id !== sessionId) { sessionId = id; opts.onSesion?.(id); }
    };
    const emitirLinea = (evento: unknown) => { try { opts.onLinea?.(JSON.stringify(evento)); } catch { /* La UI no interrumpe el registro de uso. */ } };
    const lectura = leerLineasAcotadas(proc.stdout, 2 * 1024 * 1024, linea => {
      vigilante.patada();
      let evento: any;
      try { evento = JSON.parse(linea); } catch { return; }
      if (evento.event === "init") {
        alSesion(evento.conversation_id);
        if (aislamientoActivo()) {
          politicaVerificada = ["proceed-in-sandbox", "request-review"].includes(evento.init?.permission_mode)
            && (!evento.init?.model || evento.init.model === opts.model.slice("antigravity/".length));
          if (!politicaVerificada) { falloPolitica = true; cortar(); }
        }
        return;
      }
      if (evento.event === "step_update") {
        if (!politicaVerificada) { falloPolitica = true; cortar(); return; }
        const paso = evento.step_update;
        if (!paso || typeof paso !== "object") return;
        alSesion(paso.conversation_id);
        if (paso.text_delta || paso.step_type === "tool") primera.detener();
        if (typeof paso.text_delta === "string") {
          texto = (texto + paso.text_delta).slice(-1024 * 1024);
          emitirLinea({ type: "text", sessionID: sessionId, part: { type: "text", text: paso.text_delta } });
        }
        if (paso.step_type === "tool") {
          const herramienta = paso.tool_info ?? {};
          emitirLinea({ type: "tool_use", sessionID: sessionId, part: { type: "tool", callID: `agy-${paso.step_index}`, tool: paso.tool_name ?? herramienta.name ?? "herramienta", state: { status: paso.state === "DONE" ? herramienta.error ? "error" : "completed" : "running", input: herramienta.parameters ?? {}, output: herramienta.output ?? "", error: herramienta.error?.message } } });
        }
        if (paso.state === "DONE" && Number.isSafeInteger(paso.step_index) && !pasos.has(paso.step_index)) {
          pasos.add(paso.step_index);
          const uso = usoAntigravity(paso.usage);
          if (uso && sessionId) {
            emitirUso(uso, `step:${paso.step_index}`);
            if (acumulado) { acumulado = suma(acumulado, uso); guardarTotales(opts.model, sessionId, acumulado); }
          }
        }
      } else if (evento.event === "result" && !resultado) {
        resultado = evento.result && typeof evento.result === "object" ? evento.result : null;
        if (!resultado) return;
        primera.detener();
        alSesion(resultado.conversation_id);
        const totales = usoAntigravity(resultado.usage);
        if (sessionId && totales) {
          if (acumulado) emitirUso(delta(totales, acumulado), `result:${createHash("sha256").update(JSON.stringify(totales)).digest("hex")}`);
          else if (!positivo(usoTurno)) emitirLinea({ type: "text", part: { type: "text", text: "Antigravity entregó un acumulado de una sesión anterior sin una base verificable. Se conserva para medir el siguiente turno; este turno queda sin un uso nuevo verificable." } });
          guardarTotales(opts.model, sessionId, totales);
          acumulado = totales;
        }
      }
    }, drenaje.signal);
    let relojDrenaje: ReturnType<typeof setTimeout> | undefined;
    const finalizado = proc.exited.then(codigo => { cortar(); relojDrenaje = setTimeout(() => drenaje.abort(), 4000); return codigo; });
    try {
      const [, stderr, codigo] = await Promise.all([lectura, leerConTope(proc.stderr, 1024 * 1024, drenaje.signal), finalizado]);
      if (opts.signal?.aborted) throw new Error("Ejecución cancelada");
      if (falloPolitica || !politicaVerificada) throw new Error("Antigravity no confirmó el modo de permisos aislado y el modelo seleccionado. Se detuvo la ejecución; actualiza el CLI antes de reintentar.");
      if (primera.silenciado()) throw new ErrorAgente(ERROR_PRIMERA_RESPUESTA, "");
      const final = resultado as Record<string, any> | null;
      const denegadas = final?.denied_actions;
      const hayDenegadas = Array.isArray(denegadas) ? denegadas.length > 0
        : typeof denegadas === "string" ? denegadas.trim().length > 0
        : denegadas && typeof denegadas === "object" ? Object.keys(denegadas).length > 0 : Boolean(denegadas);
      const sandboxNoDisponible = /\bsandbox\b[^\n]{0,120}\b(not available|unavailable|not supported|cannot be enabled)\b/i.test(stderr);
      if (hayDenegadas || sandboxNoDisponible) {
        // AGY puede salir con SUCCESS aunque omita herramientas sin permiso; el consumo y la sesión ya se conservaron.
        const mensaje = sandboxNoDisponible
          ? "Antigravity no pudo activar su sandbox nativo en esta VM. La tarea quedó incompleta; comprueba la disponibilidad de namespaces y del sandbox antes de reintentar."
          : "Antigravity dejó la tarea incompleta: el sandbox o los permisos bloquearon una o más herramientas. Revisa la acción bloqueada y la disponibilidad del sandbox nativo en la VM; se conservan la sesión, el uso y los archivos para continuar.";
        throw new ErrorAgente(mensaje, JSON.stringify({ code: "antigravity_actions_denied", message: mensaje }));
      }
      if (codigo !== 0 || !final || final.status !== "SUCCESS") {
        const detalle = String(final?.error ?? stderr.trim() ?? "Antigravity no entregó un resultado válido.").slice(-2000);
        if (/(oauth|token|credential)/i.test(detalle) && /(read.only|permission denied|access.*denied|refresh|expired|authentication required)/i.test(detalle)) throw new Error("La sesión de Antigravity necesita renovarse por SSH como usuario orquestador. Ejecuta agy en esa terminal y vuelve a intentarlo. El agente no puede modificar su credencial de solo lectura.");
        throw new ErrorAgente(`Antigravity falló: ${detalle || "No hubo respuesta final."}`, JSON.stringify({ message: detalle.slice(-800) }));
      }
      const respuesta = typeof final.response === "string" ? final.response.slice(-1024 * 1024) : texto;
      return { text: respuesta.trim(), textoFinal: respuesta.trim(), sessionId, usage: positivo(usoTurno) ? { ...usoTurno, cost: 0, tokensMedidos: true, costeDisponible: false } : null };
    } finally {
      cortar(); drenaje.abort();
      if (reloj) clearTimeout(reloj);
      if (relojDrenaje) clearTimeout(relojDrenaje);
      primera.detener(); vigilante.detener();
      opts.signal?.removeEventListener("abort", abortar);
    }
  } finally { await red?.cerrar(); }
}
