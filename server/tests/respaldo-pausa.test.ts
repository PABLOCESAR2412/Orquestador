import { afterAll, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pausarParaRespaldo } from "../src/respaldo-pausa";

const raiz = mkdtempSync(join(tmpdir(), "telo-respaldo-pausa-"));
const anterior = { marca: process.env.TELO_MARCA_DESPLIEGUE, api: process.env.TELO_API };
afterAll(() => {
  for (const [clave, valor] of [["TELO_MARCA_DESPLIEGUE", anterior.marca], ["TELO_API", anterior.api]]) {
    if (valor === undefined) delete process.env[clave!]; else process.env[clave!] = valor;
  }
  rmSync(raiz, { recursive: true, force: true });
});
test("una operación previa conserva su marca y sus archivos", async () => {
  const marca = join(raiz, "ajena"); mkdirSync(marca);
  writeFileSync(join(marca, "propietario"), "otro respaldo");
  process.env.TELO_MARCA_DESPLIEGUE = marca;
  await expect(pausarParaRespaldo()).rejects.toThrow();
  expect(readFileSync(join(marca, "propietario"), "utf8")).toBe("otro respaldo");
});
test("espera al drenado y libera únicamente su propia marca", async () => {
  const marca = join(raiz, "propia");
  let consultas = 0;
  const servidor = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() {
    return Response.json({ ok: true, despliegue: { mantenimiento: true, activas: consultas++ === 0 ? 1 : 0 } });
  } });
  process.env.TELO_MARCA_DESPLIEGUE = marca; process.env.TELO_API = servidor.url.toString();
  const procesos = spyOn(Bun, "spawnSync").mockImplementation(() => ({ exitCode: 1 }) as ReturnType<typeof Bun.spawnSync>);
  try {
    const liberar = await pausarParaRespaldo();
    expect(consultas).toBe(2); expect(existsSync(marca)).toBe(true);
    liberar(); liberar(); expect(existsSync(marca)).toBe(false);
  } finally { procesos.mockRestore(); servidor.stop(true); }
}, 10_000);
