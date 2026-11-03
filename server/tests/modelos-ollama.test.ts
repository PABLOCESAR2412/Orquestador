import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporal = mkdtempSync(join(tmpdir(), "telo-ollama-modelos-"));
const anteriorData = process.env.DATA_DIR;
process.env.DATA_DIR = join(temporal, "data");
const { parsearCatalogoOllama } = await import("../src/modelos-ollama");
const { db } = await import("../src/db");

afterAll(() => {
  db.close();
  rmSync(temporal, { recursive: true, force: true });
  if (anteriorData === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = anteriorData;
});

test("valida IDs del catálogo Ollama, conserva nombres y elimina duplicados", () => {
  expect(parsearCatalogoOllama({ data: [
    { id: "deepseek-v4:cloud", name: "DeepSeek V4 Cloud" },
    { id: "deepseek-v4:cloud", name: "Duplicado" },
    { id: "../auth.json", name: "No válido" },
    { id: "", name: "No válido" },
    null,
  ] })).toEqual([{ id: "deepseek-v4:cloud", nombre: "DeepSeek V4 Cloud" }]);
});

test("un formato inesperado no inventa modelos", () => {
  expect(parsearCatalogoOllama({ models: [{ id: "model" }] })).toEqual([]);
});
