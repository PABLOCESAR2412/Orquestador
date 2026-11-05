import { closeSync, fstatSync, openSync, readSync, readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aislamientoActivo, prefijoAislamiento } from "./aislamiento";
import { esVariableReservada, SECRETOS_SOLO_SERVIDOR } from "../secretos";
import type { ImagenAgente } from "../chat-adjuntos";
import { config } from "../config";
import { iniciarVigilante, leerConTope, TIEMPO_PRIMERA_RESPUESTA_MS, ERROR_PRIMERA_RESPUESTA, esActividadUtil } from "./proteccion";
import type { ServidorMcpAgente } from "../conexiones-mcp";
import { configuracionOpenCodeMcp } from "../conexiones-mcp";
import { esCompactacionOpenCode } from "../../../shared/compactacion";
import { pluginSeguimientoOpenCode } from "./seguimiento-opencode";
import { PROVEEDORES_CON_CLAVE } from "../claves-proveedor";
import { rtkDisponible } from "../rtk";
import { prepararRedAgente, type RedAgente } from "./red-agente";

// Tope de memoria para la salida del agente: 16 MB en total (arranque de 1 MB con los eventos
// de sesión, cola de 15 MB con el detalle del fallo; el medio se recorta).
const TOPE_SALIDA_AGENTE = 16 * 1024 * 1024;
const CABEZA_SALIDA_AGENTE = 1 * 1024 * 1024;
const MARCA_SALIDA_AGENTE = "\n[… salida recortada para no crecer en RAM — se conserva arranque y cola …]\n";
const TOPE_STDERR_AGENTE = 1024 * 1024;

// Id de sesión de OpenCode. Empieza por letra o cifra: así nunca se lee como una opción de la CLI.
const PATRON_SESION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Verdadero si el id puede guardarse y reusarse con -s. Lo que no cumple se descarta.
export function sesionValida(id: unknown): id is string {
  return typeof id === "string" && PATRON_SESION.test(id);
}

export type Usage = { input: number; output: number; reasoning: number; cacheRead: number; cost: number; tokensMedidos?: boolean; tokensEstimados?: boolean; costeDisponible?: boolean; providerEventId?: string };

export function estimarUso(prompt: string, respuesta: string): Usage {
  return {
    input: Math.max(1, Math.ceil(prompt.length / 4)),
    output: Math.max(0, Math.ceil(respuesta.length / 4)),
    reasoning: 0,
    cacheRead: 0,
    cost: 0,
    tokensMedidos: false,
    tokensEstimados: true,
    costeDisponible: false,
  };
}
// `text` une el texto del agente sin resúmenes internos. `textoFinal` es lo dicho después de su última
// herramienta: la respuesta, sin la narración de los pasos (que el chat muestra aparte).
export type RunResult = { text: string; textoFinal: string; sessionId: string | null; usage: Usage | null };

type OpenCodeEvent = {
  type: string;
  sessionID?: string;
  error?: unknown;
  part?: {
    id?: string;
    type?: string;
    text?: string;
    cost?: number;
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number } };
  };
};

// Algunos proveedores omiten campos de uso o usan nombres alternativos. Nunca se guardan NaN ni contadores negativos.
export function usoDelEvento(ev: OpenCodeEvent): Usage | null {
  const tipo = ev.type || "";
  const tipoParte = ev.part?.type || "";
  const t =
    ev.part?.tokens ||
    (ev as any).tokens ||
    (ev as any).usage ||
    (ev.part as any)?.usage ||
    (ev.part as any)?.token_usage;

  const esEventoFin =
    tipo === "step_finish" ||
    tipo === "step-finish" ||
    tipo === "turn_finish" ||
    tipo === "finish" ||
    tipo === "usage" ||
    tipoParte === "step_finish" ||
    tipoParte === "step-finish" ||
    Boolean(t);

  if (!esEventoFin && !t) return null;

  const numero = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  const costVal = (ev.part as any)?.cost ?? (ev as any).cost;

  const input = numero(t?.input ?? t?.prompt_tokens ?? t?.input_tokens ?? t?.promptTokens ?? t?.promptTokenCount);
  const output = numero(t?.output ?? t?.completion_tokens ?? t?.output_tokens ?? t?.completionTokens ?? t?.candidatesTokenCount);
  const reasoning = numero(t?.reasoning ?? t?.reasoning_tokens);
  const cacheRead = numero(t?.cache?.read ?? t?.cached_tokens ?? t?.cacheReadTokens);
  const cost = numero(costVal);
  const providerEventId = sesionValida(ev.sessionID) && sesionValida(ev.part?.id)
    ? `opencode:step:${ev.sessionID}:${ev.part.id}` : undefined;

  if (input === 0 && output === 0 && cost === 0 && !esEventoFin) return null;

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cost,
    tokensMedidos: input > 0 || output > 0,
    costeDisponible: typeof costVal === "number" && Number.isFinite(costVal) && costVal >= 0,
    ...(providerEventId ? { providerEventId } : {}),
  };
}

