import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { publicar } from "../bus";
import { AislamientoError, eliminarPerfilOpenCode } from "../runners/aislamiento";
import { ejecutarAgente, ErrorCuota, promptContinuacion, type ResultadoAgente } from "../ejecutar";
import { sesionCompatible } from "../conversacion-contexto";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";
import { mensajeSeguro } from "../workspace";
import { actividadDelTurno, itemDeLinea, registrarActividad } from "../actividad";
import { crearTarea } from "../tareas";
import { notifyWorker } from "../worker";
import { publicarEstado, registrarEvento } from "../eventos";
import { repositoryActions } from "./repository-actions";
import {
  conversacionEnCurso,
  liberarConversacion,
  ocuparConversacion,
  proyectoRevisandose,
} from "../ocupacion";
import { eliminarPerfilSubagentes, prepararSubagentes } from "../subagentes";
import { cerrarSubagentesDelTurno, registrarEventoSubagente } from "../subagentes-chat";
import { ArchivoError, buscarArchivosPorNombre, leerArchivo, leerImagen, leerPdf, leerVideo, normalizarRuta } from "../archivos-proyecto";
import { contarImagenesMarcadas, eliminarImagenesConversacion, guardarImagenAdjunta, idsImagenesMarcadas, leerImagenAdjunta, MAX_IMAGENES_MENSAJE } from "../chat-adjuntos";

const DEFAULT_MODEL = "opencode/big-pickle";
// Texto de un mensaje: incluye los adjuntos de texto. El cuerpo HTTP sigue limitado a 64 KB.
const MAX_CONTENIDO = 30_000;
// Lo que se muestra en el chat si el agente falla: se corta para que no llene la conversación.
const MAX_DETALLE_ERROR = 300;
const chatWorkspace = join(config.dataDir, "chat-workspace");
mkdirSync(chatWorkspace, { recursive: true });

export function numeroPullRequestParaFusionar(texto: string): number | null {
  const inicio = texto.trim().replace(/^[¿¡]+/, "");
  const pideFusion = /^(?:(?:por\s+favor|puedes|podr[ií]as|quieres|quiero|necesito)\s+)*(?:(?:haz(?:me)?|hacer|realiza|ejecuta)\s+(?:el\s+)?merge(?:ar)?|fusiona(?:r)?|mergea(?:r)?|merge(?:ar)?)\b/i.test(inicio);
  if (!pideFusion) return null;
  const referencia = /\b(?:pull\s*requests?|pr)\s*(?:(?:n(?:ú|u)mero|num(?:ero)?\.?)\s*)?(?:exact[oa]\s*)?#?\s*(\d{1,10})\b/i.exec(texto)?.[1]
    ?? /github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d{1,10})(?:[/?#]|$)/i.exec(texto)?.[1];
  if (!referencia) return null;
  const numero = Number(referencia);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

type ConversationRow = {
  id: string;
  model: string | null;
  effort: string | null;
  runner_session_id: string | null;
  runner_session_model: string | null;
  project_id: string | null;
  repo_path: string | null;
  // Modelo que se quedó sin cuota en el último turno; null si el chat puede seguir.
  cuota_modelo: string | null;
  parent_conversation_id: string | null;
  subagent_workspace: string | null;
  subagent_config_dir: string | null;
};
type Subchat = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  project_id: string | null;
  parent_conversation_id: string;
  parent_turn_id: string;
  subagent_turn_id: string;
  subagent_agent: string;
  subagent_prompt: string;
  subagent_status: "running" | "done" | "failed" | "cancelled" | "interrupted";
  subagent_result: string | null;
  project_name?: string | null;
  created_at: string;
  last_message_at: string;
  ocupada?: boolean;
  en_proceso?: boolean;
};
type Conversation = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  project_id: string | null;
  project_name: string | null;
  pinned_at: string | null;
  cuota_modelo: string | null;
  created_at: string;
  last_message_at?: string | null;
  ocupada?: boolean;
  en_proceso?: boolean;
  pendiente_aprobacion?: boolean;
  completada?: boolean;
  estado_tarea?: "en_proceso" | "pendiente_aprobacion" | "completada" | null;
  estado_tarea_id?: string | null;
  estado_tarea_version?: string | null;
  subchats?: Subchat[];
};
type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  model: string | null;
  effort: string | null;
};
type TurnoUsuario = { id: string; role: "user"; content: string };

export const chat = new Hono();

