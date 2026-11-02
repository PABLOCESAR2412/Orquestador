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

test("la capacidad visual procede de metadatos explícitos, no del nombre ni del precio", () => {
  const metadatos = [{capabilities:{input:{image:true}}}, {capabilities:{input:["text"]}}, {modalities:{input:["text","image"]}}, {}];
  const modelos = parseModels(metadatos.map((m,i) => `prueba/modelo-${i}\n${JSON.stringify(m)}\n`).join(""));
  expect(modelos.map(m => m.supportsImages)).toEqual([true, false, true, undefined]);
});

test("conserva el Gemini del proveedor oficial de Google y elimina el duplicado Zen", () => {
  const catalogo = parseModels(
    `opencode/gemini-4-argon\n${modelo}\ngoogle/gemini-4-argon\n${modelo}\n`,
  );
  expect(catalogo.map((m) => m.id)).toEqual(["google/gemini-4-argon"]);
  expect(catalogo[0]?.provider).toBe("google");
});


test("un catálogo sin precio o con precio parcial/inválido no demuestra gratuidad", () => {
  for(const cost of [undefined,{input:0},{input:-1,output:0}]){
    const m=parseModels(`google/sin-precio\n${JSON.stringify({name:'Sin precio',cost})}\n`)[0]!;
    expect(m.free).toBe(false);expect(m.priceKnown).toBe(false);expect(m.costTier).toBe('desconocido');expect(m.costWarning).toContain('precio verificable');
  }
  const gratis=parseModels('google/gratis\n{"cost":{"input":0,"output":0}}\n')[0]!;
  expect(gratis.free).toBe(true);expect(gratis.priceKnown).toBe(true);
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
  const catalogo = parseModels(ids.flatMap((id) => [id, modelo]).join("\n"));
  expect(catalogo.map((m) => m.id)).toEqual([
    "google/gemini-3.1-flash-lite",
    "openrouter/gemini-2.5-flash",
  ]);
});