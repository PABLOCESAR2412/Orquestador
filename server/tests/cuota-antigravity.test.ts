import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(tmpdir(), "telo-pruebas-servicio");
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { interpretarUsoAntigravity } = await import("../src/cuota-antigravity");

test("interpreta el reporte JSON de cuotas de Antigravity", () => {
  const uso = interpretarUsoAntigravity(
    JSON.stringify({ status: "SUCCESS", response: "Gemini 3.5 Flash: 80% restante" }),
    "",
    0,
    1_800_000_000_000,
  );
  expect(uso).toMatchObject({
    estado: "activo",
    respuesta: "Gemini 3.5 Flash: 80% restante",
    comprobadoEn: new Date(1_800_000_000_000).toISOString(),
  });
});

test("identifica una sesión de Google ausente sin mostrar datos privados", () => {
  const uso = interpretarUsoAntigravity(
    JSON.stringify({ status: "ERROR", response: "", error: "Authentication required" }),
    "",
    1,
  );
  expect(uso.estado).toBe("sin_sesion");
  expect(uso.respuesta).toBeNull();
});

test("conserva cada grupo y solo las ventanas que la CLI habilita", () => {
  const reinicio = "2026-11-10T17:00:00Z";
  const uso = interpretarUsoAntigravity(JSON.stringify({
    status: "SUCCESS",
    command: { name: "usage", data: { plan_tier: "Google AI Plus", groups: [
      { name: "Gemini Models", buckets: [
        { id: "gemini-weekly", window: "weekly", remaining_fraction: 0.71, reset_time: reinicio },
        { id: "gemini-5h", window: "5h", remaining_fraction: 1, disabled: true },
      ] },
      { name: "Claude and GPT models", buckets: [
        { id: "3p-weekly", window: "weekly", remaining_fraction: 0, reset_time: reinicio },
      ] },
    ] } },
  }), "", 0);
  expect(uso.plan).toBe("Google AI Plus");
  expect(uso.respuesta).toBeNull();
  expect(uso.grupos).toMatchObject([
    { nombre: "Gemini Models", ventanas: [{ id: "gemini-weekly", restantePorcentaje: 71, reiniciaEn: reinicio }] },
    { nombre: "Claude and GPT models", ventanas: [{ id: "3p-weekly", restantePorcentaje: 0, reiniciaEn: reinicio }] },
  ]);
});

test("conserva texto plano útil y devuelve fallos de cuota como no disponibles", () => {
  const uso = interpretarUsoAntigravity("No se pudo consultar el límite", "", 1);
  expect(uso.estado).toBe("no_disponible");
  expect(uso.detalle).toBe("No se pudo consultar el límite");
});

test("reconoce las etiquetas de ventana publicadas y deja el plan vacío si no se informa", () => {
  const uso = interpretarUsoAntigravity(JSON.stringify({ response: { groups: [{
    displayName: "Gemini Models",
    buckets: [
      { bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", remainingFraction: 0.5 },
      { bucketId: "gemini-5h", displayName: "Five Hour Limit Remaining", remainingFraction: 0.75 },
    ],
  }] } }), "", 0);
  expect(uso.plan).toBeNull();
  expect(uso.grupos[0]?.ventanas.map((ventana) => ventana.nombre)).toEqual(["Semanal · 7 d", "Sesión · 5 h"]);
});
