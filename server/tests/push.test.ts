import { afterAll, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(tmpdir(), "telo-pruebas-servicio", "push");
if (!process.env.TELO_PRUEBAS_PUSH) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_PUSH = "1";
}
process.env.DATA_DIR = join(raiz, "data");
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");

const { db } = await import("../src/db");
const {
  avisarPush,
  clavesVapid,
  guardarSubscripcion,
  validarSubscripcion,
} = await import("../src/push");

// Suscripción de prueba con claves ECDH reales: el cifrado del envío las usa de verdad.
function suscripcion(endpoint: string) {
  const curva = createECDH("prime256v1");
  curva.generateKeys();
  return {
    endpoint,
    p256dh: curva.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

const envios: { url: string; init: RequestInit }[] = [];
let estadoRespuesta = 201;
// Estados en cola para simular fallos transitorios que vuelven en el reintento.
const secuencia: number[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  envios.push({ url: String(url), init: init as RequestInit });
  const estado = secuencia.length > 0 ? (secuencia.shift() as number) : estadoRespuesta;
  return new Response("", { status: estado });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = fetchOriginal;
  if (claveOriginal === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = claveOriginal;
  db.close();
  rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("genera las claves VAPID una vez y solo las guarda cifradas", () => {
  const primera = clavesVapid();
  const segunda = clavesVapid();
  expect(primera?.publicKey).toBeTruthy();
  expect(segunda?.publicKey).toBe(primera!.publicKey);
  const fila = db.query<{ value: string }, []>(
    "SELECT value FROM app_settings WHERE key = 'vapid_global'",
  ).get()!;
  const guardado = JSON.parse(fila.value) as Record<string, unknown>;
  expect(typeof guardado.value_enc).toBe("string");
  expect(typeof guardado.iv).toBe("string");
  // La llave privada jamás reposa en claro en app_settings.
  expect(fila.value).not.toContain(primera!.privateKey);
});

test("valida suscripciones tal como las entrega el navegador", () => {
  const buena = suscripcion("https://fcm.googleapis.com/fcm/send/ejemplo-1");
  expect(
    validarSubscripcion({ endpoint: buena.endpoint, keys: { p256dh: buena.p256dh, auth: buena.auth } }),
  ).toEqual({ endpoint: buena.endpoint, p256dh: buena.p256dh, auth: buena.auth });
  expect(validarSubscripcion(null)).toBeNull();
  expect(
    validarSubscripcion({ endpoint: "http://inseguro.test/sin-tls", keys: { p256dh: buena.p256dh, auth: buena.auth } }),
  ).toBeNull();
  expect(
    validarSubscripcion({
      endpoint: buena.endpoint,
      keys: { p256dh: randomBytes(64).toString("base64url"), auth: buena.auth },
    }),
  ).toBeNull();
  expect(
    validarSubscripcion({
      endpoint: buena.endpoint,
      keys: { p256dh: buena.p256dh, auth: randomBytes(8).toString("base64url") },
    }),
  ).toBeNull();
  expect(
    validarSubscripcion({
      endpoint: buena.endpoint,
      keys: { p256dh: Buffer.from(buena.p256dh + "==").toString(), auth: buena.auth },
    }),
  ).toBeNull();
});

test("envía una sola vez por evento y firma el JWT VAPID contra el destino", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const sub = suscripcion("https://fcm.googleapis.com/fcm/send/cuenta-dedupe");
  guardarSubscripcion(sub);
  envios.length = 0;
  await avisarPush("t-push-1", "terminada", "La tarea terminó.");
  expect(envios.length).toBe(1);
  const cabeceras = envios[0].init.headers as Record<string, string>;
  expect(cabeceras["Content-Encoding"]).toBe("aes128gcm");
  expect(cabeceras.Authorization).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/);
  const token = cabeceras.Authorization.replace(/^vapid t=/, "").split(",")[0];
  const cargaJwt = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as {
    aud: string;
    sub: string;
  };
  expect(cargaJwt.aud).toBe(new URL(envios[0].url).origin);
  expect(cargaJwt.sub).toMatch(/^(mailto:|https?:\/\/)/);
  // El cuerpo viaja cifrado (RFC 8291): cabecera 16 salt + 4 rs + 1 idlen + 65 llave efímera.
  expect((envios[0].init.body as Uint8Array).length).toBeGreaterThan(86);
  // Dedupe: el mismo evento no repite el aviso; otro tipo sí.
  await avisarPush("t-push-1", "terminada", "La tarea terminó.");
  expect(envios.length).toBe(1);
  await avisarPush("t-push-1", "fallada", "La tarea falló.");
  expect(envios.length).toBe(2);
});

test("borra la suscripción vencida (410/404) y no vuelve a enviarla", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const vencida = suscripcion("https://push.ejemplo.test/vencida");
  guardarSubscripcion(vencida);
  envios.length = 0;
  estadoRespuesta = 410;
  await avisarPush("t-push-2", "fallada", "La tarea falló.");
  estadoRespuesta = 201;
  expect(envios.length).toBe(1);
  const fila = db
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM push_subscripciones WHERE endpoint = ?")
    .get(vencida.endpoint)!;
  expect(fila.n).toBe(0);
});

test("sin dispositivos no envía ni sella el evento", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  envios.length = 0;
  await avisarPush("t-push-3", "revisar", "La tarea espera tu aprobación.");
  expect(envios.length).toBe(0);
  const sello = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM push_enviados WHERE tarea_id = 't-push-3'")
    .get()!;
  expect(sello.n).toBe(0);
});

test("un fallo transitorio no sella el aviso y el reintento interno entrega", { timeout: 20000 }, async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/cuenta-reintento"));
  envios.length = 0;
  secuencia.length = 0;
  estadoRespuesta = 503;
  // Envío + dos reintentos: todos fallan y el evento queda libre para volver a intentarse.
  await avisarPush("t-push-4", "revisar", "La tarea espera tu aprobación.");
  expect(envios.length).toBe(3);
  const sellos = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM push_enviados WHERE tarea_id = 't-push-4'")
    .get()!;
  expect(sellos.n).toBe(0);
  // Cuando el gateway vuelve a responder 2xx, el mismo evento sale otra vez y queda sellado.
  estadoRespuesta = 201;
  secuencia.length = 0;
  await avisarPush("t-push-4", "revisar", "La tarea espera tu aprobación.");
  expect(envios.length).toBe(4);
  const selloFinal = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM push_enviados WHERE tarea_id = 't-push-4'")
    .get()!;
  expect(selloFinal.n).toBe(1);
});

test("cada versión del plan avisa una sola vez sin bloquear la siguiente", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/cuenta-versiones"));
  envios.length = 0;
  secuencia.length = 0;
  estadoRespuesta = 201;
  await avisarPush("t-push-5", "revisar", "Espera tu aprobación.", "1");
  await avisarPush("t-push-5", "revisar", "Espera tu aprobación.", "1");
  expect(envios.length).toBe(1);
  await avisarPush("t-push-5", "revisar", "Espera tu aprobación.", "2");
  expect(envios.length).toBe(2);
  const sellos = db
    .query<{ tipo: string }, []>("SELECT tipo FROM push_enviados WHERE tarea_id = 't-push-5' ORDER BY rowid")
    .all()
    .map((f) => f.tipo);
  expect(sellos).toEqual(["revisar#1", "revisar#2"]);
});
