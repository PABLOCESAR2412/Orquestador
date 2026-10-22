import { expect, test } from "bun:test";
import { deltaNoRegistrada, sumarTotales, totalesDelEventoTokenCount } from "../src/runners/tokens-codex";

test("el evento token_count entrega la cuenta acumulada e ignora lo que no es suyo", () => {
  expect(totalesDelEventoTokenCount({ type: "token_count", info: null })).toBeNull();
  expect(totalesDelEventoTokenCount({ type: "otra_cosa", info: { input_tokens: 5 } })).toBeNull();
  expect(totalesDelEventoTokenCount({ type: "token_count", info: {} })).toBeNull();
  const t = totalesDelEventoTokenCount({ type: "token_count", info: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 5.4, reasoning_output_tokens: 2 } });
  expect(t).toEqual({ input: 100, cached: 10, output: 5, reasoning: 2 });
});

test("el uso del turno se suma para saber cuánto ya quedó contado", () => {
  const suma = sumarTotales({ input: 40, cached: 0, output: 20, reasoning: 3 }, { input: 20, cached: 5, output: 10, reasoning: 1 });
  expect(suma).toEqual({ input: 60, cached: 5, output: 30, reasoning: 4 });
});

test("el delta pendiente se calcula desde la base de esta ejecución, descontando los turnos contados", () => {
  const base = { input: 100, cached: 10, output: 5, reasoning: 2 };
  const ultimo = { input: 140, cached: 10, output: 25, reasoning: 5 };
  // Lo que pasó mientras el turno completaba ya está contado por turn.completed: nada pendiente.
  expect(deltaNoRegistrada(base, ultimo, { input: 40, cached: 0, output: 20, reasoning: 3 })).toBeNull();
  // Sin turnos completados (fallo a mitad de turno): el delta completo es el pendiente.
  expect(deltaNoRegistrada(base, ultimo, { input: 0, cached: 0, output: 0, reasoning: 0 })).toEqual({
    input: 40, cached: 0, output: 20, reasoning: 3,
  });
  // El historial previo de la sesión (resume) queda fuera: la base lo resta.
  expect(deltaNoRegistrada(base, ultimo, { input: 30, cached: 0, output: 25, reasoning: 3 })).toEqual({
    input: 10, cached: 0, output: 0, reasoning: 0,
  });
  // Sin observación acumulada no hay nada pendiente.
  expect(deltaNoRegistrada(null, null, base)).toBeNull();
  expect(deltaNoRegistrada(null, { input: 5, cached: 0, output: 0, reasoning: 0 }, base)).toBeNull();
});
