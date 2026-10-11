import { prefijoAislamiento } from "./aislamiento";

export type Usage = { input: number; output: number; reasoning: number; cacheRead: number; cost: number };
export type RunResult = { text: string; sessionId: string | null; usage: Usage | null };

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

// Variables de Telo que el agente nunca debe heredar (la clave de acceso, por ejemplo).
function entornoDelAgente(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(process.env)) {
    if (valor !== undefined && !clave.startsWith("TELO_")) env[clave] = valor;
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
}): Promise<RunResult> {
  // Lanza AislamientoError si la carpeta no es permitida o falta bubblewrap.
  const aislamiento = prefijoAislamiento(opts.cwd);

  const args = ["opencode", "run", "--format", "json", "-m", opts.model];
  if (opts.variant) args.push("--variant", opts.variant);
  if (opts.sessionId) args.push("-s", opts.sessionId);
  args.push(opts.prompt);

  // `setsid` deja al agente como líder de su propio grupo (pgid == pid),
  // para poder cerrar todo su árbol de procesos de una vez.
  const proc = Bun.spawn(["setsid", ...aislamiento, ...args], {
    cwd: opts.cwd,
    env: entornoDelAgente(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => terminarGrupo(proc.pid), opts.timeoutMs ?? 120_000);

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
    if (!opts.onSesion || !linea.includes("sessionID")) return;
    try {
      const ev = JSON.parse(linea) as OpenCodeEvent;
      if (ev.sessionID && ev.sessionID !== sesionAvisada) {
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
    throw new Error(`opencode salió con código ${code}: ${failureDetail(stdout, stderr, events)}`);
  }

  let text = "";
  let sessionId: string | null = null;
  let usage: Usage | null = null;

  for (const ev of events) {
    if (ev.sessionID) sessionId = ev.sessionID;
    if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    if (ev.type === "step_finish" && ev.part?.tokens) {
      const t = ev.part.tokens;
      usage ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cost: 0 };
      usage.input += t.input;
      usage.output += t.output;
      usage.reasoning += t.reasoning;
      usage.cacheRead += t.cache.read;
      usage.cost += ev.part.cost ?? 0;
    }
  }

  if (!text.trim()) {
    throw new Error(`opencode no devolvió texto: ${failureDetail(stdout, stderr, events)}`);
  }
  return { text: text.trim(), sessionId, usage };
}