// Anclados primero (el más reciente anclado, arriba); luego los demás por fecha.
chat.get("/conversations", (c) => {
  const rows = db
    .query<Conversation & {
      last_msg_at: string | null;
      task_id: string | null;
      task_status: string | null;
      task_finished_at: string | null;
      task_plan_hash: string | null;
    }, []>(`
      WITH latest_messages AS (
        SELECT conversation_id, MAX(created_at) AS last_msg_at
          FROM messages GROUP BY conversation_id
      ), latest_tasks AS (
        SELECT id, conversation_id, status, finished_at, plan_hash,
               ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, rowid DESC) AS rn
          FROM tasks WHERE conversation_id IS NOT NULL
      )
      SELECT c.id, c.title, c.model, c.effort, c.project_id, p.name AS project_name,
             c.pinned_at, c.cuota_modelo, c.created_at, m.last_msg_at,
             t.id AS task_id, t.status AS task_status, t.finished_at AS task_finished_at,
             t.plan_hash AS task_plan_hash
        FROM conversations c
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN latest_messages m ON m.conversation_id = c.id
        LEFT JOIN latest_tasks t ON t.conversation_id = c.id AND t.rn = 1
       WHERE c.parent_conversation_id IS NULL
       ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, c.created_at DESC, c.rowid DESC
    `)
    .all();

  const hijos = db.query<Subchat, []>(`
    SELECT c.id,c.title,c.model,c.effort,c.project_id,p.name AS project_name,c.parent_conversation_id,c.parent_turn_id,
           c.subagent_turn_id,c.subagent_agent,c.subagent_prompt,c.subagent_status,c.subagent_result,
           c.created_at,MAX(c.created_at,COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id=c.id),c.created_at)) AS last_message_at
      FROM conversations c
      LEFT JOIN projects p ON p.id=c.project_id
     WHERE c.parent_conversation_id IS NOT NULL
     ORDER BY c.created_at,c.rowid
  `).all();
  const hijosPorPadre = new Map<string, Subchat[]>();
  for (const hijo of hijos) {
    hijo.ocupada = hijo.subagent_status === "running";
    hijo.en_proceso = hijo.ocupada;
    const lista = hijosPorPadre.get(hijo.parent_conversation_id) ?? [];
    lista.push(hijo);
    hijosPorPadre.set(hijo.parent_conversation_id, lista);
  }

  return c.json(
    rows.map((r) => {
      const tarea = r.task_id
        ? { id: r.task_id, status: r.task_status!, finished_at: r.task_finished_at, plan_hash: r.task_plan_hash }
        : null;

      const enCurso = conversacionEnCurso(r.id) || (tarea ? ["queued", "analyzing", "running"].includes(tarea.status) : false);
      const pendienteAprobacion = tarea?.status === "waiting_approval";
      const completada = tarea?.status === "done";

      return {
        ...r,
        subchats: hijosPorPadre.get(r.id) ?? [],
        last_message_at: r.last_msg_at || r.created_at,
        ocupada: chatOcupado(r.id),
        en_proceso: Boolean(enCurso),
        pendiente_aprobacion: Boolean(pendienteAprobacion),
        completada: Boolean(completada && !enCurso && !pendienteAprobacion),
        estado_tarea: enCurso
          ? "en_proceso"
          : pendienteAprobacion
            ? "pendiente_aprobacion"
            : completada
              ? "completada"
              : null,
        estado_tarea_id: tarea?.id ?? null,
        estado_tarea_version: tarea?.plan_hash ?? tarea?.finished_at ?? null,
      };
    }),
  );
});

// POST /api/conversations  body: { title?, projectId? }
// Con projectId, el chat trabaja dentro de la carpeta de ese proyecto.
chat.post("/conversations", async (c) => {
  const body = await c.req
    .json<{ title?: string; projectId?: string | null }>()
    .catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid_body" }, 400);
  const id = crypto.randomUUID();
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Nuevo chat";
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (projectId && !projectRepoPath(projectId)) return c.json({ error: "project_not_found" }, 400);
  db.query("INSERT INTO conversations (id, title, project_id) VALUES (?, ?, ?)").run(
    id,
    title,
    projectId,
  );
  return c.json({ id, title, project_id: projectId, created_at: new Date().toISOString() }, 201);
});

// DELETE /api/conversations/:id  -> borra el chat y sus mensajes. El uso registrado se conserva para las analíticas.
chat.delete("/conversations/:id", (c) => {
  const id = c.req.param("id");
  if (chatOcupado(id)) return c.json({ error: "conversation_busy" }, 409);
  const parentId = db.query<{ parent_conversation_id: string | null }, [string]>(
    "SELECT parent_conversation_id FROM conversations WHERE id=?",
  ).get(id)?.parent_conversation_id ?? null;
  const perfilesHijos = parentId === null
    ? db.query<{ subagent_config_dir: string | null }, [string]>(`
        WITH RECURSIVE familia(id) AS (
          SELECT id FROM conversations WHERE id=?
          UNION ALL
          SELECT hija.id FROM conversations hija JOIN familia f ON hija.parent_conversation_id=f.id
        )
        SELECT DISTINCT subagent_config_dir FROM conversations
         WHERE id IN (SELECT id FROM familia) AND subagent_config_dir IS NOT NULL
      `).all(id).map((fila) => fila.subagent_config_dir)
    : [];
  const result = db.query("DELETE FROM conversations WHERE id = ?").run(id);
  if (result.changes === 0) return c.json({ error: "conversation_not_found" }, 404);
  eliminarImagenesConversacion(id);
  eliminarPerfilOpenCode(id);
  for (const perfil of perfilesHijos) eliminarPerfilSubagentes(perfil);
  return c.json({ ok: true });
});

// Pasos del agente de un turno (el id es el del mensaje del usuario). Se piden al abrir "Ver proceso".
chat.get("/conversations/:id/turnos/:turno/actividad", (c) => {
  return c.json(actividadDelTurno(c.req.param("id"), c.req.param("turno")));
});

chat.get("/conversations/:id/turnos/:turno/subagentes", (c) => {
  const conversationId = c.req.param("id");
  const turnId = c.req.param("turno");
  if (!db.query("SELECT 1 FROM conversations WHERE id=?").get(conversationId)) {
    return c.json({ error: "conversation_not_found" }, 404);
  }
  const filas = db.query<Subchat, [string, string]>(`
    SELECT c.id,c.title,c.model,c.effort,c.project_id,p.name AS project_name,c.parent_conversation_id,c.parent_turn_id,
           c.subagent_turn_id,c.subagent_agent,c.subagent_prompt,c.subagent_status,c.subagent_result,
           c.created_at,MAX(c.created_at,COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id=c.id),c.created_at)) AS last_message_at
      FROM conversations c LEFT JOIN projects p ON p.id=c.project_id
     WHERE c.parent_conversation_id=? AND c.parent_turn_id=?
     ORDER BY c.created_at,c.rowid
  `).all(conversationId, turnId);
  for (const hija of filas) {
    hija.ocupada = hija.subagent_status === "running";
    hija.en_proceso = hija.ocupada;
  }
  return c.json(filas);
});

