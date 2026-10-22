import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturarAlcance, comprobarAlcance } from "../src/alcance-plan";

test("la telemetría del agente ficticio no desvía un plan sin Git", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "telo-fixture-alcance-"));
  const antes = await capturarAlcance(cwd, ["notas.txt"]);
  const proceso = Bun.spawn([process.execPath, "run", join(import.meta.dir, "fixtures", "bin", "opencode"), "run", "--", "Eres el obrero de Telo"], { cwd, stdout: "pipe", stderr: "pipe" });
  const [salida, error, code] = await Promise.all([new Response(proceso.stdout).text(), new Response(proceso.stderr).text(), proceso.exited]);
  expect(code, error).toBe(0);
  expect(salida).toContain("Carpeta ordenada");
  expect(existsSync(join(cwd, ".opencode", "fixture-analizador", "llamadas.jsonl"))).toBe(true);
  expect(await comprobarAlcance(antes)).toEqual([]);
});

test("solo excluye el registro interno indicado, no otros logs del agente", async () => {
  const { writeFileSync } = await import("node:fs");
  const cwd = mkdtempSync(join(tmpdir(), "telo-registro-alcance-"));
  writeFileSync(join(cwd,"salida.log"),"análisis");
  const antes = await capturarAlcance(cwd, ["notas.txt"], ["salida.log"]);
  writeFileSync(join(cwd,"salida.log"),"análisis y ejecución");
  expect(await comprobarAlcance(antes)).toEqual([]);
  writeFileSync(join(cwd,"otro.log"),"cambio del agente");
  expect(await comprobarAlcance(antes)).toEqual(["otro.log"]);
  const sinExcepcion = await capturarAlcance(cwd,["notas.txt"]);
  writeFileSync(join(cwd,"salida.log"),"alteración sin excepción");
  expect(await comprobarAlcance(sinExcepcion)).toEqual(["salida.log"]);
});
