import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = join(tmpdir(), "telo-pruebas-servicio", "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { consultarBalanceOllama } = await import("../src/cuota-ollama");

test("Ollama distingue créditos incluidos, comprados y ventanas de planes anteriores", async () => {
  const reinicio = "2026-11-10T17:00:00.000Z";
  const solicitar = (datos: unknown) => (async (entrada: Parameters<typeof fetch>[0], opciones?: RequestInit) => {
    expect(entrada).toBe("https://ollama.com/api/balance");
    expect(new Headers(opciones?.headers).get("Authorization")).toBe("Bearer prueba");
    expect(opciones?.redirect).toBe("error");
    return Response.json(datos);
  }) as typeof fetch;

  const actual = await consultarBalanceOllama("prueba", solicitar({
    included: { balance_usd: 0, allowance_usd: 60, period: { until: reinicio } },
    purchased: { balance_usd: 25 },
  }));
  expect(actual).toMatchObject({ estado: "activo", incluidos: { restanteUsd: 0, limiteUsd: 60, reiniciaEn: reinicio }, compradosUsd: 25, ventanas: [] });

  const legado = await consultarBalanceOllama("prueba", solicitar({
    included: { session: { remaining_percent: 75, resets_at: reinicio }, weekly: { remaining_percent: 0, resets_at: reinicio } },
  }));
  expect(legado).toMatchObject({
    estado: "activo",
    incluidos: null,
    compradosUsd: null,
    ventanas: [
      { nombre: "Sesión", restantePorcentaje: 75, reiniciaEn: reinicio },
      { nombre: "Semanal", restantePorcentaje: 0, reiniciaEn: reinicio },
    ],
  });
});
