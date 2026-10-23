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
  procesarColaPush,
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
let responder: ((url: string) => number | Promise<number>) | null = null;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  envios.push({ url: String(url), init: init as RequestInit });
  const estado = responder ? await responder(String(url)) : secuencia.length > 0 ? (secuencia.shift() as number) : estadoRespuesta;
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
  for (const endpoint of [
    "https://127.0.0.1/privado",
    "https://localhost/privado",
    "https://fcm.googleapis.com.evil.test/push",
    "https://fcm.googleapis.com:8443/push",
    "https://usuario@fcm.googleapis.com/push",
  ]) {
    expect(validarSubscripcion({ endpoint, keys: { p256dh: buena.p256dh, auth: buena.auth } })).toBeNull();
  }
  expect(validarSubscripcion({
    endpoint: "https://worker.push.services.mozilla.com/wpush/v2/id",
    keys: { p256dh: buena.p256dh, auth: buena.auth },
  })?.endpoint).toBe("https://worker.push.services.mozilla.com/wpush/v2/id");
  expect(validarSubscripcion({
    endpoint: "https://web.push.apple.com/device/token",
    keys: { p256dh: buena.p256dh, auth: buena.auth },
  })?.endpoint).toBe("https://web.push.apple.com/device/token");
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

test("limita el número de dispositivos sin impedir renovar una suscripción existente", () => {
  db.query("DELETE FROM push_subscripciones").run();
  const subs = Array.from({ length: 21 }, (_, i) => suscripcion(`https://fcm.googleapis.com/fcm/send/dispositivo-${i}`));
  for (const sub of subs.slice(0, 20)) expect(guardarSubscripcion(sub)).toBe(true);
  expect(guardarSubscripcion(subs[20]!)).toBe(false);
  expect(guardarSubscripcion({ ...subs[0]!, auth: randomBytes(16).toString("base64url") })).toBe(true);
  expect(db.query("SELECT COUNT(*) AS n FROM push_subscripciones").get()).toEqual({ n: 20 });
});

test("elimina endpoints no confiables que ya existían en la base", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const sub = suscripcion("https://127.0.0.1/servicio-interno");
  db.query("INSERT INTO push_subscripciones(endpoint,p256dh,auth) VALUES(?,?,?)").run(sub.endpoint, sub.p256dh, sub.auth);
  envios.length = 0;
  await avisarPush("t-push-endpoint-antiguo", "fallada", "La tarea falló.");
  expect(envios).toHaveLength(0);
  expect(db.query("SELECT 1 FROM push_subscripciones WHERE endpoint=?").get(sub.endpoint)).toBeNull();
  expect(db.query("SELECT 1 FROM push_entregas WHERE tarea_id='t-push-endpoint-antiguo'").get()).toBeNull();
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
  const vencida = suscripcion("https://fcm.googleapis.com/fcm/send/vencida");
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
  expect(db.query("SELECT 1 FROM push_entregas WHERE tarea_id='t-push-2'").get()).toBeNull();
});

