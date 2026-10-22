import { Hono } from "hono";
import { db } from "../db";
import { publicar } from "../bus";

type TipoMedio = "imagen" | "video";

type EstadoMedio = "pendiente" | "generando" | "completada" | "error" | "cancelada";
type FilaMedio = {
  id: string;
  conversation_id: string;
  turno_id: string;
  message_id: string;
  tipo: TipoMedio;
  prompt: string;
  modelo: string;
  resolucion: string;
  relacion: string;
  duracion_segundos: number | null;
  costo_estimado_usd: number;
  estado: EstadoMedio;
  operacion: string | null;
  nombre_archivo: string | null;
  mime: string | null;
  bytes: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNAS = "id,conversation_id,turno_id,message_id,tipo,prompt,modelo,resolucion,relacion,duracion_segundos,costo_estimado_usd,estado,operacion,nombre_archivo,mime,bytes,error,created_at,updated_at";
function obtener(id: string): FilaMedio | null {
  return db.query<FilaMedio, [string]>(`SELECT ${COLUMNAS} FROM media_jobs WHERE id=?`).get(id) ?? null;
}

function publicarCambio(fila: Pick<FilaMedio, "conversation_id">) {
  publicar({ tipo: "chat", conversacion_id: fila.conversation_id, estado: "terminado" });
}

export const media = new Hono();

media.get("/media/capacidades", (c) => c.json({
  politica: "sin_generacion_multimedia_externa_facturable",
  imagen: { ruta: "modelo_seleccionado_y_herramientas_locales" },
  video: { ruta: "modelo_seleccionado_y_herramientas_locales" },
  voz: { ruta: "herramienta_local_o_servidor_mcp_configurado" },
}));

media.get("/media/:id", (c) => {
  const fila = obtener(c.req.param("id"));
  if (!fila) return c.json({ error: "medio_no_encontrado" }, 404);
  return c.json({
    id: fila.id,
    conversation_id: fila.conversation_id,
    message_id: fila.message_id,
    tipo: fila.tipo,
    prompt: fila.prompt,
    modelo: fila.modelo,
    resolucion: fila.resolucion,
    relacion: fila.relacion,
    duracion_segundos: fila.duracion_segundos,
    costo_estimado_usd: fila.costo_estimado_usd,
    estado: fila.estado,
    mime: fila.mime,
    bytes: fila.bytes,
    nombre_archivo: fila.nombre_archivo,
    error: fila.error,
    api_google_configurada: false,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  });
});

media.post("/media/:id/confirmar", (c) => {
  const fila = obtener(c.req.param("id"));
  if (!fila) return c.json({ error: "medio_no_encontrado" }, 404);
  if (fila.estado !== "pendiente") return c.json({ error: "medio_no_pendiente", estado: fila.estado }, 409);
  return c.json({ error: "generacion_multimedia_externa_deshabilitada" }, 410);
});

media.post("/media/:id/cancelar", (c) => {
  const fila = obtener(c.req.param("id"));
  if (!fila) return c.json({ error: "medio_no_encontrado" }, 404);
  if (fila.estado !== "pendiente") return c.json({ error: "medio_no_pendiente" }, 409);
  db.query("UPDATE media_jobs SET estado='cancelada',updated_at=datetime('now') WHERE id=? AND estado='pendiente'").run(fila.id);
  publicarCambio(fila);
  return c.json({ ok: true });
});

media.get("/media/:id/archivo", (c) => {
  const fila = db.query<FilaMedio & { contenido: Uint8Array }, [string]>(
    `SELECT ${COLUMNAS},contenido FROM media_jobs WHERE id=? AND estado='completada' AND contenido IS NOT NULL`,
  ).get(c.req.param("id"));
  if (!fila || !fila.mime || !fila.nombre_archivo) return c.json({ error: "medio_no_disponible" }, 404);
  const bytes = fila.contenido;
  const rango = c.req.header("range");
  const nombre = fila.nombre_archivo.replace(/[\r\n"\\]/g, "_");
  const nombreAscii = nombre.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
  const nombreUtf8 = encodeURIComponent(nombre).replace(/[!'()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = {
    "Content-Type": fila.mime,
    "Content-Disposition": `${c.req.query("descargar") === "1" ? "attachment" : "inline"}; filename="${nombreAscii}"; filename*=UTF-8''${nombreUtf8}`,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  if (!rango) return new Response(bytes, { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
  const coincide = /^bytes=(\d+)-(\d*)$/.exec(rango);
  if (!coincide) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` } });
  const inicio = Number(coincide[1]);
  const fin = coincide[2] ? Math.min(Number(coincide[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (inicio >= bytes.byteLength || fin < inicio) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` } });
  const fragmento = bytes.subarray(inicio, fin + 1);
  return new Response(fragmento, {
    status: 206,
    headers: { ...headers, "Content-Length": String(fragmento.byteLength), "Content-Range": `bytes ${inicio}-${fin}/${bytes.byteLength}` },
  });
});

// Cierra tarjetas antiguas que esperaban una generación multimedia externa de pago.
export function reanudarGeneracionesMedios(): void {
  const filas = db.query<{ conversation_id: string }, []>(
    "SELECT DISTINCT conversation_id FROM media_jobs WHERE estado IN ('pendiente','generando')",
  ).all();
  db.query(`UPDATE media_jobs SET estado='error',error='Generación externa desactivada para evitar cargos. Vuelve a pedir el archivo al agente con herramientas locales.',updated_at=datetime('now') WHERE estado IN ('pendiente','generando')`).run();
  for (const fila of filas) publicarCambio(fila);
}
