import { describe, expect, test } from "bun:test";
import { duracionEntre, haceTextoCorto, tiempoTranscurrido } from "../src/lib/tiempo";

describe("duración del chat", () => {
  test("calcula el tiempo entre el mensaje y la respuesta en UTC e ISO", () => {
    expect(duracionEntre("2026-10-15 12:00:00", "2026-10-15T12:01:07Z")).toBe("1 min 7 s");
  });

  test("muestra el tiempo en curso y omite fechas inválidas o invertidas", () => {
    expect(tiempoTranscurrido("2026-10-15T12:00:00+00:00", Date.parse("2026-10-15T12:00:09Z"))).toBe("9 s");
    expect(duracionEntre("2026-10-15 12:00:10", "2026-10-15 12:00:00")).toBeNull();
    expect(duracionEntre("no es una fecha", "2026-10-15 12:00:00")).toBeNull();
  });

  test("haceTextoCorto formatea tiempos compactos para el árbol lateral", () => {
    const ahora = Date.parse("2026-10-16T12:00:00Z");
    expect(haceTextoCorto(null, ahora)).toBe("ahora");
    expect(haceTextoCorto("2026-10-16T11:59:45Z", ahora)).toBe("ahora");
    expect(haceTextoCorto("2026-10-16T11:47:00Z", ahora)).toBe("13m");
    expect(haceTextoCorto("2026-10-16T06:00:00Z", ahora)).toBe("6h");
    expect(haceTextoCorto("2026-10-12T12:00:00Z", ahora)).toBe("4d");
    expect(haceTextoCorto("2026-09-16T12:00:00Z", ahora)).toBe("1mo");
    expect(haceTextoCorto("2025-05-16T12:00:00Z", ahora)).toBe("1y");
  });
});