test("no sigue redirecciones del servicio Push y descarta la suscripción", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const sub = suscripcion("https://fcm.googleapis.com/fcm/send/redirige");
  guardarSubscripcion(sub);
  envios.length = 0;
  responder = () => 307;
  try {
    await avisarPush("t-push-redireccion", "fallada", "La tarea falló.");
    expect(envios).toHaveLength(1);
    expect(envios[0].init.redirect).toBe("manual");
    expect(db.query("SELECT 1 FROM push_subscripciones WHERE endpoint=?").get(sub.endpoint)).toBeNull();
    expect(db.query("SELECT 1 FROM push_entregas WHERE tarea_id='t-push-redireccion'").get()).toBeNull();
  } finally { responder = null; }
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

test("la PC entregada no silencia el móvil y la cola persistente recupera solo el pendiente", { timeout: 20000 }, async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const pc = suscripcion("https://fcm.googleapis.com/fcm/send/pc");
  const movil = suscripcion("https://fcm.googleapis.com/fcm/send/movil");
  guardarSubscripcion(pc); guardarSubscripcion(movil);
  envios.length = 0;
  responder = (url) => url.endsWith("/movil") ? 503 : 201;
  try {
    await avisarPush("t-push-multi", "fallada", "Fallo recuperable");
    expect(envios.filter((e) => e.url === pc.endpoint)).toHaveLength(1);
    expect(envios.filter((e) => e.url === movil.endpoint)).toHaveLength(3);
    expect(db.query("SELECT 1 FROM push_enviados WHERE tarea_id='t-push-multi'").get()).toBeNull();
    // Equivale a otro ciclo tras un reinicio: no se vuelve a llamar avisarPush.
    db.query("UPDATE push_entregas SET siguiente_ms=0 WHERE tarea_id='t-push-multi'").run();
    responder = () => 201;
    await procesarColaPush();
    expect(envios.filter((e) => e.url === pc.endpoint)).toHaveLength(1);
    expect(envios.filter((e) => e.url === movil.endpoint)).toHaveLength(4);
    expect(db.query("SELECT COUNT(*) AS n FROM push_entregas WHERE tarea_id='t-push-multi' AND estado='entregada'").get()).toEqual({ n: 2 });
  } finally { responder = null; }
});

test("reanudación y segundo fallo de una misma tarea son dos transiciones notificables", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/transiciones"));
  db.query("INSERT INTO tasks(id,title,prompt,model,status) VALUES ('t-push-reanudada','Prueba','Prueba','prueba','failed')").run();
  const evento = () => db.query("INSERT INTO task_events(task_id,kind,detail) VALUES ('t-push-reanudada','terminada','failed')").run();
  envios.length = 0;
  evento();
  await avisarPush("t-push-reanudada", "fallada", "Falló");
  await avisarPush("t-push-reanudada", "fallada", "Falló");
  expect(envios).toHaveLength(1);
  evento();
  await avisarPush("t-push-reanudada", "fallada", "Volvió a fallar");
  expect(envios).toHaveLength(2);
  const cargas = db.query<{ carga: string }, []>("SELECT carga FROM push_entregas WHERE tarea_id='t-push-reanudada'").all().map((f) => JSON.parse(f.carga));
  expect(cargas[0].url).toBe("/tareas/t-push-reanudada");
  expect(cargas[0].evento).not.toBe(cargas[1].evento);
});

test("un lote limita la concurrencia y dos despachadores no repiten entregas", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  for (let i = 0; i < 9; i++) guardarSubscripcion(suscripcion(`https://fcm.googleapis.com/fcm/send/paralelo-${i}`));
  let activas = 0; let maximo = 0;
  responder = async () => { activas++; maximo = Math.max(maximo, activas); await Bun.sleep(5); activas--; return 201; };
  envios.length = 0;
  try {
    await Promise.all([avisarPush("t-push-carrera", "terminada", "Terminó"), avisarPush("t-push-carrera", "terminada", "Terminó")]);
    expect(maximo).toBeLessThanOrEqual(4);
    expect(envios).toHaveLength(9);
    expect(new Set(envios.map((e) => e.url)).size).toBe(9);
  } finally { responder = null; }
});

test("recupera leases vencidos sin repetir las entregas confirmadas", async () => {
  db.query("DELETE FROM push_subscripciones").run();
  const sub = suscripcion("https://fcm.googleapis.com/fcm/send/lease-vencido");
  guardarSubscripcion(sub);
  db.query("INSERT INTO push_entregas(tarea_id,tipo,endpoint,carga,estado,bloqueo_hasta_ms,creado_ms) VALUES ('t-push-lease','fallada',?,'{}','enviando',1,?)").run(sub.endpoint, Date.now());
  envios.length = 0;
  await procesarColaPush(); await procesarColaPush();
  expect(envios).toHaveLength(1);
  expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-push-lease'").get()).toEqual({ estado: "entregada" });
});

