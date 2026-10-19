import { expect, test } from "bun:test";
import { estimarUso, usoDelEvento } from "../src/runners/opencode";

test("marca las cifras de respaldo como estimadas y no como mediciones del proveedor", () => {
  const uso = estimarUso("x".repeat(40), "respuesta de prueba");
  expect(uso.input).toBe(10);
  expect(uso.output).toBe(5);
  expect(uso.tokensMedidos).toBe(false);
  expect(uso.tokensEstimados).toBe(true);
  expect(uso.costeDisponible).toBe(false);
});

test("distingue un coste cero informado de un coste ausente", () => {
  const gratis = usoDelEvento({ type: "step_finish", part: { cost: 0, tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0 } } } });
  expect(gratis?.costeDisponible).toBe(true);
  expect(gratis?.tokensMedidos).toBe(true);
  const ausente = usoDelEvento({ type: "step_finish", part: {} });
  expect(ausente?.costeDisponible).toBe(false);
  expect(ausente?.tokensMedidos).toBe(false);
  expect(usoDelEvento({ type: "step_start" })).toBeNull();
});

test("no clasifica negativos o NaN como mediciones válidas", () => {
  const uso = usoDelEvento({ type: "step_finish", part: { cost: -1, tokens: { input: NaN, output: -1, reasoning: 0, cache: { read: 0 } } } });
  expect(uso?.cost).toBe(0);
  expect(uso?.input).toBe(0);
  expect(uso?.costeDisponible).toBe(false);
  expect(uso?.tokensMedidos).toBe(false);
});
