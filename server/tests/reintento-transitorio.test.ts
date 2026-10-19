import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-reintento-transitorio-"));
const bin = join(raiz, "bin");
const contador = join(raiz, "llamadas.txt");
const sesionRecibida = join(raiz, "sesion.txt");
const promptRecibido = join(raiz, "prompt.txt");
const entornoAnterior = { PATH: process.env.PATH, DATA_DIR: process.env.DATA_DIR, TELO_PROYECTOS_DIR: process.env.TELO_PROYECTOS_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO };
mkdirSync(bin, { recursive: true });
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
process.env.TELO_AISLAMIENTO = "desactivado";
process.env.PATH = `${bin}${delimiter}${entornoAnterior.PATH ?? ""}`;

writeFileSync(join(bin, "opencode"), `#!/bin/sh
anterior=""
sesion=""
for argumento in "$@"; do
  if [ "$anterior" = "-s" ]; then sesion="$argumento"; fi
  anterior="$argumento"
  prompt="$argumento"
done
intentos=0
if [ -f '${contador}' ]; then intentos=$(cat '${contador}'); fi
intentos=$((intentos + 1))
echo "$intentos" > '${contador}'
if [ "$intentos" -eq 1 ]; then
  echo '{"type":"step-start","sessionID":"retry-session-1"}'
  echo '{"type":"error","sessionID":"retry-session-1","error":{"statusCode":500,"data":{"statusCode":500,"message":"temporary server error"}}}'
  exit 1
fi
printf '%s' "$sesion" > '${sesionRecibida}'
printf '%s' "$prompt" > '${promptRecibido}'
echo '{"type":"text","sessionID":"retry-session-1","part":{"type":"text","text":"Continué sin repetir."}}'
`);
chmodSync(join(bin, "opencode"), 0o755);

const { db } = await import("../src/db");
const { ejecutarAgente } = await import("../src/ejecutar");

beforeAll(() => mkdirSync(process.env.TELO_PROYECTOS_DIR!, { recursive: true }));
afterAll(() => {
  db.close();
  for (const [clave, valor] of Object.entries(entornoAnterior)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  rmSync(raiz, { recursive: true, force: true });
});

test.skipIf(!Bun.which("setsid"))("reanuda la sesión después de 5xx en vez de repetir el prompt", async () => {
  const resultado = await ejecutarAgente({ prompt: "Haz una acción sin duplicarla", model: "opencode/prueba", cwd: raiz });

  expect(resultado.textoFinal).toBe("Continué sin repetir.");
  expect(readFileSync(contador, "utf8")).toBe("2\n");
  expect(readFileSync(sesionRecibida, "utf8")).toBe("retry-session-1");
  const prompt = readFileSync(promptRecibido, "utf8");
  expect(prompt).toContain("Continúa donde te quedaste");
  expect(prompt).toContain("no repitas pasos completados");
  expect(prompt).toContain("Haz una acción sin duplicarla");
});