test("aprobar un plan retira el aviso pendiente del móvil y conserva la entrega de la PC", { timeout: 10000 }, async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/plan-pc"));
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/plan-movil"));
  db.query("INSERT INTO tasks(id,title,prompt,model,status,plan_hash) VALUES ('t-plan-aprobado','Prueba','Prueba','prueba','waiting_approval','hash-1')").run();
  db.query("INSERT INTO task_events(task_id,kind) VALUES ('t-plan-aprobado','plan_creado')").run();
  envios.length = 0;
  responder = (url) => {
    if (url.endsWith("/plan-pc")) return 201;
    db.query("UPDATE tasks SET status='running',approved_hash=plan_hash WHERE id='t-plan-aprobado'").run();
    return 503;
  };
  try {
    await avisarPush("t-plan-aprobado", "revisar", "Revisa el plan", "1");
    await avisarPush("t-plan-aprobado", "revisar", "Revisa el plan", "1");
    await procesarColaPush();
    expect(envios.filter((e) => e.url.endsWith("/plan-pc"))).toHaveLength(1);
    expect(envios.filter((e) => e.url.endsWith("/plan-movil"))).toHaveLength(1);
    expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-plan-aprobado' ORDER BY endpoint").all())
      .toEqual([{ estado: "descartada" }, { estado: "entregada" }]);
  } finally { responder = null; }
});

test("replanificar invalida el aviso anterior incluso si el hash y estado no cambian", { timeout: 10000 }, async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/replanificada"));
  db.query("INSERT INTO tasks(id,title,prompt,model,status,plan_hash) VALUES ('t-plan-renovado','Prueba','Prueba','prueba','waiting_approval','mismo-hash')").run();
  db.query("INSERT INTO task_events(task_id,kind) VALUES ('t-plan-renovado','plan_creado')").run();
  envios.length = 0;
  responder = () => { db.query("INSERT INTO task_events(task_id,kind) VALUES ('t-plan-renovado','plan_creado')").run(); return 503; };
  try {
    await avisarPush("t-plan-renovado", "revisar", "Revisa versión uno", "1");
    expect(envios).toHaveLength(1);
    expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-plan-renovado' AND tipo='revisar#1'").get()).toEqual({ estado: "descartada" });
    responder = () => 201;
    await avisarPush("t-plan-renovado", "revisar", "Revisa versión dos", "2");
    expect(envios).toHaveLength(2);
    expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-plan-renovado' AND tipo='revisar#2'").get()).toEqual({ estado: "entregada" });
  } finally { responder = null; }
});

test("reanudar un fallo cancela su aviso pendiente y un fallo posterior sigue notificando", { timeout: 10000 }, async () => {
  db.query("DELETE FROM push_subscripciones").run();
  guardarSubscripcion(suscripcion("https://fcm.googleapis.com/fcm/send/fallo-reanudado"));
  db.query("INSERT INTO tasks(id,title,prompt,model,status) VALUES ('t-fallo-viejo','Prueba','Prueba','prueba','failed')").run();
  db.query("INSERT INTO task_events(task_id,kind) VALUES ('t-fallo-viejo','terminada')").run();
  envios.length = 0;
  responder = () => { db.query("UPDATE tasks SET status='running' WHERE id='t-fallo-viejo'").run(); return 503; };
  try {
    await avisarPush("t-fallo-viejo", "fallada", "Primer fallo");
    expect(envios).toHaveLength(1);
    expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-fallo-viejo'").get()).toEqual({ estado: "descartada" });
    db.query("UPDATE tasks SET status='failed' WHERE id='t-fallo-viejo'").run();
    db.query("INSERT INTO task_events(task_id,kind) VALUES ('t-fallo-viejo','terminada')").run();
    responder = () => 201;
    await avisarPush("t-fallo-viejo", "fallada", "Segundo fallo");
    expect(envios).toHaveLength(2);
    expect(db.query("SELECT estado FROM push_entregas WHERE tarea_id='t-fallo-viejo' ORDER BY rowid").all())
      .toEqual([{ estado: "descartada" }, { estado: "entregada" }]);
  } finally { responder = null; }
});