function parseEvents(stdout: string): OpenCodeEvent[] {
  const events: OpenCodeEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // línea que no es JSON: se ignora
    }
  }
  return events;
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

// OpenCode incluye en el evento error cabeceras, sessionID y otros metadatos que no ayudan
// al usuario. Conservamos solo el código y el mensaje del proveedor, con un primer paso claro.
export function explicarErrorProveedor(evento: unknown): string {
  const ev = registro(evento);
  const error = registro(ev?.error);
  const data = registro(error?.data);
  const status = typeof data?.statusCode === "number"
    ? data.statusCode
    : typeof error?.statusCode === "number" ? error.statusCode : null;
  const mensaje = typeof data?.message === "string"
    ? data.message
    : typeof error?.message === "string" ? error.message : "";

  if (status === 402 && /more credits|fewer max_tokens|can only afford/i.test(mensaje)) {
    const solicitados = mensaje.match(/requested up to\s+([\d,]+)/i)?.[1];
    const disponibles = mensaje.match(/can only afford\s+([\d,]+)/i)?.[1];
    const detalle = solicitados && disponibles
      ? `El saldo alcanza para ${disponibles} tokens, pero la solicitud pide hasta ${solicitados}.`
      : "El saldo disponible no alcanza para el máximo de tokens de esta solicitud.";
    return `El proveedor rechazó la solicitud por presupuesto insuficiente. ${detalle} Por dónde empezar: cambia a un modelo o proveedor con un máximo de salida menor, o añade créditos en OpenRouter. Telo no permite ajustar max_tokens directamente.`;
  }
  if (status === 402) {
    return "El proveedor rechazó la solicitud porque el saldo o los créditos disponibles no alcanzan. Por dónde empezar: revisa el saldo de la cuenta del proveedor o usa otro modelo con presupuesto disponible.";
  }
  if (status === 401) {
    return "El proveedor rechazó la clave o la sesión. Por dónde empezar: revisa la conexión y la clave del proveedor en Ajustes.";
  }
  if (status === 403) {
    return "El proveedor no autorizó el acceso a este modelo. Por dónde empezar: comprueba que tu cuenta tenga acceso al modelo o elige otro.";
  }
  if (status === 429) {
    return "El proveedor limitó las solicitudes temporalmente. Por dónde empezar: espera un momento o elige otro modelo/proveedor.";
  }
  const error500Generico = /^Unexpected server error(?:\. Check server logs for details\.)?$/i.test(mensaje.trim());
  if ((status !== null && status >= 500) || error500Generico || /server error|internal error|service unavailable|bad gateway|gateway timeout|temporarily unavailable/i.test(mensaje)) {
    const detalleMsg = mensaje ? `: «${mensaje.slice(0, 160)}»` : "";
    if (error500Generico) {
      return `OpenCode devolvió «Unexpected server error», que Telo clasifica como HTTP 500${detalleMsg}. El evento no identifica si falló el proveedor, su gateway o la conexión, así que no permite precisar el origen. Por dónde empezar: revisa la actividad técnica y prueba otro modelo o proveedor.`;
    }
    return `El proveedor del modelo tuvo un error temporal en sus servidores${status ? ` (HTTP ${status})` : ""}${detalleMsg}. Por dónde empezar: espera unos momentos y vuelve a intentarlo; si el problema persiste, selecciona otro modelo en el selector (por ejemplo, Claude, GPT o Groq).`;
  }
  if (mensaje) return `El proveedor devolvió un error${status === null ? "" : ` (HTTP ${status})`}: ${mensaje.slice(0, 500)}`;
  return `OpenCode informó un error del proveedor${status === null ? "" : ` (HTTP ${status})`}. Revisa «Ver proceso» y vuelve a intentarlo.`;
}

