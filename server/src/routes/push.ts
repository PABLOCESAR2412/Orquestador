import { Hono } from "hono";
import {
  clavesVapid,
  guardarSubscripcion,
  quitarSubscripcion,
  validarSubscripcion,
} from "../push";

// API de Web Push: la clave pública VAPID que el navegador usa para suscribirse y
// el registro de suscripciones por dispositivo (la app envía su pushManager.subscribe).
export const push = new Hono();

// GET /api/push/clave → { clave }. 503 si no hay clave de cifrado configurada.
push.get("/push/clave", (c) => {
  const claves = clavesVapid();
  if (!claves) return c.json({ error: "clave_sin_cifrado" }, 503);
  return c.json({ clave: claves.publicKey });
});

// POST /api/push/suscripciones body: { endpoint, keys: { p256dh, auth } }
push.post("/push/suscripciones", async (c) => {
  const sub = validarSubscripcion(await c.req.json().catch(() => null));
  if (!sub) return c.json({ error: "suscripcion_invalida" }, 400);
  if (!guardarSubscripcion(sub)) return c.json({ error: "limite_suscripciones" }, 429);
  return c.json({ ok: true });
});

// DELETE /api/push/suscripciones body: { endpoint }
push.delete("/push/suscripciones", async (c) => {
  const cuerpo = await c.req
    .json<{ endpoint?: string }>()
    .catch(() => ({}) as { endpoint?: string });
  if (typeof cuerpo.endpoint !== "string" || !cuerpo.endpoint) {
    return c.json({ error: "suscripcion_invalida" }, 400);
  }
  quitarSubscripcion(cuerpo.endpoint);
  return c.json({ ok: true });
});
