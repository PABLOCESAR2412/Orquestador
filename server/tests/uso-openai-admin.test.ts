import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-openai-admin-"));
const dataDirOriginal = process.env.DATA_DIR;
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const fetchOriginal = globalThis.fetch;
const { obtenerUsoOpenAIAdmin } = await import("../src/routes/uso");

afterAll(() => {
  globalThis.fetch = fetchOriginal;
  if (dataDirOriginal === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDirOriginal;
  rmSync(raiz, { recursive: true, force: true });
});

test("sin Admin API key no intenta consultar y explica el requisito", async () => {
  let llamadas = 0;
  globalThis.fetch = (async () => { llamadas += 1; return Response.json({}); }) as unknown as typeof fetch;
  const datos = await obtenerUsoOpenAIAdmin(true, () => null);
  expect(datos.estado).toBe("sin_configurar");
  expect(datos.mensaje).toContain("Admin API key");
  expect(llamadas).toBe(0);
});

test("consulta costes y tokens por modelo de la organización en los últimos 30 días", async () => {
  const llamadas: { url: URL; authorization: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    llamadas.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    if (url.pathname.endsWith("/organization/costs")) {
      return Response.json({ data: [
        { results: [{ amount: { value: 0.00123, currency: "usd" } }] },
        { results: [{ amount: { value: 0.4567, currency: "usd" } }] },
      ] });
    }
    return Response.json({ data: [
      { results: [{ model: "gpt-5-mini", input_tokens: 10, output_tokens: 20, num_model_requests: 2 }] },
      { results: [
        { model: "gpt-5-mini", input_tokens: 5, output_tokens: 7, num_model_requests: 1 },
        { model: "gpt-5", input_tokens: 100, output_tokens: 25, num_model_requests: 1 },
      ] },
    ] });
  }) as unknown as typeof fetch;

  const datos = await obtenerUsoOpenAIAdmin(true, () => "clave-admin-ficticia-test");
  expect(datos).toMatchObject({
    estado: "consultado",
    costoUsd30d: 0.4579,
    solicitudes30d: 4,
    tokensEntrada30d: 115,
    tokensSalida30d: 52,
    porModelo: [
      { modelo: "gpt-5-mini", solicitudes: 3, tokensEntrada: 15, tokensSalida: 27 },
      { modelo: "gpt-5", solicitudes: 1, tokensEntrada: 100, tokensSalida: 25 },
    ],
  });
  expect(llamadas).toHaveLength(2);
  expect(llamadas.every((fila) => fila.authorization === "Bearer clave-admin-ficticia-test")).toBe(true);
  expect(llamadas.every((fila) => fila.url.searchParams.get("limit") === "31")).toBe(true);
  expect(llamadas.find((fila) => fila.url.pathname.endsWith("/usage/completions"))?.url.searchParams.get("group_by")).toBe("model");
  expect(JSON.stringify(datos)).not.toContain("clave-admin-ficticia-test");
});

test("no informa consumos si OpenAI rechaza la Admin API key", async () => {
  globalThis.fetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
  const datos = await obtenerUsoOpenAIAdmin(true, () => "clave-admin-ficticia-test");
  expect(datos.estado).toBe("sin_permisos");
  expect(datos.costoUsd30d).toBeNull();
});
