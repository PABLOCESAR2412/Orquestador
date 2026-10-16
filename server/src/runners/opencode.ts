import { prefijoAislamiento } from "./aislamiento";
import { esVariableReservada, SECRETOS_SOLO_SERVIDOR } from "../secretos";

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

// Algunos proveedores omiten campos de uso. Nunca se guardan NaN ni contadores negativos.
export function usoDelEvento(ev: OpenCodeEvent): Usage | null {
  if (ev.type !== "step_finish") return null;
  const t = ev.part?.tokens;
  const numero = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
  return {
    input: numero(t?.input), output: numero(t?.output), reasoning: numero(t?.reasoning),
    cacheRead: numero(t?.cache?.read), cost: numero(ev.part?.cost),
    tokensMedidos: typeof t?.input === "number" && Number.isFinite(t.input) && t.input >= 0 && typeof t.output === "number" && Number.isFinite(t.output) && t.output >= 0,
    costeDisponible: typeof ev.part?.cost === "number" && Number.isFinite(ev.part.cost) && ev.part.cost >= 0,
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

function failureDetail(stdout: string, stderr: string, events: OpenCodeEvent[]): string {
  const errorEvent = events.find((e) => e.type === "error");
  if (errorEvent) return JSON.stringify(errorEvent).slice(0, 800);
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
  if (errorEvent) return JSON.stringify(errorEvent).slice(0, 800);
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
function entornoDelAgente(propias?: Record<string, string>): Record<string, string> {
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
  soloLectura?: boolean;
  // Se persiste cada paso antes de conocer el resultado del proceso.
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  // Lanza AislamientoError si la carpeta no es permitida o falta bubblewrap.
  const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura);

  // Un id de sesión que no cumple el patrón se ignora: ni se pasa a -s ni se reutiliza.
  const sesionPedida = sesionValida(opts.sessionId) ? opts.sessionId : null;
  const args = ["opencode", "run", "--format", "json", "-m", opts.model];
  if (opts.variant) args.push("--variant", opts.variant);
  if (sesionPedida) args.push("-s", sesionPedida);
  // `--` separa las opciones del mensaje: un prompt que empiece por "-" no se lee como opción.
  args.push("--", opts.prompt);

  // `setsid` deja al agente como líder de su propio grupo (pgid == pid),
  // para poder cerrar todo su árbol de procesos de una vez.
  const proc = Bun.spawn(["setsid", ...aislamiento, ...args], {
    cwd: opts.cwd,
    env: entornoDelAgente(opts.extraEnv),
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

  if (!text.trim()) {
    throw new ErrorAgente(
      `opencode no devolvió texto: ${failureDetail(stdout, stderr, events)}`,
      detalleDelProveedor(stdout, stderr, events),
    );
  }
  return {
    text: text.trim(),
    textoFinal: textoTrasHerramientas.trim() || text.trim(),
    sessionId,
    usage,
  };
}
