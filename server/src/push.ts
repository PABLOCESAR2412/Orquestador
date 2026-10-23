// Web Push (fase 8): avisos que van a un dispositivo sin que la app esté abierta.
//
// El navegador registra una suscripción por dispositivo (endpoint + claves cifradas del
// usuario); el servidor avisa al fallar, al pedir aprobación y al terminar. Las claves
// VAPID se autogeneran la primera vez y se guardan cifradas en app_settings con la clave
// maestra (igual que las credenciales globales de GitHub): nunca se imprimen ni salen en
// texto claro. El cifrado de la carga sigue la librería de referencia (web-push, RFC 8291).
//
// Cada transición tiene una entrega por dispositivo en una cola persistente. El éxito
// de la PC no sella el móvil; los leases permiten recuperar envíos tras un reinicio.

import * as webpush from "web-push";
import { db } from "./db";
import { cifrar, claveMaestra, descifrar, type CifradoSecreto } from "./secretos";

type ClavesVapid = { publicKey: string; privateKey: string };
export type Subscripcion = { endpoint: string; p256dh: string; auth: string };

const CLAVE_VAPID = "vapid_global";
const AAD_VAPID = "app_settings|vapid_global";
type VapidGuardado = CifradoSecreto & { version: 1 };

// Asunto del JWT VAPID (mailto: o https:); TELO_PUSH_ASUNTO lo ajusta el despliegue.
const ASUNTO = process.env.TELO_PUSH_ASUNTO?.trim() || "mailto:no-responder@telo.local";

// Claves VAPID del servidor; autogeneradas y cifradas en app_settings al primer uso.
// Devuelve null si no hay clave de cifrado: Web Push queda desactivado y la API lo dice.
export function clavesVapid(): ClavesVapid | null {
  const fila = db
    .query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key = ?")
    .get(CLAVE_VAPID);
  if (!fila) return clavesVapidNuevas();
  try {
    const guardado = JSON.parse(fila.value) as Partial<VapidGuardado>;
    if (guardado.version !== 1 || !guardado.iv || !guardado.tag || !guardado.value_enc) return null;
    const clave = claveMaestra();
    if (!clave) return null;
    return JSON.parse(descifrar(clave, guardado as VapidGuardado, AAD_VAPID)) as ClavesVapid;
  } catch {
    return null;
  }
}

function clavesVapidNuevas(): ClavesVapid | null {
  const clave = claveMaestra();
  if (!clave) return null;
  const nuevas = webpush.generateVAPIDKeys();
  const guardado: VapidGuardado = { version: 1, ...cifrar(clave, JSON.stringify(nuevas), AAD_VAPID) };
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(CLAVE_VAPID, JSON.stringify(guardado));
  return nuevas;
}

// Valida una suscripción tal como la entrega pushManager.subscribe en el navegador.
// Exportada: la prueba la usa sin pasar por la API.
export function validarSubscripcion(cuerpo: unknown): Subscripcion | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const c = cuerpo as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (
    typeof c.endpoint !== "string" ||
    !/^https:\/\//i.test(c.endpoint) ||
    c.endpoint.length > 2048
  ) {
    return null;
  }
  const p256dh = c.keys?.p256dh;
  const auth = c.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!esBase64Url(p256dh) || !esBase64Url(auth)) return null;
  if (Buffer.from(p256dh, "base64url").length !== 65) return null;
  if (Buffer.from(auth, "base64url").length < 16) return null;
  return { endpoint: c.endpoint, p256dh, auth };
}

function esBase64Url(texto: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(texto) && texto.length % 4 !== 1;
}