chat.get("/conversations/:id/messages", (c) => {
  const messages = db
    .query<Message, [string]>(
      "SELECT id, conversation_id, role, content, created_at, model, effort FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(c.req.param("id"));
  return c.json(messages);
});

// Métricas verificables del contexto de un chat; los tokens acumulados no equivalen a la ventana activa.
chat.get("/conversations/:id/contexto", (c) => {
  const id = c.req.param("id");
  const conversation = db.query<{
    id: string;
    title: string;
    provider: string | null;
    model: string | null;
    effort: string | null;
    sessionId: string | null;
    sessionModel: string | null;
    createdAt: string;
    lastActivity: string | null;
  }, [string]>(`
    SELECT c.id, c.title, c.provider, c.model, c.effort,
           c.runner_session_id AS sessionId, c.runner_session_model AS sessionModel,
           c.created_at AS createdAt,
           MAX(c.created_at,
               COALESCE((SELECT MAX(created_at) FROM messages WHERE conversation_id=c.id), c.created_at),
               COALESCE((SELECT MAX(created_at) FROM usage WHERE conversation_id=c.id), c.created_at),
               COALESCE((SELECT MAX(created_at) FROM chat_actividad WHERE conversation_id=c.id), c.created_at)) AS lastActivity
      FROM conversations c WHERE c.id=?
  `).get(id);
  if (!conversation) return c.json({ error: "conversation_not_found" }, 404);

  const messages = db.query<{ total: number; user: number; assistant: number; system: number }, [string]>(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(role='user'), 0) AS user,
           COALESCE(SUM(role='assistant'), 0) AS assistant,
           COALESCE(SUM(role='system'), 0) AS system
      FROM messages WHERE conversation_id=?
  `).get(id)!;
  const usage = db.query<{
    calls: number;
    chatCalls: number;
    taskCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    measured: number;
    estimated: number;
    unavailable: number;
    unknown: number;
  }, [string]>(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(task_id IS NULL), 0) AS chatCalls,
           COALESCE(SUM(task_id IS NOT NULL), 0) AS taskCalls,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(cost), 0) AS costUsd,
           COALESCE(SUM(tokens_precision='medida'), 0) AS measured,
           COALESCE(SUM(tokens_precision='estimado'), 0) AS estimated,
           COALESCE(SUM(tokens_precision='no_disponible'), 0) AS unavailable,
           COALESCE(SUM(tokens_precision='desconocida'), 0) AS unknown
      FROM usage WHERE conversation_id=?
  `).get(id)!;
  const byModel = db.query<{
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }, [string]>(`
    SELECT provider, model, COUNT(*) AS calls,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(cost), 0) AS costUsd
      FROM usage WHERE conversation_id=?
     GROUP BY provider, model ORDER BY SUM(input_tokens + output_tokens) DESC, model
  `).all(id);
  const lastInput = db.query<{
    provider: string;
    model: string;
    inputTokens: number;
    tokensPrecision: string;
    createdAt: string;
  }, [string]>(`
    SELECT provider, model, input_tokens AS inputTokens,
           tokens_precision AS tokensPrecision, created_at AS createdAt
      FROM usage WHERE conversation_id=? AND task_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(id);
  const actions = db.query<{ total: number }, [string]>(
    "SELECT COUNT(*) AS total FROM chat_actividad WHERE conversation_id=? AND tipo='accion'",
  ).get(id)!.total;

  return c.json({
    conversation,
    messages,
    actions,
    usage,
    byModel,
    lastInput: lastInput ?? null,
  });
});

// Las imágenes se suben por separado del JSON del mensaje para conservar el límite pequeño de la API.
chat.post("/conversations/:id/adjuntos", async (c) => {
  const id = c.req.param("id");
  if (!leerConversacion(id)) return c.json({ error: "conversation_not_found" }, 404);
  const form = await c.req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) return c.json({ error: "invalid_image" }, 400);
  if (!archivo.size || archivo.size > 8 * 1024 * 1024) return c.json({ error: "image_size_invalid" }, 413);
  try {
    const imagen = guardarImagenAdjunta(id, archivo.name, new Uint8Array(await archivo.arrayBuffer()));
    return c.json(imagen, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "image_type_unsupported") return c.json({ error: "image_type_unsupported" }, 415);
    if (err instanceof Error && err.message === "image_size_invalid") return c.json({ error: "image_size_invalid" }, 413);
    throw err;
  }
});

// Muestra únicamente las imágenes raster subidas a este chat; el id de conversación limita el alcance.
chat.get("/conversations/:id/adjuntos/:adjunto", (c) => {
  const id = c.req.param("id");
  if (!leerConversacion(id)) return c.json({ error: "conversation_not_found" }, 404);
  const imagen = leerImagenAdjunta(id, c.req.param("adjunto"));
  if (!imagen) return c.json({ error: "attachment_not_found" }, 404);
  return new Response(imagen.contenido, {
    headers: {
      "Content-Type": imagen.mime,
      "Content-Length": String(imagen.bytes),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
    },
  });
});

// Vista previa de archivos de texto creados dentro del workspace aislado de esta conversación.
chat.get("/conversations/:id/archivo", (c) => {
  const conversacion = leerConversacion(c.req.param("id"));
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  const raices = raicesArchivosConversacion(conversacion);
  if (!raices.length) return c.json({ error: "project_path_not_found" }, 404);
  try {
    const ruta = normalizarRuta(c.req.query("ruta"));
    return c.json(leerEnRaices(raices, (raiz) => leerArchivo(raiz, ruta)));
  } catch (err) {
    if (err instanceof ArchivoError) {
      const code = err.code === "project_path_not_found" && !conversacion.project_id ? "archivo_chat_no_encontrado" : err.code;
      return c.json({ error: code }, err.status);
    }
    throw err;
  }
});

chat.get("/conversations/:id/archivo-pdf", (c) => {
  const id = c.req.param("id");
  const conversacion = leerConversacion(id);
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  const raices = raicesArchivosConversacion(conversacion);
  if (!raices.length) return c.json({ error: "project_path_not_found" }, 404);

  try {
    const ruta = normalizarRuta(c.req.query("ruta"));
    const archivo = leerEnRaices(raices, (raiz) => leerPdf(raiz, ruta));
    const nombre = archivo.ruta.split("/").at(-1)!.replace(/[\r\n"\\]/g, "_");
    const nombreAscii = nombre.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
    const nombreUtf8 = encodeURIComponent(nombre).replace(/[!'()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`);
    const cabeceras = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${c.req.query("descargar") === "1" ? "attachment" : "inline"}; filename="${nombreAscii}"; filename*=UTF-8''${nombreUtf8}`,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
    };

    if (c.req.query("meta") === "1") {
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rango = c.req.header("range");
    if (!rango) {
      return new Response(archivo.contenido, {
        headers: { ...cabeceras, "Content-Length": String(archivo.contenido.byteLength) },
      });
    }

    const coincide = /^bytes=(\d+)-(\d*)$/.exec(rango);
    if (!coincide) {
      return new Response(null, {
        status: 416,
        headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` },
      });
    }
    const inicio = Number(coincide[1]);
    const fin = coincide[2] ? Math.min(Number(coincide[2]), archivo.tamano - 1) : archivo.tamano - 1;
    if (inicio >= archivo.tamano || fin < inicio) {
      return new Response(null, {
        status: 416,
        headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` },
      });
    }
    const fragmento = archivo.contenido.subarray(inicio, fin + 1);
    return new Response(fragmento, {
      status: 206,
      headers: {
        ...cabeceras,
        "Content-Length": String(fragmento.byteLength),
        "Content-Range": `bytes ${inicio}-${fin}/${archivo.tamano}`,
      },
    });
  } catch (err) {
    if (err instanceof ArchivoError) {
      const code = err.code === "project_path_not_found" && !conversacion.project_id ? "archivo_chat_no_encontrado" : err.code;
      return c.json({ error: code }, err.status);
    }
    throw err;
  }
});

// Vista previa y descarga de imágenes raster del workspace del chat o de su proyecto.
chat.get("/conversations/:id/archivo-imagen", (c) => {
  const id = c.req.param("id");
  const conversacion = leerConversacion(id);
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  const raices = raicesArchivosConversacion(conversacion);
  if (!raices.length) return c.json({ error: "project_path_not_found" }, 404);

  try {
    const ruta = normalizarRuta(c.req.query("ruta"));
    const archivo = leerEnRaices(raices, (raiz) => leerImagen(raiz, ruta));
    const nombreSeguro = archivo.nombre.replace(/[\r\n"\\]/g, "_");
    const nombreAscii = nombreSeguro.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
    const nombreUtf8 = encodeURIComponent(nombreSeguro).replace(/[!'()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposicion = c.req.query("descargar") === "1" ? "attachment" : "inline";
    const cabeceras = {
      "Content-Type": archivo.mime,
      "Content-Disposition": `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${nombreUtf8}`,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
    };

    if (c.req.query("meta") === "1") {
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre: archivo.nombre, mime: archivo.mime, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new Response(archivo.contenido, {
      headers: { ...cabeceras, "Content-Length": String(archivo.contenido.byteLength) },
    });
  } catch (err) {
    if (err instanceof ArchivoError) {
      const code = err.code === "project_path_not_found" && !conversacion.project_id ? "archivo_chat_no_encontrado" : err.code;
      return c.json({ error: code }, err.status);
    }
    throw err;
  }
});

// Vista previa y descarga de MP4 del workspace; admite rangos para reproducción y búsqueda.
chat.get("/conversations/:id/archivo-video", async (c) => {
  const id = c.req.param("id");
  const conversacion = leerConversacion(id);
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  const raices = raicesArchivosConversacion(conversacion);
  if (!raices.length) return c.json({ error: "project_path_not_found" }, 404);

  try {
    const ruta = normalizarRuta(c.req.query("ruta"));
    let archivo: ReturnType<typeof leerVideo>;
    try {
      archivo = leerEnRaices(raices, (raiz) => leerVideo(raiz, ruta));
    } catch (err) {
      if (!(err instanceof ArchivoError) || err.code !== "project_path_not_found" || ruta.length !== 1) throw err;

      // Los agentes suelen guardar videos en carpetas como `renders/` o `entregables/` y luego
      // citan solo el nombre. Resuelve ese caso dentro de las raíces autorizadas del chat.
      let archivoEncontrado: ReturnType<typeof leerVideo> | null = null;
      for (const raiz of raices) {
        let busqueda: Awaited<ReturnType<typeof buscarArchivosPorNombre>>;
        try {
          busqueda = await buscarArchivosPorNombre(raiz, ruta[0]!);
        } catch (error) {
          if (error instanceof ArchivoError && error.code === "project_path_not_found") {
            continue;
          }
          throw error;
        }

        if (busqueda.rutas.length > 0 && (busqueda.rutas.length > 1 || busqueda.truncada)) {
          return c.json({
            error: "project_path_ambiguous",
            matches: busqueda.rutas,
            ...(busqueda.truncada ? { detail: "La búsqueda alcanzó su límite; estas rutas pueden no ser todas las coincidencias." } : {}),
          }, 409);
        }
        if (busqueda.truncada) {
          return c.json({ error: "project_search_incomplete", detail: "La búsqueda alcanzó su límite; abre el video con su ruta completa." }, 409);
        }
        if (busqueda.rutas.length === 1) {
          archivoEncontrado = leerVideo(raiz, normalizarRuta(busqueda.rutas[0]!));
          break;
        }
      }
      if (!archivoEncontrado) throw err;
      archivo = archivoEncontrado;
    }
    const nombreSeguro = archivo.nombre.replace(/[\r\n"\\]/g, "_");
    const nombreAscii = nombreSeguro.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^\x20-\x7E]/g, "_").replace(/["\\;]/g, "_");
    const nombreUtf8 = encodeURIComponent(nombreSeguro).replace(/[!'()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`);
    const cabeceras = {
      "Content-Type": archivo.mime,
      "Content-Disposition": `${c.req.query("descargar") === "1" ? "attachment" : "inline"}; filename="${nombreAscii}"; filename*=UTF-8''${nombreUtf8}`,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
    };

    if (c.req.query("meta") === "1") {
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre: archivo.nombre, mime: archivo.mime, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rango = c.req.header("range");
    if (!rango) {
      return new Response(archivo.contenido, {
        headers: { ...cabeceras, "Content-Length": String(archivo.contenido.byteLength) },
      });
    }

    const coincide = /^bytes=(\d+)-(\d*)$/.exec(rango);
    if (!coincide) {
      return new Response(null, { status: 416, headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` } });
    }
    const inicio = Number(coincide[1]);
    const fin = coincide[2] ? Math.min(Number(coincide[2]), archivo.tamano - 1) : archivo.tamano - 1;
    if (inicio >= archivo.tamano || fin < inicio) {
      return new Response(null, { status: 416, headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` } });
    }
    const fragmento = archivo.contenido.subarray(inicio, fin + 1);
    return new Response(fragmento, {
      status: 206,
      headers: {
        ...cabeceras,
        "Content-Length": String(fragmento.byteLength),
        "Content-Range": `bytes ${inicio}-${fin}/${archivo.tamano}`,
      },
    });
  } catch (err) {
    if (err instanceof ArchivoError) {
      const code = err.code === "project_path_not_found" && !conversacion.project_id ? "archivo_chat_no_encontrado" : err.code;
      return c.json({ error: code }, err.status);
    }
    throw err;
  }
});

