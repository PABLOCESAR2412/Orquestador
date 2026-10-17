import { existsSync } from "node:fs";
import { join } from "node:path";
import { prefijoAislamiento } from "./aislamiento";
import { hallarEjecutable } from "../ejecutable";
import { carpetaHome } from "../hogar";
import type { RunResult, Usage } from "./opencode";

// Ejecución de tareas con el CLI de Codex cuando el modelo seleccionado es de Codex (codex/*).
// Utiliza la sesión activa autenticada con ChatGPT (`codex login --device-auth`).

export async function runCodex(opts: {
  prompt: string;
  model: string;
  variant?: string;
  sessionId?: string | null;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onSesion?: (sessionId: string) => void;
  onLinea?: (linea: string) => void;
  extraEnv?: Record<string, string>;
  soloLectura?: boolean;
  onUso?: (uso: Usage) => void;
}): Promise<RunResult> {
  const codex = hallarEjecutable("codex");
  if (!codex) {
    throw new Error("El CLI de Codex no está instalado en el servidor. Instálalo desde Ajustes para usar modelos de Codex.");
  }

  // Quitar el prefijo "codex/" para obtener el nombre del modelo que espera Codex (ej: gpt-6-luna)
  const modeloCodex = opts.model.startsWith("codex/") ? opts.model.slice("codex/".length) : opts.model;

  const aislamiento = prefijoAislamiento(opts.cwd, opts.soloLectura);

  const args: string[] = [];
  if (opts.sessionId && /^[0-9a-fA-F-]+$/.test(opts.sessionId)) {
    args.push("codex", "exec", "resume", "--json", "--dangerously-bypass-approvals-and-sandbox", "-m", modeloCodex, opts.sessionId, opts.prompt);
  } else {
    args.push("codex", "exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-m", modeloCodex, "-C", opts.cwd, "--", opts.prompt);
  }

  const comandoCompleto = aislamiento.length > 0 ? ["setsid", ...aislamiento, ...args] : process.platform === "win32" ? ["cmd", "/c", ...args] : ["setsid", ...args];

  const env = {
    ...process.env,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
    ...(opts.extraEnv ?? {}),
  };

  const proc = Bun.spawn(comandoCompleto, {
    cwd: opts.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {}
  }, opts.timeoutMs ?? 180_000);

  const onAbort = () => {
    try {
      proc.kill();
    } catch {}
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  let sessionId: string | null = opts.sessionId ?? null;
  let text = "";
  let usage: Usage | null = null;
  let ultimoError: string | null = null;

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
          opts.onLinea?.(l);

          try {
            const ev = JSON.parse(l);
            if (ev.type === "thread.started" && ev.thread_id) {
              sessionId = ev.thread_id;
              opts.onSesion?.(ev.thread_id);
            } else if (ev.type === "item.completed" && ev.item) {
              if (ev.item.type === "agent_message" && typeof ev.item.text === "string") {
                text += (text ? "\n\n" : "") + ev.item.text;
              } else if (ev.item.type === "error" && typeof ev.item.message === "string") {
                ultimoError = ev.item.message;
              }
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
              opts.onUso?.(usage);
            } else if (ev.type === "error" || ev.type === "turn.failed") {
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

  const [_, stderr, code] = await Promise.all([
    lector(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timer);

  if (code !== 0) {
    const detalle = ultimoError || stderr.trim() || `Codex terminó con código ${code}`;
    throw new Error(`Codex falló: ${detalle}`);
  }

  return {
    text: text.trim(),
    textoFinal: text.trim(),
    sessionId,
    usage,
  };
}
