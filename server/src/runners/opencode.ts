import { aislamientoActivo, prefijoAislamiento } from "./aislamiento";
import { esVariableReservada, SECRETOS_SOLO_SERVIDOR } from "../secretos";
import type { ImagenAgente } from "../chat-adjuntos";

// Id de sesión de OpenCode. Empieza por letra o cifra: así nunca se lee como una opción de la CLI.
const PATRON_SESION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Verdadero si el id puede guardarse y reusarse con -s. Lo que no cumple se descarta.
export function sesionValida(id: unknown): id is string {
  return typeof id === "string" && PATRON_SESION.test(id);
}

export type Usage = { input: number; output: number; reasoning: number; cacheRead: number; cost: number; tokensMedidos?: boolean; costeDisponible?: boolean };
// `text` une todo lo que el agente escribió. `textoFinal` es lo que dijo después de su última
// herramienta: la respuesta, sin la narración de los pasos (que el chat muestra aparte).
export type RunResult = { text: string; textoFinal: string; sessionId: string | null; usage: Usage | null };

type OpenCodeEvent = {
  type: string;
  sessionID?: string;
  error?: unknown;
  part?: {
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

  if (input === 0 && output === 0 && cost === 0 && !esEventoFin) return null;

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cost,
    tokensMedidos: input > 0 || output > 0,
    costeDisponible: typeof costVal === "number" && Number.isFinite(costVal) && costVal >= 0,
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
  if ((status !== null && status >= 500) || /server error|internal error|service unavailable|bad gateway|gateway timeout|temporarily unavailable/i.test(mensaje)) {
    const detalleMsg = mensaje ? `: «${mensaje.slice(0, 160)}»` : "";
    return `El proveedor del modelo tuvo un error temporal en sus servidores${status ? ` (HTTP ${status})` : ""}${detalleMsg}. Por dónde empezar: espera unos momentos y vuelve a intentarlo; si el problema persiste, selecciona otro modelo en el selector (por ejemplo, Claude, GPT o Groq).`;
  }
  if (mensaje) return `El proveedor devolvió un error${status === null ? "" : ` (HTTP ${status})`}: ${mensaje.slice(0, 500)}`;
  return `OpenCode informó un error del proveedor${status === null ? "" : ` (HTTP ${status})`}. Revisa «Ver proceso» y vuelve a intentarlo.`;
}

function failureDetail(stdout: string, stderr: string, events: OpenCodeEvent[]): string {
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
    const statusCode = typeof data?.statusCode === "number"
      ? data.statusCode
      : typeof error?.statusCode === "number" ? error.statusCode : null;
    const message = typeof data?.message === "string"
      ? data.message
      : typeof error?.message === "string" ? error.message : "";
    // Conserva lo necesario para clasificar el error sin perder el código si el evento trae
    // metadatos grandes (por ejemplo, cabeceras o IDs de sesión) al final del JSON.
    return JSON.stringify({ type: "error", statusCode, message: message.slice(0, 500) });
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
export function entornoDelAgente(propias?: Record<string, string>): Record<string, string> {
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
// Devuelve todo el contenido al terminar.
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
    pendiente += texto;
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

export async function runOpenCode(opts: {
  prompt: string;
  model: string;
  variant?: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Se llama en cuanto el agente informa su sesión, aunque la ejecución siga en curso.
  onSesion?: (sessionId: string) => void;
  // Una llamada por cada línea de stdout, en orden, mientras el agente corre.
  onLinea?: (linea: string) => void;
  // Variables extra solo para esta ejecución. Nunca se aceptan nombres TELO_*.
  extraEnv?: Record<string, string>;
  // Perfiles temporales que solicita explícitamente la tarea para sus subagentes.
  opencodeConfigDir?: string;
  soloLectura?: boolean;
  imagenes?: ImagenAgente[];
  // Se persiste cada paso antes de conocer el resultado del proceso.
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  // Lanza AislamientoError si la carpeta no es permitida o falta bubblewrap.
  const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura, opts.imagenes);

  // Un id de sesión que no cumple el patrón se ignora: ni se pasa a -s ni se reutiliza.
  const sesionPedida = sesionValida(opts.sessionId) ? opts.sessionId : null;
  const args = ["opencode", "run", "--format", "json", "-m", opts.model];
  if (opts.variant) args.push("--variant", opts.variant);
  if (sesionPedida) args.push("-s", sesionPedida);
  for (const imagen of opts.imagenes ?? []) args.push("--file", aislamientoActivo() ? imagen.rutaVisible : imagen.ruta);
  // `--` separa las opciones del mensaje: un prompt que empiece por "-" no se lee como opción.
  args.push("--", opts.prompt);

  // `setsid` deja al agente como líder de su propio grupo (pgid == pid),
  // para poder cerrar todo su árbol de procesos de una vez.
  const env = entornoDelAgente(opts.extraEnv);
  // `entornoDelAgente` filtra variables OPENCODE_ recibidas del proyecto; esta ruta la crea
  // internamente Telo y apunta a perfiles efímeros aislados para esta ejecución.
  if (opts.opencodeConfigDir) env.OPENCODE_CONFIG_DIR = opts.opencodeConfigDir;
  const proc = Bun.spawn(["setsid", ...aislamiento, ...args], {
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => terminarGrupo(proc.pid), opts.timeoutMs ?? 120_000);
  // Al terminar el agente, se cierra lo que quedó de su grupo (procesos en segundo plano). Así nada
  // sigue escribiendo en la carpeta de trabajo después de la ejecución, y las tuberías se cierran.
  void proc.exited.then(() => terminarGrupo(proc.pid));

  // Al cancelar se cierra el grupo entero. No se espera a las tuberías, porque
  // un proceso del agente puede seguir abriéndolas y dejaría la tarea en "running".
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      terminarGrupo(proc.pid);
      reject(new Error("ejecución cancelada"));
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });

  let sesionAvisada: string | null = null;
  const alLeerLinea = (linea: string) => {
    let ev: OpenCodeEvent | undefined;
    try {
      ev = JSON.parse(linea) as OpenCodeEvent;
    } catch {
      // La CLI también puede escribir líneas sin JSON.
    }
    const uso = ev && usoDelEvento(ev);
    // No ocultar un fallo de persistencia como si fuera una línea JSON inválida.
    if (uso) opts.onUso?.(uso);
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

  let stdout: string, stderr: string, code: number;
  try {
    [stdout, stderr, code] = await Promise.race([
      Promise.all([
        leerLineas(proc.stdout, alLeerLinea),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
  }

  const events = parseEvents(stdout);

  if (code !== 0) {
    throw new ErrorAgente(
      `opencode salió con código ${code}: ${failureDetail(stdout, stderr, events)}`,
      detalleDelProveedor(stdout, stderr, events),
    );
  }

  let text = "";
  let textoTrasHerramientas = "";
  let sessionId: string | null = null;
  let usage: Usage | null = null;

  for (const ev of events) {
    if (sesionValida(ev.sessionID)) sessionId = ev.sessionID;
    if (ev.type === "text" && ev.part?.text) {
      text += ev.part.text;
      textoTrasHerramientas += ev.part.text;
    }
    // Lo dicho antes de una herramienta es narración del paso, no la respuesta final.
    if (ev.part?.type === "tool") textoTrasHerramientas = "";
    const paso = usoDelEvento(ev);
    if (paso) {
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
  const textoFinal = textoTrasHerramientas.trim() || text.trim();
  if (!usage || (usage.input === 0 && usage.output === 0)) {
    const inputEst = Math.max(1, Math.ceil(opts.prompt.length / 3.8));
    const outputEst = Math.max(1, Math.ceil(textoFinal.length / 3.5));
    usage = {
      input: inputEst,
      output: outputEst,
      reasoning: 0,
      cacheRead: 0,
      cost: 0,
      tokensMedidos: true,
      costeDisponible: false,
    };
    opts.onUso?.(usage);
  }

  return {
    text: text.trim(),
    textoFinal,
    sessionId,
    usage,
  };
}
