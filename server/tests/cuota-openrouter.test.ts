import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-openrouter-cuota-"));
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const claveOriginal = process.env.OPENROUTER_API_KEY;
const fetchOriginal = globalThis.fetch;
const { obtenerCuotaOpenRouter } = await import("../src/cuota-openrouter");

afterAll(() => {
  globalThis.fetch = fetchOriginal;
  if (claveOriginal === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = claveOriginal;
  rmSync(raiz, { recursive: true, force: true });
});

test("no intenta consultar la cuenta si OpenRouter no tiene una clave configurada", async () => {
  const cuota = await obtenerCuotaOpenRouter(true, () => null);
  expect(cuota.estado).toBe("sin_clave");
  expect(cuota.solicitudesGratis).toBeNull();
});

test("consulta saldo y solicitudes gratis sin guardar ni mostrar la clave", async () => {
  const clave = "clave-ficticia-openrouter-test";
  let autorizacion = "";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    autorizacion = new Headers(init?.headers).get("Authorization") ?? "";
    return Response.json({ data: {
      usage: 2.25,
      limit: 10,
      limit_remaining: 7.75,
      limit_reset: "monthly",
      is_free_tier: true,
      free_model_daily_requests: { limit: 50, used: 12, remaining: 38 },
    } });
  }) as unknown as typeof fetch;
  const cuota = await obtenerCuotaOpenRouter(true, () => clave);
  expect(autorizacion).toBe(`Bearer ${clave}`);
  expect(cuota).toMatchObject({
    estado: "consultado",
    usoUsd: 2.25,
    limiteUsd: 10,
    restanteUsd: 7.75,
    reinicio: "monthly",
    esGratis: true,
    solicitudesGratis: { limite: 50, usadas: 12, restantes: 38 },
  });
  expect(JSON.stringify(cuota)).not.toContain("clave-ficticia");
});

test("distingue una clave OpenRouter rechazada", async () => {
  globalThis.fetch = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
  const cuota = await obtenerCuotaOpenRouter(true, () => "clave-ficticia-openrouter-test");
  expect(cuota.estado).toBe("clave_invalida");
  expect(JSON.stringify(cuota)).not.toContain("OPENROUTER_API_KEY");
});
