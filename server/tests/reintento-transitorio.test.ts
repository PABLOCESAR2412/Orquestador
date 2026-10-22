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
if [ "$1" = "models" ]; then
  echo "opencode/prueba"
  echo '{"name":"Prueba","cost":{"input":0,"output":0},"limit":{"context":64000},"variants":{}}'
  echo "opencode/respaldo"
  echo '{"name":"Respaldo","cost":{"input":0,"output":0},"limit":{"context":64000},"variants":{}}'
  echo "opencode/respaldo-pago"
  echo '{"name":"Respaldo de pago","cost":{"input":1,"output":2},"limit":{"context":64000},"variants":{}}'
  exit 0
fi
anterior=""
sesion=""
modelo=""
for argumento in "$@"; do
  if [ "$anterior" = "-s" ]; then sesion="$argumento"; fi
  if [ "$anterior" = "-m" ]; then modelo="$argumento"; fi
  anterior="$argumento"
  prompt="$argumento"
done
intentos=0
if [ -f '${contador}' ]; then intentos=$(cat '${contador}'); fi
intentos=$((intentos + 1))
echo "$intentos" > '${contador}'
if [ "$modelo" = "opencode/respaldo" ]; then
  printf '%s' "$sesion" > '${sesionRecibida}'
  printf '%s' "$prompt" > '${promptRecibido}'
  echo '{"type":"text","sessionID":"retry-session-1","part":{"type":"text","text":"Respaldo completó lo pendiente."}}'
  exit 0
fi
if [ "$intentos" -eq 1 ]; then
  echo '{"type":"step-start","sessionID":"retry-session-1"}'
  echo '{"type":"error","sessionID":"retry-session-1","error":{"statusCode":500,"data":{"statusCode":500,"message":"temporary server error"}}}'
  exit 1
fi
case "$prompt" in *FALLBACK-SEGURIDAD*)
  echo '{"type":"error","sessionID":"retry-session-1","error":{"statusCode":500,"data":{"statusCode":500,"message":"temporary server error"}}}'
  exit 1
;; esac
printf '%s' "$sesion" > '${sesionRecibida}'
printf '%s' "$prompt" > '${promptRecibido}'
echo '{"type":"text","sessionID":"retry-session-1","part":{"type":"text","text":"Continué sin repetir."}}'
`);
chmodSync(join(bin, "opencode"), 0o755);

const { db } = await import("../src/db");
const { ejecutarAgente } = await import("../src/ejecutar");
const { DEFAULT_PREFERENCES, savePreferences } = await import("../src/preferences");
const { invalidarModelos } = await import("../src/models");

beforeAll(() => mkdirSync(process.env.TELO_PROYECTOS_DIR!, { recursive: true }));
afterAll(() => {
  savePreferences(DEFAULT_PREFERENCES);
  db.close();
  for (const [clave, valor] of Object.entries(entornoAnterior)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  rmSync(raiz, { recursive: true, force: true });
});

test.skipIf(!Bun.which("setsid"))("reanuda la sesión después de 5xx en vez de repetir el prompt", async () => {
  savePreferences(DEFAULT_PREFERENCES);
  rmSync(contador, { force: true });
  const resultado = await ejecutarAgente({ prompt: "Haz una acción sin duplicarla", model: "opencode/prueba", cwd: raiz });

  expect(resultado.textoFinal).toBe("Continué sin repetir.");
  expect(readFileSync(contador, "utf8")).toBe("2\n");
  expect(readFileSync(sesionRecibida, "utf8")).toBe("retry-session-1");
  const prompt = readFileSync(promptRecibido, "utf8");
  expect(prompt).toContain("Continúa donde te quedaste");
  expect(prompt).toContain("no repitas pasos completados");
  expect(prompt).toContain("Haz una acción sin duplicarla");
});

test.skipIf(!Bun.which("setsid"))("el respaldo continúa el trabajo previo con una sesión y un prompt seguros", async () => {
  rmSync(contador, { force: true });
  savePreferences({ ...DEFAULT_PREFERENCES, fallbackModel: "opencode/respaldo" });
  invalidarModelos();
  const resultado = await ejecutarAgente({
    prompt: "FALLBACK-SEGURIDAD: termina el cambio sin repetirlo",
    model: "opencode/prueba",
    cwd: raiz,
  });

  expect(resultado.textoFinal).toBe("Respaldo completó lo pendiente.");
  expect(readFileSync(contador, "utf8")).toBe("3\n");
  expect(readFileSync(sesionRecibida, "utf8")).toBe("");
  const prompt = readFileSync(promptRecibido, "utf8");
  expect(prompt).toContain("Continúa la petición con el historial y el estado del workspace disponibles");
  expect(prompt).toContain("revisa los cambios y artefactos actuales");
  expect(prompt).toContain("FALLBACK-SEGURIDAD");
  savePreferences(DEFAULT_PREFERENCES);
});

test.skipIf(!Bun.which("setsid"))("un modelo gratuito no recurre automáticamente a un respaldo de pago", async () => {
  rmSync(contador, { force: true });
  savePreferences({ ...DEFAULT_PREFERENCES, fallbackModel: "opencode/respaldo-pago" });
  invalidarModelos();
  await expect(ejecutarAgente({
    prompt: "FALLBACK-SEGURIDAD: termina el cambio sin repetirlo",
    model: "opencode/prueba",
    cwd: raiz,
  })).rejects.toThrow("no se usó el respaldo de pago opencode/respaldo-pago para evitar cargos");
  expect(readFileSync(contador, "utf8")).toBe("2\n");
  savePreferences(DEFAULT_PREFERENCES);
});
