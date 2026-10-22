// Tokenos del CLI de Codex: mientras el turno corre, `exec --json` emite eventos
// `token_count` con la cuenta acumulada de la sesión. Al completar el turno llega un
// `turn.completed` con el uso del turno (delta), que es lo que Telo registra siempre.
// Si la ejecución muere a mitad de turno, el delta queda sin registrar: aquí se calcula
// (acumulado observado − acumulado al empezar − deltas ya contados) para no perder
// el gasto real ni contar dos veces algo ya registrado.

export type TotalesCodex = { input: number; cached: number; output: number; reasoning: number };

const CERO: TotalesCodex = { input: 0, cached: 0, output: 0, reasoning: 0 };

// El evento trae la cuenta en `info` (puede llegar a null en los primeros eventos);
// también se aceptan los campos planos por si el CLI los envía en otra forma.
export function totalesDelEventoTokenCount(evento: unknown): TotalesCodex | null {
  if (evento === null || typeof evento !== "object") return null;
  const ev = evento as { type?: unknown; info?: unknown };
  if (ev.type !== "token_count") return null;
  const fuente = (ev.info && typeof ev.info === "object" ? ev.info : ev) as Record<string, unknown>;
  const numero = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
  const input = numero(fuente.input_tokens);
  const cached = numero(fuente.cached_input_tokens);
  const output = numero(fuente.output_tokens);
  const reasoning = numero(fuente.reasoning_output_tokens);
  if (input === 0 && cached === 0 && output === 0 && reasoning === 0) return null;
  return { input, cached, output, reasoning };
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