chat.get("/conversations/:id/tasks", (c) => {
  const id = c.req.param("id");
  if (!leerConversacion(id)) return c.json({ error: "conversation_not_found" }, 404);
  const filas = db.query<{ plan: string | null; reporte: string | null; [key: string]: unknown }, [string]>(
    "SELECT id,title,status,model,modelo_agotado,effort,plan,reporte,plan_aprobado_en,plan_hash,approved_hash,error,conversation_id,created_at,started_at,finished_at FROM tasks WHERE conversation_id=? ORDER BY created_at,rowid",
  ).all(id);
  const json = (valor: string | null): unknown => {
    try { return valor ? JSON.parse(valor) : null; } catch { return null; }
  };
  return c.json(filas.map((fila) => ({ ...fila, plan: json(fila.plan), reporte: json(fila.reporte) })));
});

// Instrucción de "Seguir": el mensaje visible del usuario y lo que se le pide al agente.
const SEGUIR_VISIBLE = "Seguir donde se quedó";
const SEGUIR_INSTRUCCION = "Termina la respuesta que quedó a medias. Responde solo con lo que falta.";

function leerConversacion(id: string): ConversationRow | null {
  return (
    db
      .query<ConversationRow, [string]>(
        "SELECT c.id,c.model,c.effort,c.runner_session_id,c.runner_session_model,c.project_id,c.cuota_modelo,c.parent_conversation_id,c.subagent_workspace,c.subagent_config_dir,p.repo_path AS repo_path FROM conversations c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=?",
      )
      .get(id) ?? null
  );
}

