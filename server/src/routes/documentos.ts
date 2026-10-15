import { Hono } from "hono";
import { db } from "../db";
import {
  TAMANO_MAX_DOCUMENTO,
  esFormato,
  generarArchivo,
  mimeDeFormato,
  nombreArchivo,
  tituloDesdeTexto,
  vistaHtml,
  type Formato,
} from "../documentos";

// Documentos del chat: se crean desde un mensaje guardado (ya redactado), nunca desde texto libre.
export const documentos = new Hono();

type FilaDocumento = {
  id: string;
  conversation_id: string;
  titulo: string;
  formato: Formato;
  bytes: number;
  created_at: string;
};

const COLUMNAS = "id, conversation_id, titulo, formato, bytes, created_at";

documentos.get("/documentos", (c) => {
  const conversacion = c.req.query("conversacion_id");
  if (!conversacion) return c.json({ error: "conversacion_requerida" }, 400);
  const filas = db
    .query<FilaDocumento, [string]>(
      `SELECT ${COLUMNAS} FROM documentos WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(conversacion);
  return c.json(filas);
});

documentos.post("/documentos", async (c) => {
  const body = await c.req
    .json<{ mensaje_id?: unknown; formato?: unknown; titulo?: unknown }>()
    .catch(() => ({}) as { mensaje_id?: unknown; formato?: unknown; titulo?: unknown });

  if (!esFormato(body.formato)) return c.json({ error: "formato_invalido" }, 400);
  if (typeof body.mensaje_id !== "string" || !body.mensaje_id) {
    return c.json({ error: "mensaje_requerido" }, 400);
  }
  const mensaje = db
    .query<{ conversation_id: string; content: string }, [string]>(
      "SELECT conversation_id, content FROM messages WHERE id = ?",
    )
    .get(body.mensaje_id);
  if (!mensaje) return c.json({ error: "mensaje_no_encontrado" }, 404);

  const titulo =
    typeof body.titulo === "string" && body.titulo.trim()
      ? body.titulo.trim().slice(0, 80)
      : tituloDesdeTexto(mensaje.content);

  let contenido: Uint8Array;
  try {
    contenido = await generarArchivo(body.formato, titulo, mensaje.content);
  } catch {
    // El detalle del fallo se queda en el servidor: el cliente solo ve un aviso genérico.
    return c.json({ error: "documento_no_generado" }, 422);
  }
  if (contenido.byteLength > TAMANO_MAX_DOCUMENTO) return c.json({ error: "documento_muy_grande" }, 413);

  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO documentos (id, conversation_id, titulo, formato, bytes, contenido) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, mensaje.conversation_id, titulo, body.formato, contenido.byteLength, contenido);

  const fila = db.query<FilaDocumento, [string]>(`SELECT ${COLUMNAS} FROM documentos WHERE id = ?`).get(id);
  return c.json(fila, 201);
});

documentos.get("/documentos/:id", (c) => {
  const fila = db
    .query<FilaDocumento, [string]>(`SELECT ${COLUMNAS} FROM documentos WHERE id = ?`)
    .get(c.req.param("id"));
  if (!fila) return c.json({ error: "documento_no_encontrado" }, 404);
  return c.json(fila);
});

// Descarga: el navegador guarda el archivo tal como se generó.
documentos.get("/documentos/:id/archivo", (c) => {
  const fila = db
    .query<FilaDocumento & { contenido: Uint8Array }, [string]>(
      `SELECT ${COLUMNAS}, contenido FROM documentos WHERE id = ?`,
    )
    .get(c.req.param("id"));
  if (!fila) return c.json({ error: "documento_no_encontrado" }, 404);
  const nombre = nombreArchivo(fila.titulo, fila.formato);
  const ascii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(fila.contenido, {
    headers: {
      "Content-Type": mimeDeFormato(fila.formato),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Content-Length": String(fila.contenido.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
});

// Vista previa: HTML que se muestra en un marco del mismo origen sin scripts ni recursos externos.
// Esta ruta no pasa por las cabeceras generales (ver index.ts) porque necesita embeberse aquí.
documentos.get("/documentos/:id/vista", async (c) => {
  const fila = db
    .query<FilaDocumento & { contenido: Uint8Array }, [string]>(
      `SELECT ${COLUMNAS}, contenido FROM documentos WHERE id = ?`,
    )
    .get(c.req.param("id"));
  if (!fila) return c.json({ error: "documento_no_encontrado" }, 404);
  let html: string;
  try {
    html = await vistaHtml(fila.formato, fila.contenido);
  } catch {
    return c.json({ error: "vista_no_disponible" }, 422);
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});

documentos.delete("/documentos/:id", (c) => {
  const res = db.query("DELETE FROM documentos WHERE id = ?").run(c.req.param("id"));
  if (res.changes === 0) return c.json({ error: "documento_no_encontrado" }, 404);
  return c.json({ ok: true });
});