export function guardarSubscripcion(s: Subscripcion): void {
  db.query(
    `INSERT INTO push_subscripciones (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(s.endpoint, s.p256dh, s.auth);
}

export function quitarSubscripcion(endpoint: string): void {
  db.query("DELETE FROM push_subscripciones WHERE endpoint = ?").run(endpoint);
}

function listarSubscripciones(): Subscripcion[] {
  return db
    .query<Subscripcion, []>("SELECT endpoint, p256dh, auth FROM push_subscripciones")
    .all();
}

// Aviso desde el worker. Nunca lanza: un fallo de envío no debe tumbar la tarea que
// lo originó (solo borra la suscripción si el servicio la marcó vencida con 404/410).
export async function avisarPush(
  tareaId: string,
  tipo: "fallada" | "revisar" | "terminada",
  cuerpo: string,
  sello = "",
): Promise<void> {
  try {
    if (!clavesVapid()) return;
    // Sin dispositivos a quién avisar no se sella nada: cuando el usuario
    // suscriba un dispositivo, los avisos nuevos entran ya.
    const subscripciones = listarSubscripciones();
    if (subscripciones.length === 0) return;
    // Replanificaciones traen su sello: cada versión del plan avisa una sola vez,
    // sin bloquear el aviso de la siguiente versión con la clave de la primera.
    const transicion = sello || db.query<{ id: number }, [string, string]>(
      "SELECT id FROM task_events WHERE task_id=? AND kind=? ORDER BY id DESC LIMIT 1",
    ).get(tareaId, tipo === "revisar" ? "plan_pendiente" : "terminada")?.id;
    const clave = transicion ? `${tipo}#${transicion}` : tipo;
    const titulo = `Telo · ${tituloTarea(tareaId)}`;
    const vigencia = vigenciaTarea(tareaId, tipo);
    const carga = JSON.stringify({ titulo, cuerpo, url: `/tareas/${encodeURIComponent(tareaId)}`, etiqueta: `tarea-${tareaId}`, evento: `${tareaId}:${clave}`, vigencia });
    // Los sellos antiguos no se reproducen al migrar. Un evento con outbox ya existente
    // conserva los dispositivos a los que iba destinado, sin añadir suscripciones futuras.
    db.transaction(() => {
      if (db.query("SELECT 1 FROM push_enviados WHERE tarea_id=? AND tipo=?").get(tareaId, clave)) return;
      if (db.query("SELECT 1 FROM push_entregas WHERE tarea_id=? AND tipo=?").get(tareaId, clave)) return;
      for (const s of subscripciones) db.query(
        "INSERT OR IGNORE INTO push_entregas(tarea_id,tipo,endpoint,carga,creado_ms) VALUES (?,?,?,?,?)",
      ).run(tareaId, clave, s.endpoint, carga, Date.now());
    })();
    for (let intento = 0; intento < 3; intento++) {
      if (intento > 0) await Bun.sleep(RETRASO_REINTENTO_MS[intento - 1]!);
      await procesarColaPush({ tareaId, tipo: clave, forzar: true });
      if (!db.query("SELECT 1 FROM push_entregas WHERE tarea_id=? AND tipo=? AND estado='pendiente'").get(tareaId, clave)) break;
    }
  } catch {
    console.error("No se pudo registrar la notificación para su reintento.");
  }
}

type EntregaPush = Subscripcion & { tarea_id: string; tipo: string; carga: string; intentos: number };
type VigenciaPush = { estado: string; planHash: string | null; eventoId: number | null };

function vigenciaTarea(tareaId: string, tipo: string): VigenciaPush | null {
  const fila = db.query<{ status: string; plan_hash: string | null }, [string]>("SELECT status,plan_hash FROM tasks WHERE id=?").get(tareaId);
  if (!fila) return null;
  const kind = tipo.startsWith("revisar") ? "plan_creado" : "terminada";
  const evento = db.query<{ id: number }, [string, string]>("SELECT id FROM task_events WHERE task_id=? AND kind=? ORDER BY id DESC LIMIT 1").get(tareaId, kind);
  return { estado: fila.status, planHash: tipo.startsWith("revisar") ? fila.plan_hash : null, eventoId: evento?.id ?? null };
}

function entregaVigente(e: EntregaPush): boolean {
  try {
    const anterior = JSON.parse(e.carga).vigencia as VigenciaPush | null | undefined;
    // Compatibilidad con cargas ya persistidas sin fotografía de la transición.
    if (!anterior) return true;
    const actual = vigenciaTarea(e.tarea_id, e.tipo);
    return actual !== null && actual.estado === anterior.estado && actual.planHash === anterior.planHash && actual.eventoId === anterior.eventoId;
  } catch { return false; }
}
const CONCURRENCIA_PUSH = 4;
const DURACION_LEASE_MS = 60_000;
let procesando = false;

