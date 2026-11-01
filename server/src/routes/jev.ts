import { Hono } from "hono";
import { borrarClaveProveedor, claveJevActualizadaEn, claveProveedorValida, guardarClaveProveedor, valorClaveJev } from "../claves-proveedor";
import { db } from "../db";
import { ErrorJev, evaluarConJev, ordenarSugerenciasJev, probarClaveJev } from "../jev";
import { secretosDisponibles } from "../secretos";
import { leerCuerpoJson } from "./projects";

export const jevRoute = new Hono();

let oficinaOcupada = false;
jevRoute.get("/jev/oficina", (c) => c.json(db.query(`SELECT COUNT(*) AS llamadas,
  SUM(estado = 'completada') AS completadas, SUM(tokens_entrada) AS entrada,
  SUM(tokens_salida) AS salida, SUM(estado = 'completada' AND (tokens_entrada IS NULL OR tokens_salida IS NULL)) AS sin_datos
  FROM uso_jev_oficina`).get()));

jevRoute.post("/jev/oficina", async (c) => {
  if (!valorClaveJev()) return c.json({ error: "jev_sin_clave" }, 409);
  if (oficinaOcupada) return c.json({ error: "jev_oficina_ocupada" }, 429);
  const recent = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM uso_jev_oficina WHERE created_at >= datetime('now', '-1 minute')").get();
  if ((recent?.n ?? 0) > 0) return c.json({ error: "jev_oficina_limite" }, 429);
  oficinaOcupada = true;
  const id = Number(db.query("INSERT INTO uso_jev_oficina DEFAULT VALUES").run().lastInsertRowid);
  try {
    const resultado = await evaluarConJev({ tipo: "oficina", oficinaUsoId: id,
      estado: { lugar: "oficina compartida", actividad: "descanso" },
      preguntas: { actividad: { type: "choice", instructions: "Elige una actividad breve y cotidiana para una animación decorativa de oficina.", criteria: { cafe: "Ir por café", ventana: "Mirar por la ventana", charla: "Conversar junto a la mesa" } } },
    });
    const a = resultado?.answers.actividad;
    if (!a || typeof a !== "object" || !("choice" in a) || !["cafe", "ventana", "charla"].includes(String(a.choice))) return c.json({ error: "jev_respuesta_invalida" }, 502);
    return c.json({ actividad: a.choice });
  } catch {
    db.query("UPDATE uso_jev_oficina SET estado = 'fallida' WHERE id = ? AND estado = 'iniciada'").run(id);
    return c.json({ error: "jev_error" }, 502);
  } finally {
    db.query("UPDATE uso_jev_oficina SET estado = 'fallida' WHERE id = ? AND estado = 'iniciada'").run(id);
    oficinaOcupada = false;
  }
});

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

