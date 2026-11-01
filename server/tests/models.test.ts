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