function raicesArchivosConversacion(conversacion: ConversationRow): string[] {
  const workspaces = db.query<{ workspace: string }, [string]>(
    "SELECT workspace FROM tasks WHERE conversation_id=? AND workspace IS NOT NULL ORDER BY created_at DESC,rowid DESC",
  ).all(conversacion.id).map((tarea) => tarea.workspace);
  const raizOriginal = conversacion.subagent_workspace
    ?? (conversacion.project_id ? conversacion.repo_path : join(chatWorkspace, conversacion.parent_conversation_id ?? conversacion.id));
  return [...new Set([...workspaces, ...(raizOriginal ? [raizOriginal] : [])])];
}

function leerEnRaices<T>(raices: string[], leer: (raiz: string) => T): T {
  let noEncontrado: ArchivoError | null = null;
  for (const raiz of raices) {
    try {
      return leer(raiz);
    } catch (err) {
      if (!(err instanceof ArchivoError) || err.code !== "project_path_not_found") throw err;
      noEncontrado = err;
    }
  }
  throw noEncontrado ?? new ArchivoError("project_path_not_found", 404);
}

// Un mensaje en curso o un proyecto que se está revisando impiden responder: el chat espera.
function motivoDeBloqueo(conv: ConversationRow): "conversation_busy" | "proyecto_ocupado" | null {
  if (chatOcupado(conv.id)) return "conversation_busy";
  if (conv.project_id && proyectoRevisandose(conv.project_id)) return "proyecto_ocupado";
  return null;
}

function chatOcupado(id: string): boolean {
  return conversacionEnCurso(id) || db.query(
    "SELECT 1 FROM tasks WHERE conversation_id=? AND status IN ('queued','analyzing','running','waiting_approval') LIMIT 1",
  ).get(id) !== null;
}

function tareaDelChat(id: string) {
  return db.query<{ id: string; status: string; model: string; modelo_agotado: string | null }, [string]>(
    "SELECT id,status,model,modelo_agotado FROM tasks WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
  ).get(id);
}

// Una conversación conserva su clon y sesión; cada nueva petición crea una tarea nueva preservando el historial.
function encolarTurno(conv: ConversationRow, prompt: string, model: string): string {
  const anterior = tareaDelChat(conv.id);
  if (anterior) {
    db.query("UPDATE repository_actions SET state='superseded' WHERE task_id=? AND state='pending'").run(anterior.id);
  }
  db.query("UPDATE conversations SET cuota_modelo=NULL WHERE id=?").run(conv.id);
  return crearTarea({
    prompt,
    model,
    effort: conv.effort,
    projectId: conv.project_id,
    conversationId: conv.id,
    providerSessionId: conv.runner_session_id || null,
    providerSessionModel: conv.runner_session_model,
  });
}

