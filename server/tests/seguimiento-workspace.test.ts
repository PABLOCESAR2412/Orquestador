import { expect, test } from "bun:test";
import { join } from "node:path";
test.skipIf(process.platform !== "linux")("la corrección conserva conflictos del PR, aísla main en nueva rama y rechaza un snapshot avanzado incluso al reintentar", async () => {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/seguimiento-workspace.ts")], { stdout: "pipe", stderr: "pipe" });
  const [codigo, salida, error] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect({ codigo, error: codigo ? salida + error : "" }).toEqual({ codigo: 0, error: "" });
}, 30_000);
