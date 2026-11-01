import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const linux = process.platform === "linux";
const anteriores = { PATH: process.env.PATH, DATA_DIR: process.env.DATA_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO };
const raiz = mkdtempSync(join(tmpdir(), "telo-espera-proveedor-"));
const bin = join(raiz, "bin");
mkdirSync(bin);
const { runOpenCode } = await import("../src/runners/opencode");
const { runCodex } = await import("../src/runners/codex");
afterAll(() => {
  for (const [k,v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(raiz, { recursive: true, force: true });
});
function preparar(nombre: string, codigo: string) {
  process.env.DATA_DIR = join(raiz, "data");
  process.env.TELO_AISLAMIENTO = "desactivado";
  process.env.PATH = `${bin}${delimiter}${anteriores.PATH ?? ""}`;
  writeFileSync(join(bin, nombre), `#!/bin/sh\n${codigo}\n`);
  chmodSync(join(bin, nombre), 0o755);
}

test.skipIf(!linux)("los latidos sin respuesta no retienen el chat y conservan la sesión", async () => {
  preparar("opencode", `echo '{"type":"step_start","sessionID":"ses_guardada"}'\nwhile true; do echo '{"type":"telo.provider","sessionID":"ses_guardada","status":"busy"}'; sleep .05; done`);
  let sesion = "";
  const inicio = Date.now();
  await expect(runOpenCode({ cwd: raiz, model: "prueba/modelo", prompt: "Revisa", timeoutMs: null, tiempoSinActividadMs: null, tiempoPrimeraRespuestaMs: 200, onSesion: id => { sesion = id; } })).rejects.toThrow("no empezó a responder");
  expect(sesion).toBe("ses_guardada");
  expect(Date.now() - inicio).toBeLessThan(3_000);
});

test.skipIf(!linux)("una herramienta iniciada puede tardar más que el plazo de primera respuesta", async () => {
  preparar("opencode", `echo '{"type":"tool_use","sessionID":"ses_larga","part":{"tool":"bash","state":{"status":"running","input":{"command":"render"}}}}'\nsleep .6\necho '{"type":"text","sessionID":"ses_larga","part":{"text":"Render comprobado"}}'`);
  const r = await runOpenCode({ cwd: raiz, model: "prueba/modelo", prompt: "Render", timeoutMs: null, tiempoSinActividadMs: null, tiempoPrimeraRespuestaMs: 200 });
  expect(r.textoFinal).toBe("Render comprobado");
});

test.skipIf(!linux)("Codex también detiene la espera inicial sin borrar la sesión", async () => {
  preparar("codex", `echo '{"type":"thread.started","thread_id":"01989d9d-1111-7111-8111-111111111111"}'\nsleep 30`);
  let sesion = "";
  await expect(runCodex({ cwd: raiz, model: "codex/prueba", prompt: "Revisa", timeoutMs: null, tiempoSinActividadMs: null, tiempoPrimeraRespuestaMs: 200, onSesion: id => { sesion = id; } })).rejects.toThrow("no empezó a responder");
  expect(sesion).toContain("01989d9d");
});