function failureDetail(stdout: string, stderr: string, events: OpenCodeEvent[], code: number): string {
  if (code === 143) return "OpenCode terminó con código 143 (SIGTERM) antes de completar la tarea.";
  const errorEvent = events.find((e) => e.type === "error");
  if (errorEvent) return explicarErrorProveedor(errorEvent);
  return (stderr || stdout).trim().slice(-800) || "sin salida";
}

// Error de una ejecución del agente. `detalleProveedor` es lo que dijo el proveedor para clasificar el
// fallo (cuota, saturación): el evento de error, o la cola de la salida sin rutas del servidor. Así una
// carpeta llamada "saldo" o "cuota" no convierte en cuota un error que no lo es.
export class ErrorAgente extends Error {
  constructor(
    mensaje: string,
    readonly detalleProveedor: string,
    readonly reintentosInternosAgotados = false,
  ) {
    super(mensaje);
  }
}

export function detalleDelProveedor(stdout: string, stderr: string, events: OpenCodeEvent[]): string {
  const errorEvent = events.find((e) => e.type === "error");
  if (errorEvent) {
    const evento = registro(errorEvent);
    const error = registro(evento?.error);
    const data = registro(error?.data);
    const dataError = registro(data?.error);
    const candidatos = [data, dataError, error, evento].filter((valor): valor is Record<string, unknown> => valor !== null);
    const statusCode = candidatos
      .map((valor) => valor.statusCode ?? valor.status ?? valor.httpStatus)
      .find((valor) => typeof valor === "number" || (typeof valor === "string" && /^\d{3}$/.test(valor))) ?? null;
    const code = candidatos
      .map((valor) => valor.code ?? valor.errorCode)
      .find((valor): valor is string => typeof valor === "string") ?? null;
    const message = candidatos
      .map((valor) => valor.message ?? valor.detail)
      .find((valor): valor is string => typeof valor === "string") ?? "";
    // Conserva estado, código y mensaje para clasificar proveedores con formatos distintos,
    // sin copiar cabeceras, IDs de sesión ni otros metadatos del evento.
    return JSON.stringify({ type: "error", statusCode, code, message: message.slice(0, 500) });
  }
  return (stderr || stdout).trim().slice(-800).replace(/\S*[\\/]\S*/g, " ");
}

// El agente solo hereda estas variables. Todo lo demás del servidor se omite: claves de otros
// servicios, tokens y cualquier variable que se agregue al entorno del VM en el futuro.
const VARIABLES_PERMITIDAS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TZ", "TMPDIR",
  "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
]);
const PREFIJOS_PERMITIDOS = ["LC_", "XDG_", "OPENCODE_"];

