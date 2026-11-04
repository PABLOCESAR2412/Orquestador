import { Hono } from "hono";
import { borrarClaveProveedor, claveJevActualizadaEn, claveProveedorValida, guardarClaveProveedor, valorClaveJev } from "../claves-proveedor";
import { db } from "../db";
import { ErrorJev, ordenarSugerenciasJev, probarClaveJev } from "../jev";
import { secretosDisponibles } from "../secretos";
import { leerCuerpoJson } from "./projects";

export const jevRoute = new Hono();

jevRoute.get("/jev", (c) => c.json({
  disponible: secretosDisponibles(),
  configurada: claveJevActualizadaEn() !== null,
  actualizada_en: claveJevActualizadaEn(),
}));

jevRoute.put("/jev", async (c) => {
  const body = await leerCuerpoJson<{ valor?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  if (!claveProveedorValida(body.valor)) return c.json({ error: "clave_proveedor_invalida" }, 400);
  const actualizada = guardarClaveProveedor("jev", body.valor);
  if (!actualizada) return c.json({ error: "secretos_no_configurados" }, 503);
  return c.json({ configurada: true, actualizada_en: actualizada });
});

jevRoute.delete("/jev", (c) => {
  if (!borrarClaveProveedor("jev")) return c.json({ error: "jev_sin_clave" }, 404);
  return c.json({ ok: true });
});

jevRoute.post("/jev/probar", async (c) => {
  if (!valorClaveJev()) return c.json({ error: "jev_sin_clave" }, 409);
  try {
    const ok = await probarClaveJev();
    return ok ? c.json({ ok: true }) : c.json({ error: "jev_respuesta_invalida" }, 502);
  } catch (error) {
    return c.json({ error: error instanceof ErrorJev ? error.codigo : "jev_error" }, 502);
  }
});

jevRoute.post("/jev/recomendaciones", async (c) => {
  const body = await leerCuerpoJson<{ conversacionId?: unknown; candidatas?: unknown }>(c);
  if (typeof body?.conversacionId !== "string" || !Array.isArray(body.candidatas) ||
      body.candidatas.length < 1 || body.candidatas.length > 5 ||
      body.candidatas.some((texto) => typeof texto !== "string" || !texto.trim() || texto.length > 500)) {
    return c.json({ error: "jev_recomendaciones_invalidas" }, 400);
  }

  const conversacion = db.query<{ project_id: string | null }, [string]>(
    "SELECT project_id FROM conversations WHERE id = ?",
  ).get(body.conversacionId);
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  const mensajes = db.query<{ role: "user" | "assistant"; content: string }, [string]>(
    `SELECT role, content FROM messages
     WHERE conversation_id = ? AND role IN ('user', 'assistant')
     ORDER BY created_at DESC, rowid DESC LIMIT 6`,
  ).all(body.conversacionId).reverse().map((mensaje) => ({
    role: mensaje.role,
    content: mensaje.content.slice(0, 2_500),
  }));
  const candidatas = body.candidatas as string[];
  try {
    const recomendaciones = await ordenarSugerenciasJev({
      conversacionId: body.conversacionId,
      proyectoId: conversacion.project_id,
      mensajes,
      candidatas,
    });
    return c.json({ recomendaciones: recomendaciones ?? candidatas, ordenadas_con_jev: recomendaciones !== null });
  } catch {
    // Una caída de Jev no bloquea el chat: se conserva el orden local de sugerencias.
    return c.json({ recomendaciones: candidatas, ordenadas_con_jev: false });
  }
});