// El mensaje del usuario se guarda antes de ejecutar: así aparece en los demás dispositivos
// y no se pierde si el agente falla.
function guardarMensajeUsuario(conversationId: string, content: string): TurnoUsuario {
  const msg: TurnoUsuario = { id: crypto.randomUUID(), role: "user", content };
  db.transaction(() => {
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").run(
      msg.id,
      conversationId,
      msg.role,
      msg.content,
    );
    db.query("UPDATE conversations SET title = ? WHERE id = ? AND title = 'Nuevo chat'").run(
      content.replace(/<<telo-imagen id="[a-f\d-]{36}" nombre="[^"]*">>/gi, "[Imagen adjunta]").trim().slice(0, 60) || "Imagen adjunta",
      conversationId,
    );
  })();
  return msg;
}

// Un aviso del sistema en el chat (un fallo, una interrupción). Queda guardado: se ve en cualquier dispositivo.
function guardarAviso(conversationId: string, texto: string): void {
  db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'system', ?)").run(
    crypto.randomUUID(),
    conversationId,
    texto,
  );
}

function turnoReintentable(conversationId: string, messageId: string, content: string, tieneSesion: boolean): { turno: TurnoUsuario; rowid: number; continuar: boolean } | null {
  const original = db.query<{ id: string; content: string; rowid: number }, [string, string]>(
    "SELECT id, content, rowid FROM messages WHERE id=? AND conversation_id=? AND role='user'",
  ).get(messageId, conversationId);
  if (!original || original.content !== content) return null;

  const ultimoUsuario = db.query<{ id: string }, [string]>(
    "SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
  ).get(conversationId);
  const mensajesPosteriores = db.query<{ role: string; content: string }, [string, number]>(
    "SELECT role,content FROM messages WHERE conversation_id=? AND rowid>? ORDER BY rowid",
  ).all(conversationId, original.rowid);
  if (ultimoUsuario?.id !== messageId || mensajesPosteriores.length === 0 || mensajesPosteriores.some((mensaje) => mensaje.role !== "system")) {
    return null;
  }
  const continuar = tieneSesion || mensajesPosteriores.some((mensaje) => /^El agente (?:superó el límite de|tardó más de) \d+ minutos/i.test(mensaje.content));
  return { turno: { id: original.id, role: "user", content: original.content }, rowid: original.rowid, continuar };
}

function limpiarAvisosReintentados(conversationId: string, rowid: number | undefined): void {
  if (rowid === undefined) return;
  db.query("DELETE FROM messages WHERE conversation_id=? AND role='system' AND rowid>?").run(conversationId, rowid);
}

// Investigación, subagentes y documentos pueden tardar varios minutos; conservar un tope evita procesos eternos.
const TIEMPO_TURNO_MS = 900_000;

// Avisa a los clientes que un turno empezó o terminó. Los demás dispositivos piden de nuevo el chat.
function publicarChat(conversationId: string, estado: "en_curso" | "terminado"): void {
  publicar({ tipo: "chat", conversacion_id: conversationId, estado });
}

// Corre el agente para un turno del chat y guarda su respuesta. Nunca lanza: cualquier fallo queda
// como aviso en el chat, porque nadie espera ya la respuesta HTTP.
async function correrTurno(conv: ConversationRow, turno: TurnoUsuario, prompt: string, model: string): Promise<void> {
  const conversationId = conv.id;
  const inicio = Date.now();
  let result: ResultadoAgente;
  let turnoTerminado = false;
  let huboSubagentes = false;
  let perfilesSubagente: Awaited<ReturnType<typeof prepararSubagentes>> = null;
  try {
    const cwd = conv.subagent_workspace || join(chatWorkspace, conv.parent_conversation_id ?? conversationId);
    mkdirSync(cwd, { recursive: true });
    // Los subagentes no crean otra generación de subchats: el usuario sigue al supervisor y a sus hijos directos.
    perfilesSubagente = conv.parent_conversation_id
      ? null
      : await prepararSubagentes({ prompt, modelo: model, esfuerzo: conv.effort, idEjecucion: crypto.randomUUID() });
    const configSubagentes = perfilesSubagente?.directorio ?? conv.subagent_config_dir ?? undefined;
    result = await ejecutarAgente({
      prompt: perfilesSubagente ? `${perfilesSubagente.instruccion}\n\n${prompt}` : prompt,
      model,
      variant: conv.effort,
      sessionId: conv.runner_session_id,
      sessionModel: conv.runner_session_model,
      cwd,
      timeoutMs: TIEMPO_TURNO_MS,
      projectId: conv.project_id,
      conversationId,
      estilo: "chat",
      opencodeConfigDir: configSubagentes,
      opencodeSubagentesTracePath: perfilesSubagente?.rutaCaptura,
      onSubagente: perfilesSubagente ? (linea) => {
        try {
          if ((JSON.parse(linea) as { kind?: string }).kind === "created") huboSubagentes = true;
        } catch {}
        registrarEventoSubagente({
          parentConversationId: conversationId,
          parentTurnId: turno.id,
          workspace: cwd,
          configDir: perfilesSubagente!.directorio,
          model,
          eventLine: linea,
        });
        publicarChat(conversationId, "en_curso");
      } : undefined,
      // Guarda la sesión al aparecer para que un timeout o reinicio permita continuar el turno.
      onSesion: (sessionId, sessionModel) => {
        db.query("UPDATE conversations SET runner_session_id=?, runner_session_model=? WHERE id=?")
          .run(sessionId, sessionModel, conversationId);
      },
      // Cada paso del agente (texto intermedio o acción) se guarda y se publica mientras corre.
      onLinea: (linea) => {
        const item = itemDeLinea(linea);
        if (item) registrarActividad(conversationId, turno.id, item);
      },
    });
    turnoTerminado = true;
  } catch (err) {
    if (err instanceof ErrorCuota) {
      // La sesión que sí llegó a abrirse se guarda, para seguirla con otro modelo. El aviso de cuota lo muestra el chat.
      db.query(
        "UPDATE conversations SET cuota_modelo = ?, runner_session_id = ?, runner_session_model = ? WHERE id = ?",
      ).run(err.modelo, err.sessionId, err.sessionId ? err.modelo : null, conversationId);
      return;
    }
    if (err instanceof AislamientoError) {
      guardarAviso(conversationId, err.message);
      return;
    }
    // Se explica el límite en vez de mostrar el código de salida (143 es la señal de parada).
    if (Date.now() - inicio >= TIEMPO_TURNO_MS) {
      guardarAviso(
        conversationId,
        `El agente superó el límite de ${TIEMPO_TURNO_MS / 60_000} minutos y se detuvo. La sesión quedó guardada; reintenta para continuar donde se quedó.`,
      );
      return;
    }
    // Sin rutas del servidor ni fragmentos de secretos.
    guardarAviso(
      conversationId,
      `No se pudo responder. ${mensajeSeguro(err).slice(0, MAX_DETALLE_ERROR)}`,
    );
    return;
  } finally {
    if (perfilesSubagente) {
      if (huboSubagentes) perfilesSubagente.finalizarCaptura();
      else perfilesSubagente.limpiar();
    }
    cerrarSubagentesDelTurno(conversationId, turno.id, turnoTerminado ? "done" : "interrupted");
  }

  // La respuesta del chat es lo dicho tras la última herramienta; lo anterior queda en el proceso.
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: result.textoFinal,
    model: result.modelo || model,
    effort: result.variante,
  };

  db.transaction(() => {
    db.query(
      "INSERT INTO messages (id, conversation_id, role, content, model, effort) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(assistantMsg.id, conversationId, assistantMsg.role, assistantMsg.content, assistantMsg.model, assistantMsg.effort);

    // Una respuesta correcta levanta el aviso de cuota, si lo había.
    db.query("UPDATE conversations SET cuota_modelo = NULL WHERE id = ?").run(conversationId);

    const modeloEfectivo = result.modelo || model;
    db.query("UPDATE conversations SET runner_session_id = ?, runner_session_model = ? WHERE id = ?").run(
      result.sessionId,
      result.sessionId ? modeloEfectivo : null,
      conversationId,
    );
    // Si el usuario cambió el modelo mientras corría el turno, conserva su selección para el próximo mensaje.
    db.query("UPDATE conversations SET model = ?, effort = ? WHERE id = ? AND model IS ? AND effort IS ?").run(
      modeloEfectivo,
      result.variante,
      conversationId,
      conv.model,
      conv.effort,
    );

  })();
}

