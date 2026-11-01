import { expect, test } from "bun:test";
import { join } from "node:path";

test("el flujo compartido conserva contexto y uso sin compartir perfiles de auxiliares", async () => {
  // Los mocks de runners viven en otro proceso para no contaminar la suite unificada.
  const proceso = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "ejecucion-contexto.ts")], { stdout: "pipe", stderr: "pipe" });
  const [codigo, salida, error] = await Promise.all([proceso.exited, new Response(proceso.stdout).text(), new Response(proceso.stderr).text()]);
  expect({ codigo, error: codigo ? error + salida : "" }).toEqual({ codigo: 0, error: "" });
}, 10_000);
