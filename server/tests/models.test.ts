import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const raiz = join(tmpdir(), "telo-modelos-pruebas");
if (!process.env.TELO_PRUEBAS_MODELOS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_MODELOS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { parseModels } = await import("../src/models");

const modelo = JSON.stringify({ name: "Gemini 4 Argon", cost: { input: 0, output: 0 }, limit: { context: 1000 } });

test("conserva el Gemini del proveedor oficial de Google y elimina el duplicado Zen", () => {
  const catalogo = parseModels(
    `opencode/gemini-4-argon\n${modelo}\ngoogle/gemini-4-argon\n${modelo}\n`,
  );
  expect(catalogo.map((m) => m.id)).toEqual(["google/gemini-4-argon"]);
  expect(catalogo[0]?.provider).toBe("google");
});

test("oculta modelos Gemini de Google cerrados o restringidos y conserva proveedores alternativos", () => {
  const ids = [
    "google/gemini-2.0-flash",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-3.1-flash-lite",
    "openrouter/gemini-2.5-flash",
  ];
  const catalogo = parseModels(ids.map((id) => `${id}\n${modelo}\n`).join(""));
  expect(catalogo.map((m) => m.id)).toEqual([
    "google/gemini-3.1-flash-lite",
    "openrouter/gemini-2.5-flash",
  ]);
});

test("solo marca como gratis los modelos cuyo precio cero está publicado", () => {
  const catalogo = parseModels([
    `nvidia/nemotron-free\n${JSON.stringify({ name: "Nemotron Free", cost: { input: 0, output: 0 } })}`,
    `opencode/grok-4\n${JSON.stringify({ name: "Grok 4" })}`,
  ].join("\n"));
  expect(catalogo).toHaveLength(2);
  expect(catalogo[0]).toMatchObject({ free: true, costAvailable: true, group: "Precio $0" });
  expect(catalogo[1]).toMatchObject({
    free: false,
    costAvailable: false,
    group: "Precio no publicado",
    recommended: true,
  });
});

test("no ofrece modelos de embeddings como modelos de chat", () => {
  const catalogo = parseModels([
    `google/gemini-embedding-001\n${JSON.stringify({ name: "Gemini Embedding 001", cost: { input: 0, output: 0 } })}`,
    `google/gemini-3.5-flash-lite\n${modelo}`,
    `openrouter/text-embedding-3-small\n${JSON.stringify({ name: "Text Embedding 3 Small", cost: { input: 0, output: 0 } })}`,
  ].join("\n"));
  expect(catalogo.map((m) => m.id)).toEqual(["google/gemini-3.5-flash-lite"]);
});