// El turno corre en segundo plano, no dentro de la petición HTTP. Así, si el móvil se duerme, cambia
// de app o pierde la red, el agente termina igual, la respuesta queda guardada y se ve al volver.
function iniciarTurno(conv: ConversationRow, turno: TurnoUsuario, prompt: string, model: string): void {
  ocuparConversacion(conv.id);
  publicarChat(conv.id, "en_curso");
  void correrTurno(conv, turno, prompt, model)
    .catch((err) => {
      // correrTurno no lanza; esto solo cubre un fallo al guardar la respuesta.
      console.error("Turno del chat:", mensajeSeguro(err));
      guardarAviso(conv.id, "No se pudo guardar la respuesta. Intenta de nuevo.");
    })
    .finally(() => {
      liberarConversacion(conv.id);
      publicarChat(conv.id, "terminado");
      notifyWorker();
    });
}

// Al arrancar el servidor no hay turnos en curso. Si el último mensaje de un chat es del usuario, la
// respuesta se perdió al reiniciarse: se avisa en el chat para que el usuario lo envíe de nuevo.
export function avisarTurnosInterrumpidos(): number {
  const chats = db
    .query<{ id: string }, []>(
      `SELECT c.id FROM conversations c
       WHERE c.parent_conversation_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.conversation_id=c.id)
       AND (SELECT m.role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) = 'user'`,
    )
    .all();
  for (const { id } of chats) {
    guardarAviso(id, "La respuesta se interrumpió porque el servidor se reinició. Envía el mensaje de nuevo para intentarlo.");
  }
  return chats.length;
}

