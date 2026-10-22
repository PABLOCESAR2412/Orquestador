// Web Push (fase 8): avisos que van a un dispositivo sin que la app esté abierta.
//
// El navegador registra una suscripción por dispositivo (endpoint + claves cifradas del
// usuario); el servidor avisa al fallar, al pedir aprobación y al terminar. Las claves
// VAPID se autogeneran la primera vez y se guardan cifradas en app_settings con la clave
// maestra (igual que las credenciales globales de GitHub): nunca se imprimen ni salen en
// texto claro. El cifrado de la carga sigue la librería de referencia (web-push, RFC 8291).
//
// Un mismo evento de una tarea notifica una sola vez: el sello (tarea, tipo) vive en
// push_enviados y el INSERT OR IGNORE hace de dedupe, incluso entre reinicios del servidor.

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
): Promise<void> {
  try {
    const claves = clavesVapid();
    if (!claves) return;
    // Sin dispositivos a quién avisar no se sella el evento: cuando el usuario
    // suscriba un dispositivo, los avisos nuevos entran ya.
    const subscripciones = listarSubscripciones();
    if (subscripciones.length === 0) return;
    const nuevo = db
      .query("INSERT OR IGNORE INTO push_enviados (tarea_id, tipo) VALUES (?, ?)")
      .run(tareaId, tipo);
    if (nuevo.changes !== 1) return; // ya se avisó de este evento
    const titulo = `Telo · ${tituloTarea(tareaId)}`;
    const carga = JSON.stringify({ titulo, cuerpo, url: "/tasks" });
    for (const s of subscripciones) {
      try {
        const detalle = webpush.generateRequestDetails(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
          {
            vapidDetails: {
              subject: ASUNTO,
              publicKey: claves.publicKey,
              privateKey: claves.privateKey,
            },
            TTL: 3600,
            urgency: "normal",
          },
        );
        const cabeceras: Record<string, string> = {};
        for (const [llave, valor] of Object.entries(detalle.headers)) {
          if (valor !== undefined) cabeceras[llave] = String(valor);
        }
        const res = await fetch(detalle.endpoint, {
          method: "POST",
          headers: cabeceras,
          body: detalle.body ? Buffer.from(detalle.body) : undefined,
        });
        if (res.status === 404 || res.status === 410) {
          db.query("DELETE FROM push_subscripciones WHERE endpoint = ?").run(s.endpoint);
        }
      } catch {
        // Endpoint caído o red intermitente: la suscripción queda para el próximo aviso.
      }
    }
  } catch {
    // La notificación nunca debe romper el flujo de la tarea.
  }
}

function tituloTarea(tareaId: string): string {
  return (
    db.query<{ title: string }, [string]>("SELECT title FROM tasks WHERE id = ?").get(tareaId)
      ?.title ?? "tarea"
  );
}