// El claim se confirma en SQLite antes del await. Un segundo dispatcher no puede tomar
// la misma entrega y un proceso muerto libera su lease automáticamente al vencer.
export async function procesarColaPush(filtro?: { tareaId: string; tipo: string; forzar?: boolean }): Promise<void> {
  if (procesando) return;
  procesando = true;
  try {
    const claves = clavesVapid();
    if (!claves) return;
    const ahora = Date.now();
    db.query("DELETE FROM push_entregas WHERE creado_ms < ?").run(ahora - 30 * 86_400_000);
    const opciones: ClavesEnvio = {
      vapidDetails: { subject: ASUNTO, publicKey: claves.publicKey, privateKey: claves.privateKey },
      TTL: 3600, urgency: "normal",
    };
    const entregas = db.transaction(() => {
      db.query("UPDATE push_entregas SET estado='pendiente' WHERE estado='enviando' AND bloqueo_hasta_ms<=?").run(ahora);
      const filas = db.query<EntregaPush, [number, string | null, string | null, string | null]>(`
        SELECT e.*,s.p256dh,s.auth FROM push_entregas e JOIN push_subscripciones s USING(endpoint)
        WHERE e.estado='pendiente' AND e.siguiente_ms<=? AND (? IS NULL OR (e.tarea_id=? AND e.tipo=?))
        ORDER BY e.creado_ms LIMIT 16
      `).all(filtro?.forzar ? Number.MAX_SAFE_INTEGER : ahora, filtro?.tareaId ?? null, filtro?.tareaId ?? null, filtro?.tipo ?? null);
      for (const e of filas) db.query(`UPDATE push_entregas SET estado='enviando',bloqueo_hasta_ms=?,intentos=intentos+1
        WHERE tarea_id=? AND tipo=? AND endpoint=?`).run(ahora + DURACION_LEASE_MS, e.tarea_id, e.tipo, e.endpoint);
      return filas;
    })();
    for (let inicio = 0; inicio < entregas.length; inicio += CONCURRENCIA_PUSH) {
      await Promise.all(entregas.slice(inicio, inicio + CONCURRENCIA_PUSH).map(async (e) => {
        if (!entregaVigente(e)) {
          // Se conserva el registro para que un aviso resuelto no se vuelva a encolar.
          db.query("UPDATE push_entregas SET estado='descartada',bloqueo_hasta_ms=0 WHERE tarea_id=? AND tipo=? AND endpoint=?")
            .run(e.tarea_id, e.tipo, e.endpoint);
          return;
        }
        const resultado = await enviar(opciones, e, e.carga);
        const retraso = RETRASO_REINTENTO_MS[e.intentos] ?? Math.min(300_000, 30_000 * 2 ** Math.min(e.intentos - 2, 4));
        db.query(`UPDATE push_entregas SET estado=?,siguiente_ms=?,bloqueo_hasta_ms=0
          WHERE tarea_id=? AND tipo=? AND endpoint=?`).run(resultado === "entregado" ? "entregada" : "pendiente", Date.now() + retraso, e.tarea_id, e.tipo, e.endpoint);
        if (resultado === "entregado" && !db.query("SELECT 1 FROM push_entregas WHERE tarea_id=? AND tipo=? AND estado!='entregada'").get(e.tarea_id, e.tipo)) {
          db.query("INSERT OR IGNORE INTO push_enviados(tarea_id,tipo) VALUES (?,?)").run(e.tarea_id, e.tipo);
        }
      }));
    }
  } finally { procesando = false; }
}

let relojCola: ReturnType<typeof setInterval> | null = null;
export function iniciarColaPush(): void {
  if (relojCola) return;
  const ejecutar = () => { void procesarColaPush().catch(() => console.error("No se pudo procesar la cola de notificaciones.")); };
  relojCola = setInterval(ejecutar, 15_000);
  relojCola.unref();
  ejecutar();
}

type ClavesEnvio = {
  vapidDetails: { subject: string; publicKey: string; privateKey: string };
  TTL: number;
  urgency: "normal";
};

const TIEMPO_ENVIO_MS = 10_000;
const RETRASO_REINTENTO_MS = [1_500, 4_000] as const;

// Envía a una suscripción con tope de tiempo propio y clasifica el resultado: un endpoint caído
// no retiene al resto, que viajan en paralelo (antes iban en serie sin tiempo límite).
async function enviar(
  clavesEnvio: ClavesEnvio,
  s: Subscripcion,
  carga: string,
): Promise<"entregado" | "inactiva" | "fallo"> {
  try {
    const detalle = webpush.generateRequestDetails(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      carga,
      clavesEnvio,
    );
    const cabeceras: Record<string, string> = {};
    for (const [llave, valor] of Object.entries(detalle.headers)) {
      if (valor !== undefined) cabeceras[llave] = String(valor);
    }
    const res = await fetch(detalle.endpoint, {
      method: "POST",
      headers: cabeceras,
      body: detalle.body ? Buffer.from(detalle.body) : undefined,
      signal: AbortSignal.timeout(TIEMPO_ENVIO_MS),
    });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) {
      db.query("DELETE FROM push_subscripciones WHERE endpoint = ?").run(s.endpoint);
      return "inactiva";
    }
    if (res.ok) return "entregado";
    return "fallo";
  } catch {
    // Endpoint caído o red intermitente: el lote decide si reintenta.
    return "fallo";
  }
}

function tituloTarea(tareaId: string): string {
  return (
    db.query<{ title: string }, [string]>("SELECT title FROM tasks WHERE id = ?").get(tareaId)
      ?.title ?? "tarea"
  );
}