// 202: el mensaje ya está guardado y el agente trabaja. La respuesta llega al chat por la lista de mensajes.
chat.post("/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const conv = leerConversacion(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<{ content?: unknown; retryOf?: unknown }>().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_CONTENIDO) {
    return c.json({ error: "invalid_content" }, 400);
  }
  if (contarImagenesMarcadas(content) > MAX_IMAGENES_MENSAJE || idsImagenesMarcadas(content).some((id) => !leerImagenAdjunta(conversationId, id))) {
    return c.json({ error: "invalid_attachment" }, 400);
  }
  if (body?.retryOf !== undefined && (typeof body.retryOf !== "string" || !body.retryOf.trim())) {
    return c.json({ error: "invalid_retry" }, 400);
  }
  const retryOf = typeof body?.retryOf === "string" ? body.retryOf : null;
  const reintento = retryOf ? turnoReintentable(conversationId, retryOf, content, Boolean(conv.runner_session_id)) : null;
  if (retryOf && !reintento) return c.json({ error: "message_not_retryable" }, 409);
  const bloqueo = motivoDeBloqueo(conv);
  if (bloqueo) return c.json({ error: bloqueo }, 409);
  const tareaActual = conv.project_id ? tareaDelChat(conversationId) : null;
  const modeloAgotado = conv.cuota_modelo ?? (tareaActual?.status === "sin_cuota"
    ? tareaActual.modelo_agotado ?? tareaActual.model
    : null);
  if (modeloAgotado) return c.json({ error: "chat_quota_pending" }, 409);

  // Fusionar un PR existente por número es una acción directa: no debe crear una tarea ni otra rama.
  const numeroPr = numeroPullRequestParaFusionar(content);
  // Las demás órdenes directas de Git crean una tarjeta de autorización, sin ejecutar al agente.
  const pedido = /^(?:(?:haz|hacer|ejecuta|realiza|crea|crear|prepara|reintenta|por favor)\s+)*(?:de nuevo\s+)?(?:(?:un|el)\s+)?(?:git\s+(init|commit|push)|(?:un\s+)?(commit|push|pr)|(?:gh\s+pr\s+create)|(pull request))(?:\s+.*)?[.!]?$/i.exec(content);
  if ((pedido || numeroPr !== null) && conv.project_id) {
    const turno = reintento?.turno ?? guardarMensajeUsuario(conversationId, content);
    const accion = numeroPr !== null
      ? "merge"
      : /\bcommit\s+(?:y|and|&)\s+(?:git\s+)?push\b/i.test(pedido![0])
        ? "push"
        : (pedido![1] || pedido![2] || "pr").toLowerCase();
    const response = await repositoryActions.request(`http://telo/projects/${conv.project_id}/acciones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: accion,
        conversationId,
        taskId: accion === "merge" ? undefined : tareaDelChat(conversationId)?.id,
        messageId: turno.id,
        ...(numeroPr !== null ? { pr_number: numeroPr, title: `Fusionar PR #${numeroPr}` } : {}),
      }),
    });
    if (!response.ok) {
      const error = await response.clone().json() as { error?: string };
      const motivos: Record<string, string> = {
        sin_cambios: "No hay cambios nuevos en esta tarea para crear un commit o hacer push.",
        sin_remoto: "Configura el repositorio de GitHub del proyecto antes de preparar el push.",
        task_without_repo: "Este chat todavía no tiene una tarea con cambios de Git que puedas publicar.",
      };
      const motivo = motivos[error.error ?? ""];
      if (motivo) {
        limpiarAvisosReintentados(conversationId, reintento?.rowid);
        const aviso = { id: crypto.randomUUID(), role: "assistant" as const, content: motivo };
        db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(aviso.id, conversationId, motivo);
        publicarChat(conversationId, "terminado");
        return c.json({ messages: [turno, aviso] }, 202);
      }
      limpiarAvisosReintentados(conversationId, reintento?.rowid);
      const textoAviso = `No se pudo completar la acción de GitHub (HTTP ${response.status}). Tu mensaje quedó guardado; puedes revisar la acción y volver a intentarlo.`;
      const aviso = { id: crypto.randomUUID(), role: "assistant" as const, content: textoAviso };
      db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(aviso.id, conversationId, textoAviso);
      publicarChat(conversationId, "terminado");
      return c.json({ messages: [turno, aviso], actionError: error.error ?? "github_action_failed" }, 202);
    }
    limpiarAvisosReintentados(conversationId, reintento?.rowid);
    publicarChat(conversationId, "terminado");
    return c.json({ messages: [turno], action: await response.json() }, 202);
  }

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  const turno = reintento?.turno ?? guardarMensajeUsuario(conversationId, content);
  limpiarAvisosReintentados(conversationId, reintento?.rowid);
  if (conv.project_id && !conv.parent_conversation_id) {
    const taskId = encolarTurno(conv, content, model);
    publicarChat(conversationId, "en_curso");
    return c.json({ messages: [turno], taskId }, 202);
  }
  const promptTurno = reintento?.continuar
    ? promptContinuacion(SEGUIR_INSTRUCCION, sesionCompatible(conv.runner_session_id, conv.runner_session_model, model))
    : content;
  iniciarTurno(conv, turno, promptTurno, model);
  return c.json({ messages: [turno] }, 202);
});

// POST /api/conversations/:id/seguir
// Tras una cuota agotada: el chat retoma su sesión con el modelo elegido, desde donde se quedó.
// Si el modelo falló antes de abrir sesión, no hay nada que retomar: se vuelve a enviar el mensaje sin respuesta.
chat.post("/conversations/:id/seguir", async (c) => {
  const conversationId = c.req.param("id");
  const conv = leerConversacion(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  const tarea = conv.project_id && !conv.parent_conversation_id ? tareaDelChat(conversationId) : null;
  const modeloAgotado = conv.cuota_modelo ?? (tarea?.status === "sin_cuota"
    ? tarea.modelo_agotado ?? tarea.model
    : null);
  if (!modeloAgotado) return c.json({ error: "chat_sin_cuota" }, 409);

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  if (model === modeloAgotado) return c.json({ error: "modelo_sin_cambio" }, 409);
  const bloqueo = motivoDeBloqueo(conv);
  if (bloqueo) return c.json({ error: bloqueo }, 409);

  if (conv.project_id && !conv.parent_conversation_id) {
    if (!tarea || tarea.status !== "sin_cuota") return c.json({ error: "chat_sin_cuota" }, 409);
    const turno = guardarMensajeUsuario(conversationId, SEGUIR_VISIBLE);
    db.transaction(() => {
      db.query("UPDATE tasks SET status='queued',model=?,effort=?,modelo_agotado=NULL,error=NULL,finished_at=NULL,continuar=1 WHERE id=?")
        .run(model, conv.effort, tarea.id);
      db.query("UPDATE conversations SET cuota_modelo=NULL WHERE id=?").run(conversationId);
      registrarEvento(tarea.id, "seguida", `Modelo ${model}`);
    })();
    publicarEstado(tarea.id);
    publicarChat(conversationId, "en_curso");
    notifyWorker();
    return c.json({ messages: [turno], taskId: tarea.id }, 202);
  }

  const ultimoMensaje = conv.runner_session_id === null
    ? db
        .query<{ content: string }, [string]>(
          "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get(conversationId)?.content
    : undefined;
  const turno = guardarMensajeUsuario(conversationId, SEGUIR_VISIBLE);
  const prompt = conv.runner_session_id !== null
    ? promptContinuacion(
        SEGUIR_INSTRUCCION,
        sesionCompatible(conv.runner_session_id, conv.runner_session_model, model),
      )
    : (ultimoMensaje ?? SEGUIR_INSTRUCCION);
  iniciarTurno(conv, turno, prompt, model);
  return c.json({ messages: [turno] }, 202);
});
