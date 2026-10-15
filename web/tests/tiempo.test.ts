import { describe, expect, test } from "bun:test";
import { duracionEntre, tiempoTranscurrido } from "../src/lib/tiempo";

describe("duración del chat", () => {
  test("calcula el tiempo entre el mensaje y la respuesta en UTC e ISO", () => {
    expect(duracionEntre("2026-10-15 12:00:00", "2026-10-15T12:01:07Z")).toBe("1 min 7 s");
  });

  test("muestra el tiempo en curso y omite fechas inválidas o invertidas", () => {
    expect(tiempoTranscurrido("2026-10-15T12:00:00+00:00", Date.parse("2026-10-15T12:00:09Z"))).toBe("9 s");
    expect(duracionEntre("2026-10-15 12:00:10", "2026-10-15 12:00:00")).toBeNull();
    expect(duracionEntre("no es una fecha", "2026-10-15 12:00:00")).toBeNull();
  });
});