// Si un proveedor necesita una clave como variable de entorno, el operador la permite por nombre
// en el archivo de entorno: TELO_AGENTE_VARIABLES=NOMBRE_1,NOMBRE_2. Nunca aplica a variables TELO_*.
function variablesExtra(): Set<string> {
  return new Set(
    (process.env.TELO_AGENTE_VARIABLES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

// `propias` son variables de esta ejecución (p. ej. secretos del proyecto). Se fusionan encima
// de las permitidas y, como todo lo demás, nunca pueden llamarse TELO_*.
export function entornoDelAgente(propias?: Record<string, string>, modelosPermitidos?: readonly string[]): Record<string, string> {
  const extra = variablesExtra();
  const env: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(process.env)) {
    if (valor === undefined || clave.startsWith("TELO_")) continue;
    // Una variable del operador en TELO_AGENTE_VARIABLES no puede ser de sistema, de Telo ni un token de GitHub.
    const permitida =
      VARIABLES_PERMITIDAS.has(clave) ||
      PREFIJOS_PERMITIDOS.some((p) => clave.startsWith(p)) ||
      (extra.has(clave) && !esVariableReservada(clave) && !SECRETOS_SOLO_SERVIDOR.includes(clave));
    if (permitida) env[clave] = valor;
  }
  // Los secretos del proyecto no pueden sobrescribir nada del sistema, de Telo ni de la lista permitida.
  for (const [clave, valor] of Object.entries(propias ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clave)) continue;
    if (esVariableReservada(clave) || SECRETOS_SOLO_SERVIDOR.includes(clave)) continue;
    if (VARIABLES_PERMITIDAS.has(clave) || PREFIJOS_PERMITIDOS.some((p) => clave.startsWith(p))) continue;
    env[clave] = valor;
  }
  if (modelosPermitidos) {
    const proveedores = new Set(modelosPermitidos.map((modelo) => modelo.split("/")[0]));
    const claves = [...PROVEEDORES_CON_CLAVE, { id: "anthropic", variables: ["ANTHROPIC_API_KEY"] }];
    for (const proveedor of claves) {
      if (!proveedores.has(proveedor.id)) for (const variable of proveedor.variables) delete env[variable];
    }
    if (!proveedores.has("cloudflare-workers-ai")) delete env.CLOUDFLARE_ACCOUNT_ID;
  }
  // El aislamiento da a cada ejecución un /tmp vacío y oculta HOME; npm no puede crear ~/.npm.
  // Guarda su caché efímero en el /tmp escribible sin exponer cachés del host.
  if (aislamientoActivo()) env.npm_config_cache = "/tmp/telo-npm-cache";
  return env;
}

// Cierra el grupo de procesos completo: el agente, sus herramientas y sus nietos.
// Primero pide SIGTERM y, si algo sigue vivo tras 3 s, usa SIGKILL.
function terminarGrupo(pgid: number) {
  const enviar = (señal: NodeJS.Signals) => {
    try {
      process.kill(-pgid, señal);
    } catch {
      // El grupo ya no existe.
    }
  };
  enviar("SIGTERM");
  setTimeout(() => enviar("SIGKILL"), 3_000).unref();
}

// Lee una tubería línea a línea mientras el proceso sigue corriendo.
// Devuelve todo el contenido al terminar, con un tope de RAM que conserva el arranque y la cola.
async function leerLineas(
  flujo: ReadableStream<Uint8Array>,
  alLeerLinea: (linea: string) => void,
): Promise<string> {
  const lector = flujo.getReader();
  const decodificador = new TextDecoder();
  let todo = "";
  let pendiente = "";
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    const texto = decodificador.decode(value, { stream: true });
    todo += texto;
    if (todo.length > TOPE_SALIDA_AGENTE) {
      todo = todo.slice(0, CABEZA_SALIDA_AGENTE) + MARCA_SALIDA_AGENTE + todo.slice(-(TOPE_SALIDA_AGENTE - CABEZA_SALIDA_AGENTE));
    }
    pendiente += texto;
    // Una línea sin fin (un JSON gigante) tampoco puede crecer sin tope.
    if (pendiente.length > TOPE_STDERR_AGENTE) {
      pendiente = MARCA_SALIDA_AGENTE + pendiente.slice(-TOPE_STDERR_AGENTE);
    }
    let corte = pendiente.indexOf("\n");
    while (corte !== -1) {
      alLeerLinea(pendiente.slice(0, corte));
      pendiente = pendiente.slice(corte + 1);
      corte = pendiente.indexOf("\n");
    }
  }
  pendiente += decodificador.decode();
  if (pendiente) alLeerLinea(pendiente);
  return todo;
}

function vigilarSubagentes(ruta: string | undefined, alLeer: ((linea: string) => void) | undefined) {
  if (!ruta || !alLeer) return { cerrar() {} };
  let desplazamiento = 0;
  let pendiente = "";
  const leer = () => {
    let fd: number | null = null;
    try {
      fd = openSync(ruta, "r");
      const tamano = fstatSync(fd).size;
      if (tamano < desplazamiento) {
        desplazamiento = 0;
        pendiente = "";
      }
      const longitud = Math.min(tamano - desplazamiento, 256 * 1024);
      if (longitud <= 0) return;
      const buffer = Buffer.allocUnsafe(longitud);
      const leidos = readSync(fd, buffer, 0, longitud, desplazamiento);
      desplazamiento += leidos;
      pendiente += buffer.toString("utf8", 0, leidos);
      let corte = pendiente.indexOf("\n");
      while (corte !== -1) {
        const linea = pendiente.slice(0, corte).trim();
        pendiente = pendiente.slice(corte + 1);
        if (linea) {
          try { alLeer(linea); } catch { /* una falla al registrar no interrumpe OpenCode */ }
        }
        corte = pendiente.indexOf("\n");
      }
    } catch {
      // El archivo puede aún no existir en una configuración persistente sin captura.
    } finally {
      if (fd !== null) closeSync(fd);
    }
  };
  const timer = setInterval(leer, 180);
  timer.unref();
  return {
    cerrar() {
      clearInterval(timer);
      leer();
      const resto = pendiente.trim();
      if (resto) {
        try { alLeer(resto); } catch { /* una falla al registrar no interrumpe OpenCode */ }
      }
      pendiente = "";
    },
  };
}

