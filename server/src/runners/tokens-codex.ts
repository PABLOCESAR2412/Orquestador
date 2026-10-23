// Tokenos del CLI de Codex: mientras el turno corre, `exec --json` emite eventos
// `token_count` con la cuenta acumulada de la sesión. Al completar el turno llega un
// `turn.completed` con el uso del turno (delta), que es lo que Telo registra siempre.
// Si la ejecución muere a mitad de turno, el delta queda sin registrar: aquí se calcula
// (acumulado observado − acumulado al empezar − deltas ya contados) para no perder
// el gasto real ni contar dos veces algo ya registrado.

import { homedir } from "node:os";
import { join } from "node:path";
import { db } from "../db";
import { leerLineasAcotadas } from "./proteccion";

export type TotalesCodex = { input: number; cached: number; output: number; reasoning: number };

const CERO: TotalesCodex = { input: 0, cached: 0, output: 0, reasoning: 0 };

// El evento trae la cuenta en `info` (puede llegar a null en los primeros eventos);
// también se aceptan los campos planos por si el CLI los envía en otra forma.
export function totalesDelEventoTokenCount(evento: unknown): TotalesCodex | null {
  if (evento === null || typeof evento !== "object") return null;
  const original = evento as { type?: unknown; payload?: unknown };
  const ev = (original.type === "event_msg" && original.payload && typeof original.payload === "object"
    ? original.payload : original) as { type?: unknown; info?: unknown };
  if (ev.type !== "token_count") return null;
  const info = (ev.info && typeof ev.info === "object" ? ev.info : ev) as Record<string, unknown>;
  const fuente = (info.total_token_usage && typeof info.total_token_usage === "object"
    ? info.total_token_usage : info) as Record<string, unknown>;
  const numero = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
  const input = numero(fuente.input_tokens);
  const cached = numero(fuente.cached_input_tokens);
  const output = numero(fuente.output_tokens);
  const reasoning = numero(fuente.reasoning_output_tokens);
  if (input === 0 && cached === 0 && output === 0 && reasoning === 0) return null;
  return { input, cached, output, reasoning };
}

const claveSesion = (id: string) => `codex_uso:${id}`;

export function guardarTotalesSesion(id: string | null, totales: TotalesCodex): void {
  if (!id || !/^[0-9a-fA-F-]{1,128}$/.test(id)) return;
  db.query(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(claveSesion(id), JSON.stringify(totales));
}

// Se toma ANTES de lanzar resume. La primera medición de stdout ya incluye gasto nuevo.
// Para sesiones anteriores a este registro se recupera el último acumulado del rollout.
export async function leerTotalesSesion(id: string): Promise<TotalesCodex | null> {
  if (!/^[0-9a-fA-F-]{1,128}$/.test(id)) return null;
  let ultimo: TotalesCodex | null = null;
  try {
    const carpeta = join(homedir(), ".codex", "sessions");
    const patron = new Bun.Glob(`**/*${id}.jsonl`);
    for await (const archivo of patron.scan({ cwd: carpeta, absolute: true, onlyFiles: true, followSymlinks: false })) {
      await leerLineasAcotadas(Bun.file(archivo).stream(), 2 * 1024 * 1024, (linea) => {
        try { ultimo = totalesDelEventoTokenCount(JSON.parse(linea)) ?? ultimo; } catch { /* NDJSON ajeno. */ }
      });
    }
  } catch { /* Sin historial legible no se inventa un acumulado previo. */ }
  if (ultimo) return ultimo;
  const fila = db.query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key=?").get(claveSesion(id));
  if (fila) {
    try {
      const valor = JSON.parse(fila.value);
      if ([valor.input, valor.cached, valor.output, valor.reasoning].every((n) => Number.isFinite(n) && n >= 0)) return valor;
    } catch { /* Sin historial legible no se factura un acumulado desconocido. */ }
  }
  return ultimo;
}

export function sumarTotales(a: TotalesCodex, b: TotalesCodex): TotalesCodex {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

// Delta pendiente de registrar con componente nunca negativo; null si todo es cero.
export function deltaNoRegistrada(base: TotalesCodex | null, ultimo: TotalesCodex | null, yaRegistrados: TotalesCodex): TotalesCodex | null {
  if (!ultimo) return null;
  const b = base ?? CERO;
  const pendiente: TotalesCodex = {
    input: Math.max(0, ultimo.input - b.input - yaRegistrados.input),
    cached: Math.max(0, ultimo.cached - b.cached - yaRegistrados.cached),
    output: Math.max(0, ultimo.output - b.output - yaRegistrados.output),
    reasoning: Math.max(0, ultimo.reasoning - b.reasoning - yaRegistrados.reasoning),
  };
  if (pendiente.input === 0 && pendiente.output === 0 && pendiente.reasoning === 0) return null;
  return pendiente;
}
