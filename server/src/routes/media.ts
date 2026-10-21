import { Hono } from "hono";
import { db } from "../db";
import { publicar } from "../bus";
import { valorClaveApiProveedor } from "../claves-proveedor";
import {
  detectarSolicitudMedio,
  errorSeguroDeMedio,
  esperarVideo,
  generarImagen,
  iniciarVideo,
  nombreDeMedio,
  type SolicitudMedio,
  type TipoMedio,
} from "../generacion-medios";

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
const MAX_JOBS_ACTIVOS = 2;
const activos = new Set<string>();

function obtener(id: string): FilaMedio | null {
  return db.query<FilaMedio, [string]>(`SELECT ${COLUMNAS} FROM media_jobs WHERE id=?`).get(id) ?? null;
}

function clavePublica(): boolean {
  return valorClaveApiProveedor("google") !== null;
}

export function crearSolicitudMedio(conversationId: string, turnoId: string, solicitud: SolicitudMedio) {
  const id = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const nombreModelo = solicitud.tipo === "imagen" ? "Google · Nano Banana 2.1" : `Google · ${solicitud.modelo}`;
  const marcador = `[[telo-media:${id}]]`;
  db.transaction(() => {
    db.query("INSERT INTO messages (id,conversation_id,role,content,model) VALUES (?,?,'assistant',?,?)")
      .run(messageId, conversationId, marcador, nombreModelo);
    db.query(
      `INSERT INTO media_jobs (id,conversation_id,turno_id,message_id,tipo,prompt,modelo,resolucion,relacion,duracion_segundos,costo_estimado_usd,estado,nombre_archivo)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pendiente',?)`,
    ).run(
      id,
      conversationId,
      turnoId,
      messageId,
      solicitud.tipo,
      solicitud.prompt,
      solicitud.modelo,
      solicitud.resolucion,
      solicitud.relacion,
      solicitud.duracionSegundos,
      solicitud.costoEstimadoUsd,
      nombreDeMedio(solicitud.prompt, solicitud.tipo),
    );
  })();
  publicar({ tipo: "chat", conversacion_id: conversationId, estado: "terminado" });
  return { id, messageId, marker: marcador };
}

function tareaComoSolicitud(fila: FilaMedio): SolicitudMedio {
  return {
    tipo: fila.tipo,
    prompt: fila.prompt,
    modelo: fila.modelo,
    resolucion: fila.resolucion as SolicitudMedio["resolucion"],
    relacion: fila.relacion as SolicitudMedio["relacion"],
    duracionSegundos: fila.duracion_segundos,
    costoEstimadoUsd: fila.costo_estimado_usd,
  };
}

function publicarCambio(fila: Pick<FilaMedio, "conversation_id">) {
  publicar({ tipo: "chat", conversacion_id: fila.conversation_id, estado: "terminado" });
}

function establecerError(id: string, error: string) {
  const previa = obtener(id);
  db.query("UPDATE media_jobs SET estado='error',error=?,updated_at=datetime('now') WHERE id=? AND estado='generando'").run(error, id);
  if (previa) publicarCambio(previa);
}

async function procesar(id: string): Promise<void> {
  if (activos.has(id)) return;
  const inicial = obtener(id);
  if (!inicial || inicial.estado !== "generando") return;
  if (activos.size >= MAX_JOBS_ACTIVOS) {
    establecerError(id, "Telo ya tiene dos generaciones en curso. Vuelve a preparar esta solicitud cuando terminen.");
    return;
  }
  activos.add(id);
  try {
    const apiKey = valorClaveApiProveedor("google");
    if (!apiKey) throw new Error("google_http_401");
    const solicitud = tareaComoSolicitud(inicial);
    if (solicitud.tipo === "imagen") {
      const salida = await generarImagen(solicitud, apiKey);
      db.query(
        "UPDATE media_jobs SET estado='completada',mime=?,bytes=?,contenido=?,nombre_archivo=?,error=NULL,updated_at=datetime('now') WHERE id=? AND estado='generando'",
      ).run(salida.mime, salida.contenido.byteLength, salida.contenido, nombreDeMedio(inicial.prompt, "imagen", salida.mime), id);
    } else {
      let operacion = inicial.operacion;
      if (!operacion) {
        operacion = await iniciarVideo(solicitud, apiKey);
        db.query("UPDATE media_jobs SET operacion=?,updated_at=datetime('now') WHERE id=? AND estado='generando'").run(operacion, id);
      }
      const contenido = await esperarVideo(operacion, apiKey);
      db.query(
        "UPDATE media_jobs SET estado='completada',mime='video/mp4',bytes=?,contenido=?,error=NULL,updated_at=datetime('now') WHERE id=? AND estado='generando'",
      ).run(contenido.byteLength, contenido, id);
    }
    const fila = obtener(id);
    if (fila) publicarCambio(fila);
  } catch (err) {
    establecerError(id, errorSeguroDeMedio(err));
  } finally {
    activos.delete(id);
  }
}

export const media = new Hono();

media.get("/media/capacidades", (c) => c.json({
  apiGoogleConfigurada: clavePublica(),
  imagen: { modelo: "gemini-nano-banana-2.1", gratis: false, resoluciones: ["1K", "2K", "4K"] },
  video: {
    modeloEconomico: "veo-3.1-lite-generate-preview",
    modelo4k: "veo-3.1-fast-generate-preview",
    gratis: false,
    resoluciones: ["720p", "1080p", "4k"],
    duracionesSegundos: [4, 6, 8],
  },
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
    api_google_configurada: clavePublica(),
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  });
});

media.post("/media/:id/confirmar", async (c) => {
  const fila = obtener(c.req.param("id"));
  if (!fila) return c.json({ error: "medio_no_encontrado" }, 404);
  if (fila.estado !== "pendiente") return c.json({ error: "medio_no_pendiente", estado: fila.estado }, 409);
  if (!clavePublica()) return c.json({ error: "google_api_key_required" }, 409);
  if (activos.size >= MAX_JOBS_ACTIVOS) return c.json({ error: "media_capacity_reached" }, 429);
  const cambio = db.query("UPDATE media_jobs SET estado='generando',error=NULL,updated_at=datetime('now') WHERE id=? AND estado='pendiente'").run(fila.id);
  if (cambio.changes !== 1) return c.json({ error: "medio_no_pendiente" }, 409);
  const actual = obtener(fila.id)!;
  publicarCambio(actual);
  void procesar(fila.id);
  return c.json({ ...actual, api_google_configurada: true }, 202);
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

// Un video que ya tiene operación puede continuar tras reiniciar el servidor. Una imagen generándose
// sin ID de operación queda como fallo incierto: nunca se solicita automáticamente otra generación pagada.
export function reanudarGeneracionesMedios(): void {
  const filas = db.query<FilaMedio, []>(`SELECT ${COLUMNAS} FROM media_jobs WHERE estado='generando'`).all();
  for (const fila of filas) {
    if (fila.tipo === "video" && fila.operacion) void procesar(fila.id);
    else establecerError(fila.id, "El servidor se reinició mientras se solicitaba el medio. Revisa el uso de Google antes de volver a generar.");
  }
}

export { detectarSolicitudMedio };
