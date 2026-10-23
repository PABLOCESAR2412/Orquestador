import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturarAlcance, comprobarAlcance } from "../src/alcance-plan";

const { gitOk } = await import("../src/git");

async function repoIgnorado(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "telo-alcance-ign-"));
  await gitOk(["init", "-b", "main"], { cwd });
  writeFileSync(join(cwd, ".gitignore"), "salida.txt\nnode_modules/\n");
  writeFileSync(join(cwd, "nota.md"), "hola\n");
  return cwd;
}

test("un ignorado creado durante la tarea no queda invisible al alcance", async () => {
  const cwd = await repoIgnorado();
  const antes = await capturarAlcance(cwd, ["nota.md"]);
  writeFileSync(join(cwd, "salida.txt"), "entrega");
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  writeFileSync(join(cwd, "node_modules", "paquete.bin"), "ruido");
  // El entregable ignorado y no declarado aparece como fuera del plan; el ruido de
  // dependencias no entra en la lista.
  expect(await comprobarAlcance(antes)).toEqual(["salida.txt"]);
});

test("un ignorado declarado en el plan queda permitido", async () => {
  const cwd = await repoIgnorado();
  const antes = await capturarAlcance(cwd, ["nota.md", "salida.txt"]);
  writeFileSync(join(cwd, "salida.txt"), "entrega");
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  writeFileSync(join(cwd, "node_modules", "paquete.bin"), "ruido");
  expect(await comprobarAlcance(antes)).toEqual([]);
});

test("un ignorado que cambia de contenido se vuelve a detectar", async () => {
  const cwd = await repoIgnorado();
  writeFileSync(join(cwd, "salida.txt"), "v1");
  const antes = await capturarAlcance(cwd, ["nota.md"]);
  writeFileSync(join(cwd, "salida.txt"), "v2");
  expect(await comprobarAlcance(antes)).toEqual(["salida.txt"]);
});