export async function runOpenCode(opts: {
  modelosAuxiliares?: string[];
  servidoresMcp?: ServidorMcpAgente[];
  prompt: string;
  model: string;
  variant?: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  // Vigilante de actividad: si el agente no emite ni una línea en este tiempo, se cierra el
  // grupo de procesos y la ejecución falla con un mensaje claro. Sin él, una sesión colgada
  // retenía un slot de la cola para siempre (solo lo liberaban cancelar a mano o reiniciar).
  tiempoSinActividadMs?: number | null;
  tiempoPrimeraRespuestaMs?: number;
  signal?: AbortSignal;
  onSesion?: (sessionId: string) => void;
  onLinea?: (linea: string) => void;
  onSubagente?: (linea: string) => void;
  extraEnv?: Record<string, string>;
  opencodeConfigDir?: string;
  subagentesTracePath?: string;
  perfilOpenCodeDir?: string;
  soloLectura?: boolean;
  imagenes?: ImagenAgente[];
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  const servidores = opts.servidoresMcp ?? [];
  // La configuración runtime también activa compactación automática sin servidores MCP.

  const raiz = join(config.dataDir, "perfiles-mcp");
  mkdirSync(raiz, { recursive: true, mode: 0o700 });
  const temporal = mkdtempSync(join(raiz, "run-"));
  const archivo = join(temporal, "opencode.json");
  const captura = join(temporal, "actividad.ndjson");
  const plugin = join(temporal, "seguimiento.js");
  let red: RedAgente | undefined;
  try {
    const aislado = aislamientoActivo();
    if (aislado) red = await prepararRedAgente({ modelos: [opts.model, ...(opts.modelosAuxiliares ?? [])], extraEnv: opts.extraEnv, brokerOpenCode: true });
    writeFileSync(captura, "", { flag: "wx", mode: 0o600 });
    writeFileSync(plugin, pluginSeguimientoOpenCode(aislado ? "/tmp/telo-mcp-config/actividad.ndjson" : captura, sesionValida(opts.sessionId) ? opts.sessionId : null, await rtkDisponible()), { flag: "wx", mode: 0o600 });
    writeFileSync(archivo, JSON.stringify({ ...configuracionOpenCodeMcp(servidores, opts.model), ...red?.configuracion,
      plugin: [aislado ? "file:///tmp/telo-mcp-config/seguimiento.js" : pathToFileURL(plugin).href],
    }), { encoding: "utf8", flag: "wx", mode: 0o600 });
    return await ejecutarOpenCode({ ...opts, red, opencodeMcpConfigPath: archivo, actividadTracePath: captura });
  } finally {
    await red?.cerrar();
    rmSync(temporal, { recursive: true, force: true });
  }
}

async function ejecutarOpenCode(opts: {
  red?: RedAgente;
  modelosAuxiliares?: string[];
  servidoresMcp?: ServidorMcpAgente[];
  opencodeMcpConfigPath?: string;
  actividadTracePath?: string;
  prompt: string;
  model: string;
  variant?: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number | null;
  // Vigilante de actividad (ver nota en la firma externa). null lo desactiva.
  tiempoSinActividadMs?: number | null;
  tiempoPrimeraRespuestaMs?: number;
  signal?: AbortSignal;
  // Se llama en cuanto el agente informa su sesión, aunque la ejecución siga en curso.
  onSesion?: (sessionId: string) => void;
  // Una llamada por cada línea de stdout, en orden, mientras el agente corre.
  onLinea?: (linea: string) => void;
  // Eventos de subagentes que OpenCode no incluye en la salida NDJSON del runner padre.
  onSubagente?: (linea: string) => void;
  // Variables extra solo para esta ejecución. Nunca se aceptan nombres TELO_*.
  extraEnv?: Record<string, string>;
  // Perfiles temporales que solicita explícitamente la tarea para sus subagentes.
  opencodeConfigDir?: string;
  // Archivo temporal NDJSON del plugin de OpenCode con eventos de subagentes.
  subagentesTracePath?: string;
  // Estado aislado y persistente de OpenCode por conversación o tarea.
  perfilOpenCodeDir?: string;
  soloLectura?: boolean;
  imagenes?: ImagenAgente[];
  // Se persiste cada paso antes de conocer el resultado del proceso.
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  // Lanza AislamientoError si la carpeta no es permitida o falta bubblewrap.
  const aislamiento = prefijoAislamiento(
    opts.cwd,
    opts.soloLectura,
    opts.imagenes,
    opts.perfilOpenCodeDir,
    opts.opencodeConfigDir,
    opts.subagentesTracePath,
    opts.opencodeMcpConfigPath,
    opts.actividadTracePath,
    undefined,
    opts.red?.directorio,
  );

  // Un id de sesión que no cumple el patrón se ignora: ni se pasa a -s ni se reutiliza.
  const sesionPedida = sesionValida(opts.sessionId) ? opts.sessionId : null;
  const args = ["opencode", "run", "--format", "json", "-m", opts.model];
  args.push("--agent", "build");
  if (opts.variant) args.push("--variant", opts.variant);
  if (sesionPedida) args.push("-s", sesionPedida);
  for (const imagen of opts.imagenes ?? []) args.push("--file", aislamientoActivo() ? imagen.rutaVisible : imagen.ruta);
  // `--` separa las opciones del mensaje: un prompt que empiece por "-" no se lee como opción.
  args.push("--", opts.prompt);

  // `setsid` deja al agente como líder de su propio grupo (pgid == pid),
  // para poder cerrar todo su árbol de procesos de una vez.
  const env = entornoDelAgente(opts.extraEnv, [opts.model, ...(opts.modelosAuxiliares ?? [])]);
  if (opts.red) for (const clave of Object.keys(env)) if (clave.startsWith("OPENCODE_")) delete env[clave];
  Object.assign(env, opts.red?.entorno);
  // La política del turno prevalece sobre el proyecto y sobre sesiones anteriores.
  const autorizados: Record<string, string> = { "*": "deny" };
  if (opts.opencodeConfigDir) {
    const permisos = JSON.parse(readFileSync(join(opts.opencodeConfigDir, "opencode.json"), "utf8"))?.permission?.task;
    for (const [alias, permiso] of Object.entries(permisos ?? {})) {
      if (/^telo-[a-z0-9-]+$/.test(alias) && permiso === "allow") autorizados[alias] = "allow";
    }
  }
  const inline = JSON.parse(env.OPENCODE_CONFIG_CONTENT || "{}");
  // El escalar reemplaza mapas heredados; otro mapa conservaría sus reglas específicas.
  const task = opts.opencodeConfigDir ? autorizados : "deny";
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...inline,
    ...opts.red?.configuracion,
    model: opts.model,
    small_model: opts.model,
    permission: { ...(typeof inline.permission === "object" ? inline.permission : {}), task },
    agent: {
      ...inline.agent,
      ...Object.fromEntries(["plan", "general", "explore", "compaction"].map((nombre) => [nombre, { ...inline.agent?.[nombre], model: opts.model }])),
      title: { ...inline.agent?.title, model: opts.model, disable: true },
      summary: { ...inline.agent?.summary, model: opts.model, disable: true },
      build: { ...inline.agent?.build, model: opts.model, permission: { ...(typeof inline.agent?.build?.permission === "object" ? inline.agent.build.permission : {}), task } },
    },
  });
  if (opts.perfilOpenCodeDir && aislamientoActivo()) {
    const destino = "/tmp/telo-opencode-profile";
    env.XDG_DATA_HOME = `${destino}/data`;
    env.XDG_STATE_HOME = `${destino}/state`;
    env.XDG_CACHE_HOME = `${destino}/cache`;
  }
  // `entornoDelAgente` filtra variables OPENCODE_ recibidas del proyecto; esta ruta la crea
  // internamente Telo y apunta a perfiles efímeros aislados para esta ejecución.
  if (opts.opencodeConfigDir) {
    env.OPENCODE_CONFIG_DIR = aislamientoActivo() ? "/tmp/telo-opencode-config" : opts.opencodeConfigDir;
  }
  if (opts.opencodeMcpConfigPath) {
    env.OPENCODE_CONFIG = aislamientoActivo()
      ? "/tmp/telo-mcp-config/opencode.json"
      : opts.opencodeMcpConfigPath;
  }
  const proc = Bun.spawn(["setsid", ...aislamiento, ...args], {
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let grupoCerrado = false;
  const cerrarGrupo = () => {
    if (grupoCerrado) return;
    grupoCerrado = true;
    terminarGrupo(proc.pid);
  };
  const monitorSubagentes = vigilarSubagentes(opts.subagentesTracePath, opts.onSubagente);
  const timer = opts.timeoutMs === null ? null : setTimeout(cerrarGrupo, opts.timeoutMs ?? 120_000);
  // Vigilante de actividad compartido con codex: el reloj se reinicia con cada línea del agente.
  // Si se corta por silencio, la ejecución falla con un mensaje claro en vez de retener el slot.
  const vigilante = iniciarVigilante({
    tiempoSinActividadMs: opts.tiempoSinActividadMs,
    cortar: cerrarGrupo,
  });
  // Al terminar el agente, se cierra lo que quedó de su grupo (procesos en segundo plano). Así nada
  // sigue escribiendo en la carpeta de trabajo después de la ejecución, y las tuberías se cierran.
  void proc.exited.then(cerrarGrupo);

  // Al cancelar se cierra el grupo entero. No se espera a las tuberías, porque
  // un proceso del agente puede seguir abriéndolas y dejaría la tarea en "running".
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cerrarGrupo();
      reject(new Error("ejecución cancelada"));
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  // Promise.race no consume el rechazo del perdedor si el proceso termina primero.
  void aborted.catch(() => {});

  let sesionAvisada: string | null = null;
  const primeraRespuesta = iniciarVigilante({ tiempoSinActividadMs: opts.tiempoPrimeraRespuestaMs ?? TIEMPO_PRIMERA_RESPUESTA_MS, cortar: cerrarGrupo });
  const usosVistos = new Set<string>();
  const alLeerLinea = (linea: string) => {
    vigilante.patada();
    let ev: OpenCodeEvent | undefined;
    try {
      ev = JSON.parse(linea) as OpenCodeEvent;
      if (esActividadUtil(ev)) primeraRespuesta.detener();
    } catch {
      // La CLI también puede escribir líneas sin JSON.
    }
    const uso = ev && usoDelEvento(ev);
    // No ocultar un fallo de persistencia como si fuera una línea JSON inválida.
    if (uso && (uso.input > 0 || uso.output > 0 || uso.cost > 0) && (!uso.providerEventId || !usosVistos.has(uso.providerEventId))) {
      if (uso.providerEventId) usosVistos.add(uso.providerEventId);
      opts.onUso?.(uso);
    }
    // Un fallo del llamador (p. ej. al escribir el registro) no debe cortar al agente.
    if (opts.onLinea) {
      try {
        opts.onLinea(linea);
      } catch {
        // se ignora: la salida sigue llegando al resultado
      }
    }
    if (!opts.onSesion || !ev) return;
    try {
      if (sesionValida(ev.sessionID) && ev.sessionID !== sesionAvisada) {
        sesionAvisada = ev.sessionID;
        opts.onSesion(ev.sessionID);
      }
    } catch {
      // línea incompleta o que no es JSON: se ignora
    }
  };

  // El motor reintenta algunos errores internamente sin emitirlos por stdout. No limitar
  // el silencio ni la duración de herramientas: cortar solo una secuencia explícita de fallos.
  let errorReintentos: ErrorAgente | null = null;
  let rechazarReintentos: (error: Error) => void = () => {};
  const reintentosAgotados = new Promise<never>((_, reject) => { rechazarReintentos = reject; });
  void reintentosAgotados.catch(() => {});
  const monitorActividad = vigilarSubagentes(opts.actividadTracePath, (linea) => {
    if (errorReintentos) return;
    alLeerLinea(linea);
    const ev = JSON.parse(linea);
    if (!errorReintentos && ev.type === "telo.provider" && ev.status === "retry" && ev.attempt >= 3) {
      errorReintentos = new ErrorAgente(
        "El proveedor falló en tres reintentos internos consecutivos. Se conservan la sesión y los archivos; puedes continuar desde el chat o elegir otro modelo.",
        JSON.stringify({ message: String(ev.message || "Error temporal del proveedor").slice(0, 1000) }),
        true,
      );
      cerrarGrupo();
      rechazarReintentos(errorReintentos);
    }
  });

  let stdout: string, stderr: string, code: number;
  try {
    [stdout, stderr, code] = await Promise.race([
      Promise.all([
        leerLineas(proc.stdout, alLeerLinea),
        leerConTope(proc.stderr, TOPE_STDERR_AGENTE),
        proc.exited,
      ]),
      aborted,
      reintentosAgotados,
    ]);
  } finally {
    cerrarGrupo();
    if (timer) clearTimeout(timer);
    vigilante.detener();
    primeraRespuesta.detener();
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    monitorSubagentes.cerrar();
    monitorActividad.cerrar();
  }

  if (primeraRespuesta.silenciado()) throw new ErrorAgente(ERROR_PRIMERA_RESPUESTA, "");
  if (errorReintentos) throw errorReintentos;

  const events = parseEvents(stdout);

  if (vigilante.silenciado()) {
    throw new ErrorAgente(
      `El agente no emitió ninguna línea en ${Math.round(((opts.tiempoSinActividadMs as number) ?? 0) / 60_000)} minutos, así que se cerró para liberar la tarea. Puedes reanudarla para retomar la sesión o cancelarla en la tarjeta.`,
      "",
    );
  }

  if (code !== 0) {
    throw new ErrorAgente(
      `opencode salió con código ${code}: ${failureDetail(stdout, stderr, events, code)}`,
      detalleDelProveedor(stdout, stderr, events),
    );
  }

  let text = "";
  let textoEstimacion = "";
  let huboCompactacion = false;
  let textoTrasHerramientas = "";
  let sessionId: string | null = null;
  let usage: Usage | null = null;
  const usosSumados = new Set<string>();

  for (const ev of events) {
    if (sesionValida(ev.sessionID)) sessionId = ev.sessionID;
    if (ev.type === "text" && ev.part?.text) textoEstimacion += ev.part.text;
    const compactacion = esCompactacionOpenCode(ev);
    if (compactacion) huboCompactacion = true;
    if (!compactacion && ev.type === "text" && ev.part?.text) {
      text += ev.part.text;
      textoTrasHerramientas += ev.part.text;
    }
    // Lo dicho antes de una herramienta es narración del paso, no la respuesta final.
    if (ev.part?.type === "tool") textoTrasHerramientas = "";
    const paso = usoDelEvento(ev);
    if (paso && (!paso.providerEventId || !usosSumados.has(paso.providerEventId))) {
      if (paso.providerEventId) usosSumados.add(paso.providerEventId);
      usage ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0 };
      usage.input += paso.input;
      usage.output += paso.output;
      usage.reasoning += paso.reasoning;
      usage.cacheRead += paso.cacheRead;
      usage.cost += paso.cost;
    }
  }

  // Si ningún evento de la sesión reportó tokens (o input y output son 0),
  // estimamos el uso a partir del prompt y texto generado para garantizar registro contable
  const textoFinal = textoTrasHerramientas.trim() || text.trim() || (huboCompactacion
    ? "El contexto se compactó, pero la ejecución terminó sin una respuesta final. Puedes continuar desde la sesión guardada."
    : "");
  if (!textoFinal) {
    throw new ErrorAgente(
      "OpenCode terminó correctamente con " + opts.model + ", pero el proveedor no devolvió texto final. No se guardó una respuesta vacía; puedes reintentar el turno o revisar la actividad del proveedor.",
      "",
    );
  }
  if (!usage || (usage.input === 0 && usage.output === 0)) {
    usage = estimarUso(opts.prompt, textoEstimacion.trim() || textoFinal);
    opts.onUso?.(usage);
  }

  return {
    text: text.trim(),
    textoFinal,
    sessionId,
    usage,
  };
}
