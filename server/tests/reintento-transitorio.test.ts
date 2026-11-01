import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-reintento-transitorio-"));
const bin = join(raiz, "bin");
const contador = join(raiz, "llamadas.txt");
const sesionRecibida = join(raiz, "sesion.txt");
const promptRecibido = join(raiz, "prompt.txt");
const entornoAnterior = { PATH: process.env.PATH, DATA_DIR: process.env.DATA_DIR, TELO_PROYECTOS_DIR: process.env.TELO_PROYECTOS_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO, TELO_REINTENTO_ESPERAS_MS: process.env.TELO_REINTENTO_ESPERAS_MS };
mkdirSync(bin, { recursive: true });
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
process.env.TELO_AISLAMIENTO = "desactivado";
// Esperas mínimas: el multireintento es lo que se prueba, no la paciencia real del servidor.
process.env.TELO_REINTENTO_ESPERAS_MS = "5,10,15";
process.env.PATH = `${bin}${delimiter}${entornoAnterior.PATH ?? ""}`;

writeFileSync(join(bin, "opencode"), `#!/bin/sh
if [ "$1" = "models" ]; then
  echo "opencode/prueba"
  echo '{"name":"Prueba","cost":{"input":0,"output":0},"limit":{"context":64000},"variants":{}}'
  echo "opencode/respaldo"
  echo '{"name":"Respaldo","cost":{"input":0,"output":0},"limit":{"context":64000},"variants":{}}'
  echo "opencode/respaldo-pago"
  echo '{"name":"Respaldo de pago","cost":{"input":1,"output":2},"limit":{"context":64000},"variants":{}}'
  echo "opencode/automatico"
  echo '{"name":"Automatico","cost":{"input":0,"output":0},"limit":{"context":64000},"variants":{}}'
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
case "$prompt" in *CUOTA-CADENA*|*CUOTA-AUTH*|*CUOTA-TEMP*)
  if [ "$modelo" != "opencode/automatico" ]; then
    case "$prompt:$modelo" in *CUOTA-AUTH*:opencode/respaldo)
      echo '{"type":"error","error":{"statusCode":401,"data":{"statusCode":401,"message":"Unauthorized"}}}'
      exit 1
    ;; esac
    case "$prompt:$modelo" in *CUOTA-TEMP*:opencode/respaldo)
      echo '{"type":"error","error":{"statusCode":503,"data":{"statusCode":503,"message":"Service unavailable"}}}'
      exit 1
    ;; esac
    echo '{"type":"error","error":{"statusCode":429,"data":{"statusCode":429,"message":"Quota exceeded"}}}'
    exit 1
  fi
  printf '%s' "$sesion" > '${sesionRecibida}'
  printf '%s' "$prompt" > '${promptRecibido}'
  echo '{"type":"text","sessionID":"automatico-session","part":{"type":"text","text":"Automatico completó lo pendiente."}}'
  exit 0
;; esac
if [ "$modelo" = "opencode/respaldo" ]; then
  printf '%s' "$sesion" > '${sesionRecibida}'
  printf '%s' "$prompt" > '${promptRecibido}'
  echo '{"type":"text","sessionID":"retry-session-1","part":{"type":"text","text":"Respaldo completó lo pendiente."}}'
  exit 0
fi
if [ "$sesion" = "missing-session" ]; then
  echo '{"type":"error","error":{"message":"Session not found"}}'
  exit 1
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

test.skipIf(!Bun.which("setsid"))("recupera una sesión OpenCode perdida y reconstruye el contexto del mismo chat", async () => {
  savePreferences(DEFAULT_PREFERENCES);
  rmSync(contador, { force: true });
  const conversationId = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title, model) VALUES (?, 'Sesión perdida', 'opencode/prueba')").run(conversationId);
  const otherConversationId = crypto.randomUUID();
  db.query("INSERT INTO conversations (id, title, model) VALUES (?, 'Otro chat del mismo modelo', 'opencode/prueba')").run(otherConversationId);
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'HISTORIA-DE-OTRO-CHAT: no mezclar')")
    .run(crypto.randomUUID(), otherConversationId);
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'HISTORIA-ANTERIOR: consulta inicial')")
    .run(crypto.randomUUID(), conversationId);
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'Respuesta anterior del mismo chat')")
    .run(crypto.randomUUID(), conversationId);
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', 'Continúa con mi consulta actual')")
    .run(crypto.randomUUID(), conversationId);
  const sesiones: [string | null, string | null][] = [];

  const resultado = await ejecutarAgente({
    prompt: "Continúa con mi consulta actual",
    model: "opencode/prueba",
    cwd: raiz,
    conversationId,
    sessionId: "missing-session",
    sessionModel: "opencode/prueba",
    onSesion: (id, modelo) => sesiones.push([id, modelo]),
  });

  expect(resultado.textoFinal).toBe("Continué sin repetir.");
  expect(readFileSync(contador, "utf8")).toBe("2\n");
  expect(readFileSync(sesionRecibida, "utf8")).toBe("");
  const prompt = readFileSync(promptRecibido, "utf8");
  expect(prompt).toContain("HISTORIA-ANTERIOR: consulta inicial");
  expect(prompt).not.toContain("HISTORIA-DE-OTRO-CHAT");
  expect(prompt).toContain("Respuesta anterior del mismo chat");
  expect(prompt).toContain("Instrucción actual de la tarea:\nContinúa con mi consulta actual");
  expect(sesiones).toContainEqual([null, null]);
  expect(sesiones).toContainEqual(["retry-session-1", "opencode/prueba"]);
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
  // Original + 3 reintentos transitorios + el intento del respaldo.
  expect(readFileSync(contador, "utf8")).toBe("5\n");
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
  // Original + 3 reintentos transitorios; sin respaldo de pago tras agotarlos.
  expect(readFileSync(contador, "utf8")).toBe("4\n");
  savePreferences(DEFAULT_PREFERENCES);
});

test.skipIf(!Bun.which("setsid"))("agota los respaldos elegidos, continúa con uno gratis y no repite cuotas conocidas", async () => {
  db.query("DELETE FROM app_settings WHERE key='modelos_sin_cuota'").run();
  rmSync(contador, { force: true });
  savePreferences({ ...DEFAULT_PREFERENCES, quotaFallbackModels: ["opencode/respaldo"] });
  invalidarModelos();
  const cambios: string[] = [];
  try {
    const opciones = { prompt: "CUOTA-CADENA: termina la tarea", model: "opencode/prueba", cwd: raiz, onCambioModeloCuota: (_agotado: string, siguiente: string) => cambios.push(siguiente) };
    const resultado = await ejecutarAgente(opciones);
    expect(resultado.modelo).toBe("opencode/automatico");
    expect(resultado.textoFinal).toBe("Automatico completó lo pendiente.");
    expect(cambios).toEqual(["opencode/respaldo", "opencode/automatico"]);
    expect(readFileSync(contador, "utf8")).toBe("3\n");
    expect(readFileSync(sesionRecibida, "utf8")).toBe("");
    expect(readFileSync(promptRecibido, "utf8")).toContain("revisa los cambios y artefactos actuales");
    await ejecutarAgente(opciones);
    expect(readFileSync(contador, "utf8")).toBe("4\n");
    const controller = new AbortController();
    controller.abort();
    await expect(ejecutarAgente({ ...opciones, signal: controller.signal })).rejects.toThrow();
    expect(readFileSync(contador, "utf8")).toBe("4\n");
  } finally {
    savePreferences(DEFAULT_PREFERENCES);
    db.query("DELETE FROM app_settings WHERE key='modelos_sin_cuota'").run();
  }
});

for (const caso of ["CUOTA-AUTH", "CUOTA-TEMP"]) test.skipIf(!Bun.which("setsid"))(`${caso}: un respaldo no disponible no bloquea la alternativa gratuita`, async () => {
  db.query("DELETE FROM app_settings WHERE key='modelos_sin_cuota'").run();
  rmSync(contador, { force: true });
  savePreferences({ ...DEFAULT_PREFERENCES, quotaFallbackModels: ["opencode/respaldo"] });
  invalidarModelos();
  try {
    const resultado = await ejecutarAgente({ prompt: `${caso}: termina la tarea`, model: "opencode/prueba", cwd: raiz });
    expect(resultado.modelo).toBe("opencode/automatico");
    expect(readFileSync(contador, "utf8")).toBe("3\n");
  } finally {
    savePreferences(DEFAULT_PREFERENCES);
    db.query("DELETE FROM app_settings WHERE key='modelos_sin_cuota'").run();
  }
});
