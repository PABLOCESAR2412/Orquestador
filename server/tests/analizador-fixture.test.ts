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
