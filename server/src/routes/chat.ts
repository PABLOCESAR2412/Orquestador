import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { COOKIE_SESION, sesionValida } from "../auth";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { pausaTareasPorDespliegue, registrarPausaActiva, registrarTrabajo } from "../despliegue";
import { db } from "../db";
import { publicar } from "../bus";
import { AislamientoError, eliminarPerfilCodex, eliminarPerfilOpenCode } from "../runners/aislamiento";
import { ejecutarAgente, ErrorCuota, promptContinuacion, type OpcionesAgente, type ResultadoAgente } from "../ejecutar";
import { sesionCompatible } from "../conversacion-contexto";
import { ejecutarAnalisisOrquestado, leerTrabajadoresOrquestacion, type TrabajadorOrquestacion } from "../orquestacion-chat";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";
import { mensajeSeguro } from "../workspace";
import { carpetaEntregables } from "../entregables";
import { actividadDelTurno, itemDeLinea, marcarRespuestaCompactada, registrarActividad } from "../actividad";
import { crearTarea } from "../tareas";
import { cancelTask, notifyWorker } from "../worker";
import { publicarEstado, registrarEvento } from "../eventos";
import { repositoryActions } from "./repository-actions";
import {
  conversacionEnCurso,
  liberarConversacion,
  ocuparConversacion,
  proyectoRevisandose,
} from "../ocupacion";
import { eliminarPerfilSubagentes, pideSubagentes, prepararSubagentes } from "../subagentes";
import { cerrarSubagentesDelTurno, registrarEventoSubagente } from "../subagentes-chat";
import { ArchivoError, buscarArchivosPorNombre, leerArchivo, leerImagen, leerPdf, leerVideo, leerRecursoHtml, normalizarRuta } from "../archivos-proyecto";
import { contarImagenesMarcadas, eliminarImagenesConversacion, guardarImagenAdjunta, idsImagenesMarcadas, leerImagenAdjunta, MAX_IMAGENES_MENSAJE } from "../chat-adjuntos";
import { anexarEnlaceVideo, buscarVideoVerificado, promptRecuperarEntregaVideo, requiereEntregaVideo } from "../entrega-video";

const DEFAULT_MODEL = "opencode/big-pickle";
// Texto de un mensaje: incluye los adjuntos de texto. El cuerpo HTTP sigue limitado a 64 KB.
const MAX_CONTENIDO = 30_000;
// Lo que se muestra en el chat si el agente falla: se corta para que no llene la conversación.
const MAX_DETALLE_ERROR = 300;
function carpetaWorkspaceChat(): string {
  const carpeta = join(config.dataDir, "chat-workspace");
  mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

type PermisoPreview = { conversacion: string; raiz: string; sesion: string | undefined; vence: number };
const permisosPreview = new Map<string, PermisoPreview>();
const DURACION_PREVIEW_MS = 10 * 60_000;
function permisoPreview(request: Request): PermisoPreview | null {
  if (request.method !== "GET") return null;
  const coincidencia = /^\/api\/conversations\/([^/]+)\/preview-html\/([a-f0-9]{64})\//.exec(new URL(request.url).pathname);
  if (!coincidencia) return null;
  const permiso = permisosPreview.get(coincidencia[2]!);
  if (!permiso || permiso.conversacion !== coincidencia[1] || permiso.vence <= Date.now() || !sesionValida(permiso.sesion) || !db.query("SELECT 1 FROM conversations WHERE id=?").get(permiso.conversacion)) return null;
  return permiso;
}
// Los recursos de un iframe opaco no envían la cookie Strict. Esta capacidad breve
// solo abre archivos estáticos del workspace autorizado y caduca al revocar la sesión.
export function previewHtmlAutorizada(request: Request): boolean { return permisoPreview(request) !== null; }

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
  work_mode: "plan" | "build";
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
  orquestacion_habilitada: number;
  orquestacion_modelos_personalizados: number;
  orquestacion_seleccion_automatica: number;
  orquestacion_trabajadores: string;
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
  tiene_sesion?: boolean | number;
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
  tiene_sesion?: boolean | number;
  orquestacion_habilitada: boolean;
  orquestacion_modelos_personalizados: boolean;
  orquestacion_trabajadores: TrabajadorOrquestacion[];
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
  sesion_compactada?: number;
};
type TurnoUsuario = { work_mode?: "plan" | "build"; id: string; role: "user"; content: string };

export const chat = new Hono();

// Anclados primero (el más reciente anclado, arriba); luego los demás por fecha.
chat.get("/conversations", (c) => {
  const rows = db
    .query<Omit<Conversation, "orquestacion_habilitada" | "orquestacion_modelos_personalizados" | "orquestacion_trabajadores"> & {
      last_msg_at: string | null;
      conv_rowid: number;
      task_id: string | null;
      task_status: string | null;
      task_finished_at: string | null;
      task_plan_hash: string | null;
      task_reanudable: number | null;
      ultimo_rol: string | null;
      orquestacion_habilitada: number;
      orquestacion_modelos_personalizados: number;
      orquestacion_seleccion_automatica: number;
      orquestacion_trabajadores: string;
    }, []>(`
      WITH latest_messages AS (
        SELECT conversation_id, MAX(created_at) AS last_msg_at
          FROM messages GROUP BY conversation_id
      ), latest_tasks AS (
        SELECT id, conversation_id, status, finished_at, plan_hash, provider_session_id,
               ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY
                 CASE WHEN status IN ('running','analyzing','waiting_approval') THEN 0 WHEN status='queued' THEN 1 ELSE 2 END,
                 CASE WHEN status='queued' THEN created_at END ASC,
                 CASE WHEN status='queued' THEN rowid END ASC,
                 created_at DESC, rowid DESC) AS rn
          FROM tasks WHERE conversation_id IS NOT NULL
      )
      SELECT c.id, c.work_mode, c.title, c.model, c.effort, c.project_id, p.name AS project_name,
             c.pinned_at, c.cuota_modelo, c.created_at, m.last_msg_at, c.rowid AS conv_rowid,
             c.orquestacion_habilitada, c.orquestacion_modelos_personalizados, c.orquestacion_seleccion_automatica, c.orquestacion_trabajadores,
             c.runner_session_id IS NOT NULL AS tiene_sesion,
             t.id AS task_id, t.status AS task_status, t.finished_at AS task_finished_at,
             t.plan_hash AS task_plan_hash, (t.provider_session_id IS NOT NULL OR t.status = 'interrupted') AS task_reanudable,
             (SELECT role FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS ultimo_rol
        FROM conversations c
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN latest_messages m ON m.conversation_id = c.id
        LEFT JOIN latest_tasks t ON t.conversation_id = c.id AND t.rn = 1
       WHERE c.parent_conversation_id IS NULL
       ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, c.created_at DESC, c.rowid DESC
    `)
    .all();

  const hijos = db.query<Subchat, []>(`
    SELECT c.id,c.work_mode,c.title,c.model,c.effort,c.project_id,p.name AS project_name,c.runner_session_id IS NOT NULL AS tiene_sesion,c.parent_conversation_id,c.parent_turn_id,
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
    hijo.tiene_sesion = Boolean(hijo.tiene_sesion);
    const lista = hijosPorPadre.get(hijo.parent_conversation_id) ?? [];
    lista.push(hijo);
    hijosPorPadre.set(hijo.parent_conversation_id, lista);
  }

  const listado = rows.map((r) => {
      const tarea = r.task_id
        ? { id: r.task_id, status: r.task_status!, finished_at: r.task_finished_at, plan_hash: r.task_plan_hash }
        : null;

      const pendienteAprobacion = tarea?.status === "waiting_approval";
      const enCurso = !pendienteAprobacion && (conversacionEnCurso(r.id) || (tarea ? ["queued", "analyzing", "running"].includes(tarea.status) : false));
      const completada = tarea?.status === "done";

      const trabajadores = leerTrabajadoresOrquestacion(r.orquestacion_trabajadores);
      const { orquestacion_trabajadores: _trabajadoresJson, orquestacion_habilitada: orquestacionHabilitada, orquestacion_seleccion_automatica: seleccionAutomatica, ...resto } = r;
      return {
        ...resto,
        orquestacion_habilitada: Boolean(orquestacionHabilitada),
        orquestacion_modelos_personalizados: Boolean(r.orquestacion_modelos_personalizados),
        orquestacion_seleccion_automatica: Boolean(seleccionAutomatica),
        orquestacion_trabajadores: trabajadores,
        requiere_continuar: !enCurso && (Boolean(r.cuota_modelo) || (tarea
          ? ["failed", "interrupted"].includes(tarea.status) && Boolean(r.task_reanudable)
          : Boolean(r.tiene_sesion) && r.ultimo_rol === "system")),
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
        tiene_sesion: Boolean(r.tiene_sesion),
      };
  });

  // Con ?limite= se devuelve una página del listado ya ordenado (anclados primero) junto con el
  // cursor para la siguiente tanda; el cursor codifica la clave del orden: anclado;pinned_at;created_at;rowid.
  // Sin limite (como hoy) se devuelven todas, para no romper a los consumidores actuales.
  const limite = Math.min(Math.max(Math.floor(Number(c.req.query("limite") ?? 0)) || 0, 0), 200);
  if (!limite) return c.json(listado);

  type ClaveOrden = { flag: number; pin: string; fecha: string; rowid: number };
  const claveDe = (v: (typeof listado)[number]): ClaveOrden => ({
    flag: v.pinned_at ? 0 : 1,
    pin: v.pinned_at ?? "",
    fecha: v.created_at,
    rowid: v.conv_rowid,
  });
  // Devuelve <0 si a va antes que b en el orden del listado (desc en fecha y rowid).
  const compararOrden = (a: ClaveOrden, b: ClaveOrden): number => {
    if (a.flag !== b.flag) return a.flag - b.flag;
    if (a.flag === 0 && a.pin !== b.pin) return a.pin > b.pin ? -1 : 1;
    if (a.fecha !== b.fecha) return a.fecha > b.fecha ? -1 : 1;
    return b.rowid - a.rowid;
  };
  const partes = (c.req.query("antes") ?? "").split(";");
  const [fS = "", pinS = "", fechaS = "", rowS = ""] = partes;
  const hayCursor = (fS === "0" || fS === "1") && fechaS.length > 0 && Number.isFinite(Number(rowS));
  const cursor: ClaveOrden | null = hayCursor ? { flag: Number(fS), pin: pinS, fecha: fechaS, rowid: Number(rowS) } : null;
  const inicio = cursor ? listado.findIndex((v) => compararOrden(claveDe(v), cursor) > 0) : 0;
  if (inicio === -1) return c.json({ conversations: [], siguiente: null });
  const pagina = listado.slice(inicio, inicio + limite);
  // El cursor es la clave de la ÚLTIMA fila entregada: la página siguiente echa de después de ella,
  // así no se pierde ninguna conversación entre tandas. Si no queda nada después, no se anuncia.
  const ultima = pagina[pagina.length - 1];
  const hayDetras = listado[inicio + pagina.length] !== undefined;
  const siguiente = ultima && hayDetras
    ? encodeURIComponent(`${ultima.pinned_at ? 0 : 1};${ultima.pinned_at ?? ""};${ultima.created_at};${ultima.conv_rowid}`)
    : null;
  return c.json({ conversations: pagina, siguiente });
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
  eliminarPerfilCodex(id);
  for (const perfil of perfilesHijos) eliminarPerfilSubagentes(perfil);
  return c.json({ ok: true });
});

// Pasos del agente de un turno (el id es el del mensaje del usuario). Se piden al abrir "Ver proceso".
chat.get("/conversations/:id/turnos/:turno/actividad", (c) => {
  return c.json(actividadDelTurno(c.req.param("id"), c.req.param("turno")));
});

chat.get("/conversations/:id/turnos/:turno/uso", (c) => {
  const conversationId = c.req.param("id");
  const turnId = c.req.param("turno");
  if (!db.query("SELECT 1 FROM conversations WHERE id=?").get(conversationId)) {
    return c.json({ error: "conversation_not_found" }, 404);
  }
  if (!db.query("SELECT 1 FROM messages WHERE id=? AND conversation_id=? AND role='user'").get(turnId, conversationId)) {
    return c.json({ error: "turn_not_found" }, 404);
  }
  const porEtapa = db.query<{
    role: string; provider: string; model: string; calls: number;
    tokensMedidos: number; tokensEstimados: number; sinTokens: number;
    costeEstimadoUsd: number; sinCoste: number; costeDesconocido: number;
  }, [string, string]>(`
    SELECT usage_role AS role, provider, model, COUNT(*) AS calls,
           COALESCE(SUM(CASE WHEN tokens_precision='medida' THEN input_tokens+output_tokens ELSE 0 END),0) AS tokensMedidos,
           COALESCE(SUM(CASE WHEN tokens_precision='estimado' THEN input_tokens+output_tokens ELSE 0 END),0) AS tokensEstimados,
           COALESCE(SUM(tokens_precision IN ('no_disponible','desconocida')),0) AS sinTokens,
           COALESCE(SUM(CASE WHEN cost_precision='estimado' THEN cost ELSE 0 END),0) AS costeEstimadoUsd,
           COALESCE(SUM(cost_precision='no_disponible'),0) AS sinCoste,
           COALESCE(SUM(cost_precision='desconocida'),0) AS costeDesconocido
      FROM usage WHERE conversation_id=? AND turn_id=?
     GROUP BY usage_role,provider,model ORDER BY usage_role,provider,model
  `).all(conversationId, turnId);
  const mensajes = db.query<{ inicio: string; rowid: number }, [string, string]>(
    "SELECT created_at AS inicio,rowid FROM messages WHERE id=? AND conversation_id=? AND role='user'",
  ).get(turnId, conversationId)!;
  const duracionMs = db.query<{ ms: number | null }, [string, number, string, number, string]>(`
    SELECT CAST((julianday((
      SELECT MIN(a.created_at) FROM messages a
       WHERE a.conversation_id=? AND a.role='assistant' AND a.rowid>?
         AND a.rowid<COALESCE((SELECT MIN(siguiente.rowid) FROM messages siguiente
                                WHERE siguiente.conversation_id=? AND siguiente.role='user' AND siguiente.rowid>?),9223372036854775807)
    ))-julianday(?))*86400000 AS INTEGER) AS ms
  `).get(conversationId, mensajes.rowid, conversationId, mensajes.rowid, mensajes.inicio)?.ms ?? null;
  return c.json({
    turnId,
    duracionMs,
    llamadas: porEtapa.reduce((suma, fila) => suma + fila.calls, 0),
    tokensMedidos: porEtapa.reduce((suma, fila) => suma + fila.tokensMedidos, 0),
    tokensEstimados: porEtapa.reduce((suma, fila) => suma + fila.tokensEstimados, 0),
    sinTokens: porEtapa.reduce((suma, fila) => suma + fila.sinTokens, 0),
    costeEstimadoUsd: porEtapa.reduce((suma, fila) => suma + fila.costeEstimadoUsd, 0),
    sinCoste: porEtapa.reduce((suma, fila) => suma + fila.sinCoste, 0),
    costeDesconocido: porEtapa.reduce((suma, fila) => suma + fila.costeDesconocido, 0),
    porEtapa,
  });
});

chat.get("/conversations/:id/turnos/:turno/subagentes", (c) => {
  const conversationId = c.req.param("id");
  const turnId = c.req.param("turno");
  if (!db.query("SELECT 1 FROM conversations WHERE id=?").get(conversationId)) {
    return c.json({ error: "conversation_not_found" }, 404);
  }
  const filas = db.query<Subchat, [string, string]>(`
    SELECT c.id,c.work_mode,c.title,c.model,c.effort,c.project_id,p.name AS project_name,c.parent_conversation_id,c.parent_turn_id,
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
  const id = c.req.param("id");
  const numero = (nombre: string) => {
    const valor = c.req.query(nombre);
    if (valor === undefined) return null;
    if (!/^\d+$/.test(valor) || !Number.isSafeInteger(Number(valor))) throw new Error("invalid_cursor");
    return Number(valor);
  };
  try {
    const antes = numero("antes"), desde = numero("desde");
    let despues = numero("despues");
    const ultimoId = c.req.query("ultimoId");
    const limite = Math.min(100, Math.max(1, numero("limite") ?? 40));
    if (antes !== null && despues !== null) return c.json({ error: "invalid_cursor" }, 400);
    // SQLite puede reutilizar el último rowid tras borrar un aviso de reintento.
    // Si desapareció el ancla, reconstruimos la página reciente en vez de saltar filas.
    const clave = (cursor: number) => db.query<{ created_at: string; cursor: number }, [string, number]>("SELECT created_at,rowid AS cursor FROM messages WHERE conversation_id=? AND rowid=?").get(id, cursor);
    const inicio = desde !== null ? clave(desde) : null;
    const reiniciar = despues !== null && ((desde !== null && !inicio) || (ultimoId !== undefined && !db.query("SELECT 1 FROM messages WHERE conversation_id=? AND rowid=? AND id=?").get(id, despues, ultimoId)));
    if (reiniciar) despues = null;
    const ancla = despues !== null || antes !== null ? clave(despues ?? antes!) : { created_at: "\uffff", cursor: Number.MAX_SAFE_INTEGER };
    if (!ancla) return c.json({ error: "invalid_cursor" }, 400);
    const columnas = "rowid AS cursor,id,conversation_id,role,content,created_at,model,effort,sesion_compactada";
    const filas = db.query<Message & { cursor: number }, [string, string, number, number]>(
      `SELECT ${columnas} FROM messages WHERE conversation_id=? AND (created_at,rowid) ${despues !== null ? ">=" : "<"} (?,?) ORDER BY created_at ${despues !== null ? "ASC" : "DESC"},rowid ${despues !== null ? "ASC" : "DESC"} LIMIT ?`,
    ).all(id, ancla.created_at, ancla.cursor, limite);
    if (despues === null) filas.reverse();
    let turnoAnterior = filas[0] ? db.query<{ id: string; created_at: string }, [string, string, number]>(
      "SELECT id,created_at FROM messages WHERE conversation_id=? AND role='user' AND (created_at,rowid)<(?,?) ORDER BY created_at DESC,rowid DESC LIMIT 1",
    ).get(id, filas[0].created_at, filas[0].cursor) : null;
    const messages = filas.map((mensaje) => {
      if (mensaje.role === "user") turnoAnterior = mensaje;
      return { ...mensaje, turno_id: mensaje.role === "user" ? null : turnoAnterior?.id ?? null, turno_created_at: mensaje.role === "user" ? null : turnoAnterior?.created_at ?? null };
    });
    // Compatibilidad: los consumidores antiguos reciben una lista, también acotada.
    if (c.req.query("pagina") !== "1") return c.json(messages);
    const primero = filas[0] ?? ancla;
    const ultimo = filas.at(-1) ?? ancla;
    const anterior = db.query("SELECT 1 FROM messages WHERE conversation_id=? AND (created_at,rowid)<(?,?) LIMIT 1").get(id, primero.created_at, primero.cursor) ? primero.cursor : null;
    const mas = Boolean(db.query("SELECT 1 FROM messages WHERE conversation_id=? AND (created_at,rowid)>(?,?) LIMIT 1").get(id, ultimo.created_at, ultimo.cursor));
    // Solo metadatos de la ventana residente: reconciliamos avisos borrados y compactación
    // sin retransmitir su contenido en cada sondeo.
    const vigentes = inicio && !reiniciar ? db.query<{ id: string; sesion_compactada: number }, [string, string, number, string, number]>(
      "SELECT id,sesion_compactada FROM messages WHERE conversation_id=? AND (created_at,rowid)>=(?,?) AND (created_at,rowid)<=(?,?) ORDER BY created_at,rowid LIMIT 201",
    ).all(id, inicio.created_at, inicio.cursor, ultimo.created_at, ultimo.cursor) : [];
    return c.json({ messages, anterior, ultimo: ultimo.cursor, mas, vigentes, reiniciar: reiniciar || vigentes.length > 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_cursor") return c.json({ error: "invalid_cursor" }, 400);
    throw error;
  }
});

chat.get("/conversations/:id/messages/:mensaje", (c) => {
  const mensaje = db.query<Message, [string, string]>("SELECT id,conversation_id,role,content,created_at,model,effort,sesion_compactada FROM messages WHERE conversation_id=? AND id=?").get(c.req.param("id"), c.req.param("mensaje"));
  return mensaje ? c.json(mensaje) : c.json({ error: "message_not_found" }, 404);
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
    SELECT c.id, c.work_mode, c.title, c.provider, c.model, c.effort,
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
      FROM usage WHERE conversation_id=? AND usage_role IN ('unknown','supervisor','analyzer','worker') ORDER BY created_at DESC, rowid DESC LIMIT 1
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
  const conv = leerConversacion(id);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  if (conv.parent_conversation_id) return c.json({ error: "subagent_read_only" }, 409);
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

// Documento activo en origen opaco: nunca hereda permisos ni la CSP de la aplicación.
chat.get("/conversations/:id/archivo-html", (c) => {
  const conversacion = leerConversacion(c.req.param("id"));
  if (!conversacion) return c.json({ error: "conversation_not_found" }, 404);
  try {
    const ruta = normalizarRuta(c.req.query("ruta"));
    if (!/\.html?$/i.test(ruta.join("/"))) return c.json({ error: "unsupported_file_type" }, 400);
    const archivo = leerEnRaices(raicesArchivosConversacion(conversacion), raiz => ({ ...leerArchivo(raiz, ruta), raiz }));
    if (archivo.truncado) return c.json({ error: "file_too_large" }, 413);
    for (const [token, permiso] of permisosPreview) if (permiso.vence <= Date.now()) permisosPreview.delete(token);
    while (permisosPreview.size >= 32) permisosPreview.delete(permisosPreview.keys().next().value!);
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    permisosPreview.set(token, { conversacion: conversacion.id, raiz: archivo.raiz, sesion: getCookie(c, COOKIE_SESION), vence: Date.now() + DURACION_PREVIEW_MS });
    return c.redirect(`/api/conversations/${encodeURIComponent(conversacion.id)}/preview-html/${token}/${ruta.map(encodeURIComponent).join("/")}`, 302);
  } catch (err) {
    if (err instanceof ArchivoError) return c.json({ error: err.code }, err.status);
    throw err;
  }
});

chat.get("/conversations/:id/preview-html/:token/*", (c) => {
  const permiso = permisoPreview(c.req.raw);
  if (!permiso) return c.json({ error: "preview_expired" }, 401);
  try {
    const prefijo = `/api/conversations/${encodeURIComponent(permiso.conversacion)}/preview-html/${c.req.param("token")}/`;
    const ruta = normalizarRuta(decodeURIComponent(new URL(c.req.url).pathname.slice(prefijo.length)));
    const cabeceras = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Frame-Options": "SAMEORIGIN",
    };
    if (/\.html?$/i.test(ruta.at(-1) ?? "")) {
      const archivo = leerArchivo(permiso.raiz, ruta);
      if (archivo.truncado) return c.json({ error: "file_too_large" }, 413);
      const recursos = `${new URL(c.req.url).origin}${prefijo}`;
      return new Response(archivo.texto, { headers: { ...cabeceras,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${recursos}; style-src 'unsafe-inline' ${recursos}; img-src data: blob: ${recursos}; font-src data: ${recursos}; media-src data: blob: ${recursos}; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
      } });
    }
    const archivo = leerRecursoHtml(permiso.raiz, ruta);
    return new Response(archivo.stream(), { headers: { ...cabeceras, "Content-Type": archivo.mime, "Content-Length": String(archivo.tamano), "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" } });
  } catch (error) {
    if (error instanceof ArchivoError) return c.json({ error: error.code }, error.status);
    if (error instanceof URIError) return c.json({ error: "invalid_project_path" }, 400);
    throw error;
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
      archivo.cerrar();
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rango = c.req.header("range");
    if (!rango) {
      // El archivo se sirve por streaming desde el disco, sin cargarlo en RAM.
      return new Response(archivo.stream(), {
        headers: { ...cabeceras, "Content-Length": String(archivo.tamano) },
      });
    }

    const coincide = /^bytes=(\d+)-(\d*)$/.exec(rango);
    if (!coincide) {
      archivo.cerrar();
      return new Response(null, {
        status: 416,
        headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` },
      });
    }
    const inicio = Number(coincide[1]);
    const fin = coincide[2] ? Math.min(Number(coincide[2]), archivo.tamano - 1) : archivo.tamano - 1;
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fin) || inicio >= archivo.tamano || fin < inicio) {
      archivo.cerrar();
      return new Response(null, {
        status: 416,
        headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` },
      });
    }
    return new Response(archivo.stream(inicio, fin), {
      status: 206,
      headers: {
        ...cabeceras,
        "Content-Length": String(fin - inicio + 1),
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
      archivo.cerrar();
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre: archivo.nombre, mime: archivo.mime, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new Response(archivo.stream(), {
      headers: { ...cabeceras, "Content-Length": String(archivo.tamano) },
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
      archivo.cerrar();
      return new Response(JSON.stringify({ ruta: archivo.ruta, nombre: archivo.nombre, mime: archivo.mime, tamano: archivo.tamano }), {
        headers: { ...cabeceras, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rango = c.req.header("range");
    if (!rango) {
      // El video se sirve por streaming desde el disco; la RAM no carga nunca el archivo entero.
      return new Response(archivo.stream(), {
        headers: { ...cabeceras, "Content-Length": String(archivo.tamano) },
      });
    }

    const coincide = /^bytes=(\d+)-(\d*)$/.exec(rango);
    if (!coincide) {
      archivo.cerrar();
      return new Response(null, { status: 416, headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` } });
    }
    const inicio = Number(coincide[1]);
    const fin = coincide[2] ? Math.min(Number(coincide[2]), archivo.tamano - 1) : archivo.tamano - 1;
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fin) || inicio >= archivo.tamano || fin < inicio) {
      archivo.cerrar();
      return new Response(null, { status: 416, headers: { ...cabeceras, "Content-Range": `bytes */${archivo.tamano}` } });
    }
    return new Response(archivo.stream(inicio, fin), {
      status: 206,
      headers: {
        ...cabeceras,
        "Content-Length": String(fin - inicio + 1),
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
    "SELECT id,work_mode,title,status,model,modelo_agotado,effort,plan,reporte,plan_aprobado_en,plan_hash,approved_hash,error,conversation_id,created_at,started_at,finished_at FROM tasks WHERE conversation_id=? ORDER BY created_at,rowid",
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
        "SELECT c.id,c.work_mode,c.model,c.effort,c.runner_session_id,c.runner_session_model,c.project_id,c.cuota_modelo,c.parent_conversation_id,c.subagent_workspace,c.subagent_config_dir,c.orquestacion_habilitada,c.orquestacion_modelos_personalizados,c.orquestacion_seleccion_automatica,c.orquestacion_trabajadores,p.repo_path AS repo_path FROM conversations c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=?",
      )
      .get(id) ?? null
  );
}

function raicesArchivosConversacion(conversacion: ConversationRow): string[] {
  const workspaces = db.query<{ workspace: string }, [string]>(
    "SELECT workspace FROM tasks WHERE conversation_id=? AND workspace IS NOT NULL ORDER BY created_at DESC,rowid DESC",
  ).all(conversacion.id).map((tarea) => tarea.workspace);
  // Los turnos normales de chat siempre escriben en chat-workspace, incluso si la conversación
  // está vinculada a un proyecto. El repositorio también es una raíz válida para sus archivos.
  const raizChat = conversacion.subagent_workspace
    ?? join(carpetaWorkspaceChat(), conversacion.parent_conversation_id ?? conversacion.id);
  return [...new Set([
    ...[...workspaces, raizChat, ...(conversacion.repo_path ? [conversacion.repo_path] : [])].map(carpetaEntregables),
    ...workspaces,
    raizChat,
    ...(conversacion.project_id && conversacion.repo_path ? [conversacion.repo_path] : []),
  ])];
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
function encolarTurno(conv: ConversationRow, turno: TurnoUsuario, model: string): string {
  const anterior = tareaDelChat(conv.id);
  if (anterior) {
    db.query("UPDATE repository_actions SET state='superseded' WHERE task_id=? AND state='pending'").run(anterior.id);
  }
  db.query("UPDATE conversations SET cuota_modelo=NULL WHERE id=?").run(conv.id);
  return crearTarea({
    prompt: turno.content,
    workMode: turno.work_mode ?? conv.work_mode,
    model,
    effort: conv.effort,
    projectId: conv.project_id,
    conversationId: conv.id,
    messageId: turno.id,
    providerSessionId: conv.runner_session_id || null,
    providerSessionModel: conv.runner_session_model,
  });
}

// El mensaje del usuario se guarda antes de ejecutar: así aparece en los demás dispositivos
// y no se pierde si el agente falla.
function guardarMensajeUsuario(conversationId: string, content: string): TurnoUsuario {
  const work_mode = db.query<{work_mode: "plan" | "build"}, [string]>("SELECT work_mode FROM conversations WHERE id=?").get(conversationId)?.work_mode ?? "build";
  const msg: TurnoUsuario = { work_mode, id: crypto.randomUUID(), role: "user", content };
  let delegacionOrigen: string | null = null;
  db.transaction(() => {
    delegacionOrigen = origenDelegacionParaMensaje(conversationId, content, msg.id);
    db.query("INSERT INTO messages (id, conversation_id, role, content, delegacion_origen, work_mode) VALUES (?, ?, ?, ?, ?, ?)").run(
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      delegacionOrigen,
      work_mode,
    );
    db.query("UPDATE conversations SET title = ? WHERE id = ? AND title = 'Nuevo chat'").run(
      content.replace(/<<telo-imagen id="[a-f\d-]{36}" nombre="[^"]*">>/gi, "[Imagen adjunta]").trim().slice(0, 60) || "Imagen adjunta",
      conversationId,
    );
  })();
  return msg;
}

export function esContinuacionDelegada(content: string): boolean {
  const texto = content.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return /^(?:(?:sigue|seguir|continua|continuar|reanuda|reanudar|retoma|retomar)(?:\s+(?:donde\s+(?:se\s+)?quedo|desde\s+donde\s+quedo|con\s+(?:eso|lo\s+mismo|la\s+tarea)))?|continue(?:\s+where\s+(?:you\s+)?left\s+off)?|resume|keep going|pick up where you left off)[.!…]*$/.test(texto);
}

export function origenDelegacionParaMensaje(conversationId: string, content: string, messageId: string): string | null {
  if (pideSubagentes(content)) return messageId;
  if (!esContinuacionDelegada(content)) return null;

  const ultimaRespuesta = db.query<{ rowid: number | null }, [string]>(
    "SELECT MAX(rowid) AS rowid FROM messages WHERE conversation_id=? AND role='assistant'",
  ).get(conversationId)?.rowid ?? 0;
  const anteriores = db.query<{ id: string; content: string; delegacion_origen: string | null }, [string, number]>(
    "SELECT id,content,delegacion_origen FROM messages WHERE conversation_id=? AND role='user' AND rowid>? ORDER BY rowid DESC LIMIT 32",
  ).all(conversationId, ultimaRespuesta);

  for (const anterior of anteriores) {
    if (anterior.delegacion_origen) return anterior.delegacion_origen;
    if (pideSubagentes(anterior.content)) {
      db.query("UPDATE messages SET delegacion_origen=? WHERE id=? AND conversation_id=?")
        .run(anterior.id, anterior.id, conversationId);
      return anterior.id;
    }
    if (!esContinuacionDelegada(anterior.content)) return null;
  }
  return null;
}

function marcarDelegacionConsumida(conversationId: string, origen: string | null): void {
  if (!origen) return;
  db.query("UPDATE messages SET delegacion_consumida=1 WHERE id=? AND conversation_id=?").run(origen, conversationId);
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
  const original = db.query<{ id: string; content: string; work_mode: "plan" | "build"; rowid: number }, [string, string]>(
    "SELECT id, content, work_mode, rowid FROM messages WHERE id=? AND conversation_id=? AND role='user'",
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
  return { turno: { id: original.id, role: "user", content: original.content, work_mode: original.work_mode }, rowid: original.rowid, continuar };
}

function limpiarAvisosReintentados(conversationId: string, rowid: number | undefined): void {
  if (rowid === undefined) return;
  db.query("DELETE FROM messages WHERE conversation_id=? AND role='system' AND rowid>?").run(conversationId, rowid);
}

// La duración o el silencio no cancelan el turno; el usuario conserva la cancelación explícita.
const TIEMPO_TURNO_MS = null;
const TIEMPO_SIN_ACTIVIDAD_MS = null;
const controlesTurno = new Map<string, AbortController>();
const pausasDespliegueTurnos = new Set<string>();

chat.post("/conversations/:id/detener", c => {
  const conv = leerConversacion(c.req.param("id"));
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  if (conv.parent_conversation_id) return c.json({ error: "subagent_readonly" }, 403);
  const control = controlesTurno.get(conv.id);
  if (control) {
    control.abort();
    // Detener cancela el turno y también la cola: nada se ejecuta «por sorpresa» después.
    const enCola = contarCola(conv.id);
    if (enCola > 0) {
      limpiarCola(conv.id);
      guardarAviso(conv.id, enCola === 1
        ? "El agente se detuvo y el mensaje en cola no se ejecutó. Envíalo de nuevo para continuar."
        : `El agente se detuvo y los ${enCola} mensajes en cola quedaron sin ejecutar. Envíalos de nuevo para continuar.`);
    }
    return c.json({ outcome: "cancelling" }, 202);
  }
  const tareas = db.query<{ id: string }, [string]>(
    "SELECT id FROM tasks WHERE conversation_id=? AND status IN ('queued','analyzing','running','waiting_approval')",
  ).all(conv.id);
  if (tareas.length) {
    const resultados = tareas.map((tarea) => cancelTask(tarea.id));
    const outcome = resultados.includes("cancelling") ? "cancelling" : "cancelled";
    return c.json({ outcome }, outcome === "cancelling" ? 202 : 200);
  }
  // Nada activo registrado, pero el chat figura ocupado: la ocupación quedó huérfana (p. ej. el
  // runner terminó sin avisar). Se libera para que el chat no aparezca respondiendo para siempre.
  if (conversacionEnCurso(conv.id)) {
    liberarConversacion(conv.id);
    publicarChat(conv.id, "terminado");
    return c.json({ outcome: "liberado" });
  }
  return c.json({ outcome: "not_running" });
});

// Avisa a los clientes que un turno empezó o terminó. Los demás dispositivos piden de nuevo el chat.
function publicarChat(conversationId: string, estado: "en_curso" | "terminado"): void {
  publicar({ tipo: "chat", conversacion_id: conversationId, estado });
}

// Corre el agente para un turno del chat y guarda su respuesta. Nunca lanza: cualquier fallo queda
// como aviso en el chat, porque nadie espera ya la respuesta HTTP.
async function correrTurno(conv: ConversationRow, turno: TurnoUsuario, prompt: string, model: string, signal: AbortSignal): Promise<void> {
  const conversationId = conv.id;
  let result: ResultadoAgente;
  let turnoTerminado = false;
  let huboSubagentes = false;
  let perfilesSubagente: Awaited<ReturnType<typeof prepararSubagentes>> = null;
  try {
    registrarActividad(conversationId, turno.id, {
      tipo: "texto",
      texto: `Solicitud recibida. Preparando contexto para el modelo ${model}.`,
    });
    const cwd = conv.subagent_workspace || join(carpetaWorkspaceChat(), conv.parent_conversation_id ?? conversationId);
    mkdirSync(cwd, { recursive: true });
    const mensajeDelegacion = db.query<{ delegacion_origen: string | null }, [string, string]>(
      "SELECT delegacion_origen FROM messages WHERE id=? AND conversation_id=? AND role='user'",
    ).get(turno.id, conversationId);
    let delegacionOrigen = mensajeDelegacion?.delegacion_origen ??
      (pideSubagentes(turno.content) || pideSubagentes(prompt) ? turno.id : null);
    if (delegacionOrigen && !mensajeDelegacion?.delegacion_origen) {
      db.query("UPDATE messages SET delegacion_origen=? WHERE id=? AND conversation_id=?")
        .run(delegacionOrigen, turno.id, conversationId);
    }
    const delegacionSolicitada = Boolean(delegacionOrigen);
    const analisisOrquestado = delegacionSolicitada && !conv.parent_conversation_id
      ? await ejecutarAnalisisOrquestado(conv, turno.id, delegacionOrigen ?? turno.id, prompt, cwd, signal, model)
      : [];

    // Los subagentes no crean otra generación de subchats: el usuario sigue al supervisor y a sus hijos directos.
    perfilesSubagente = conv.parent_conversation_id
      ? null
      : conv.orquestacion_habilitada || delegacionSolicitada
        ? null
        : await prepararSubagentes({ prompt, modelo: model, esfuerzo: conv.effort, idEjecucion: crypto.randomUUID(), soloLectura: true });
    const configSubagentes = perfilesSubagente?.directorio ?? conv.subagent_config_dir ?? undefined;
    const promptCoordinador = [
      ...analisisOrquestado,
      perfilesSubagente ? `${perfilesSubagente.instruccion}\n\n${prompt}` : prompt,
    ].join("\n\n");
    registrarActividad(conversationId, turno.id, {
      tipo: "texto",
      texto: `Contexto preparado. Solicitud enviada al modelo ${model}; esperando actividad observable del proveedor.`,
    });
    const inicioSupervisor = Date.now();
    const opcionesEjecucion: OpcionesAgente = {
      workMode: turno.work_mode ?? conv.work_mode,
      solicitudSkills: turno.content,
      modelosAuxiliares: perfilesSubagente?.modelos,
      prompt: promptCoordinador,
      model,
      variant: conv.effort,
      sessionId: conv.runner_session_id,
      sessionModel: conv.runner_session_model,
      cwd,
      timeoutMs: TIEMPO_TURNO_MS,
      tiempoSinActividadMs: TIEMPO_SIN_ACTIVIDAD_MS,
      signal,
      projectId: conv.project_id,
      conversationId,
      turnId: turno.id,
      usageRole: "supervisor",
      estilo: "chat",
      opencodeConfigDir: configSubagentes,
      opencodeSubagentesTracePath: perfilesSubagente?.rutaCaptura,
      onSubagente: perfilesSubagente ? (linea) => {
        try {
          if ((JSON.parse(linea) as { kind?: string }).kind === "created") {
            huboSubagentes = true;
            marcarDelegacionConsumida(conversationId, delegacionOrigen);
          }
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
        if (!item) return;
        registrarActividad(conversationId, turno.id, item.tipo === "accion"
          ? {
              ...item,
              titulo: `[Supervisor] ${item.titulo}`.slice(0, 160),
              ...(item.callId ? { callId: `supervisor:${item.callId}` } : {}),
            }
          : item);
      },
      onCambioModeloCuota: (agotado, siguiente) => {
        registrarActividad(conversationId, turno.id, {
          tipo: "texto",
          texto: `Se agotó la cuota de ${agotado}; continúo automáticamente con ${siguiente}.`,
        });
      },
    };
    result = await ejecutarAgente(opcionesEjecucion);
    if ((turno.work_mode ?? conv.work_mode) !== "plan" && requiereEntregaVideo(turno.content)) {
      const raices = raicesArchivosConversacion(conv);
      let rutaVideo = buscarVideoVerificado(result.textoFinal, raices);
      if (!rutaVideo) {
        registrarActividad(conversationId, turno.id, {
          tipo: "texto",
          texto: "La respuesta todavía no incluye un MP4 verificable; estoy comprobando el workspace y la carpeta de entregables antes de cerrar el turno.",
        });
        const respuestaAnterior = result;
        result = await ejecutarAgente({
          ...opcionesEjecucion,
          model: respuestaAnterior.modelo || model,
          variant: respuestaAnterior.variante,
          sessionId: respuestaAnterior.sessionId,
          sessionModel: respuestaAnterior.modelo || model,
          prompt: promptRecuperarEntregaVideo(turno.content, respuestaAnterior.textoFinal),
        });
        rutaVideo = buscarVideoVerificado(result.textoFinal, raices);
      }
      if (rutaVideo) {
        result = { ...result, textoFinal: anexarEnlaceVideo(result.textoFinal, rutaVideo) };
      } else {
        result = {
          ...result,
          textoFinal: `${result.textoFinal.trim()}\n\n**Entrega incompleta:** No encontré un MP4 válido en las carpetas accesibles del chat después de intentar recuperar la entrega. No puedo confirmar que el video esté entregado; vuelve a pedir que genere y enlace el archivo si el bloqueo persiste.`,
        };
      }
    }
    registrarActividad(conversationId, turno.id, {
      tipo: "texto",
      texto: `El supervisor terminó y verificó la respuesta en ${((Date.now() - inicioSupervisor) / 1000).toFixed(1)} s; guardando el resultado.`,
    });
    turnoTerminado = true;
  } catch (err) {
    if (pausasDespliegueTurnos.has(conversationId)) {
      guardarAviso(conversationId, "La respuesta se pausó para aplicar una actualización. El mensaje, los cambios y la sesión disponible se conservan; cuando el servidor vuelva, pulsa Continuar donde quedó.");
      return;
    }
    if (signal.aborted) {
      guardarAviso(conversationId, "Ejecución detenida por ti. El trabajo y la sesión disponibles se conservan; puedes continuar donde quedó.");
      return;
    }
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

    // Si el proceso de este turno compactó el contexto, la respuesta queda marcada para el hilo.
    marcarRespuestaCompactada(assistantMsg.id, conversationId, turno.id);

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
  const finalizarTrabajo = registrarTrabajo();
  const control = new AbortController();
  controlesTurno.set(conv.id, control);
  const dejarDePausar = registrarPausaActiva(() => {
    if (control.signal.aborted) return;
    pausasDespliegueTurnos.add(conv.id);
    control.abort();
  });
  ocuparConversacion(conv.id);
  publicarChat(conv.id, "en_curso");
  void correrTurno(conv, turno, prompt, model, control.signal)
    .catch((err) => {
      // correrTurno no lanza; esto solo cubre un fallo al guardar la respuesta.
      console.error("Turno del chat:", mensajeSeguro(err));
      guardarAviso(conv.id, "No se pudo guardar la respuesta. Intenta de nuevo.");
    })
    .finally(() => {
      finalizarTrabajo();
      dejarDePausar();
      controlesTurno.delete(conv.id);
      pausasDespliegueTurnos.delete(conv.id);
      liberarConversacion(conv.id);
      publicarChat(conv.id, "terminado");
      notifyWorker();
      arrancarSiguienteEnCola(conv.id);
    });
}

// Tarea 12: cola de mensajes de los chats libres. Se guarda con la bandera en_cola en la fila
// del mensaje y aquí se cuenta la de una conversación.
function contarCola(conversationId: string): number {
  return (
    db.query<{ n: number }, [string]>(
      "SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND role='user' AND en_cola=1",
    ).get(conversationId)?.n ?? 0
  );
}

function limpiarCola(conversationId: string): void {
  db.query("UPDATE messages SET en_cola = 0 WHERE conversation_id = ? AND role = 'user' AND en_cola = 1").run(conversationId);
}

// Al terminar un turno arranca el mensaje en cola más antiguo, en el orden de llegada. El
// reinicio del servidor no llega aquí: los avisos de arranque limpian la bandera antes, así
// que un pendiente jamás se ejecuta solo tras reiniciar.
export function arrancarSiguienteEnCola(conversationId: string): void {
  if (pausaTareasPorDespliegue()) return;
  const conv = leerConversacion(conversationId);
  if (!conv || conversacionEnCurso(conversationId)) return;
  const pendiente = db
    .query<{ id: string; content: string; work_mode: "plan" | "build" }, [string]>(
      "SELECT id, content, work_mode FROM messages WHERE conversation_id=? AND role='user' AND en_cola=1 ORDER BY created_at ASC, rowid ASC LIMIT 1",
    )
    .get(conversationId);
  if (!pendiente) return;
  if (conv.cuota_modelo) return; // Cuota agotada: espera el «Seguir» del usuario.
  db.query("UPDATE messages SET en_cola = 0 WHERE id = ?").run(pendiente.id);
  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  iniciarTurno(conv, { id: pendiente.id, role: "user", content: pendiente.content, work_mode: pendiente.work_mode }, pendiente.content, model);
}

// Al arrancar el servidor no hay turnos en curso. Si el último mensaje de un chat es del usuario, la
// respuesta se perdió al reiniciarse: se avisa en el chat para que el usuario lo envíe de nuevo.
export function avisarTurnosInterrumpidos(): number {
  // Los pendientes en cola pasan a mensajes guardados sin bandera: un reinicio no ejecuta turnos
  // por su cuenta y el aviso de abajo ya pide volver a enviar lo que quedó a medias.
  db.query("UPDATE messages SET en_cola = 0").run();
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
  if (conv.parent_conversation_id) return c.json({ error: "subagent_read_only" }, 409);

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
  // Tarea 12: mientras el agente responde, un mensaje nuevo queda en cola en vez de rechazarse
  // (409 conversation_busy). Los reintentos no se encolan (retoman la sesión propia del turno
  // terminado) y un proyecto en revisión de Git bloquea solo un instante: ambos fallan como hoy.
  const encolable = bloqueo === "conversation_busy" && !retryOf;
  if (bloqueo && !encolable) return c.json({ error: bloqueo }, 409);
  const tareaActual = conv.project_id ? tareaDelChat(conversationId) : null;
  const modeloAgotado = conv.cuota_modelo ?? (tareaActual?.status === "sin_cuota"
    ? tareaActual.modelo_agotado ?? tareaActual.model
    : null);
  if (modeloAgotado) return c.json({ error: "chat_quota_pending" }, 409);
  if (encolable) {
    const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
    if (conv.project_id) {
      // Los chats de proyecto encolan con su cola propia de tareas: el worker las corre en orden.
      const turno = guardarMensajeUsuario(conversationId, content);
      const taskId = encolarTurno(conv, turno, model);
      return c.json({ messages: [turno], taskId }, 202);
    }
    const turno = guardarMensajeUsuario(conversationId, content);
    db.query("UPDATE messages SET en_cola = 1 WHERE id = ?").run(turno.id);
    return c.json({ messages: [turno], enColados: contarCola(conversationId) }, 202);
  }

  // Fusionar un PR existente por número es una acción directa: no debe crear una tarea ni otra rama.
  const numeroPr = numeroPullRequestParaFusionar(content);
  // Las demás órdenes directas de Git crean una tarjeta de autorización, sin ejecutar al agente.
  // Solo atajos inequívocos. Una pregunta o un encargo con detalles llega al agente.
  const pedido = /^(?:(?:haz|hacer|ejecuta|realiza|crea|crear|prepara|reintenta|por favor)\s+)*(?:de nuevo\s+)?(?:(?:un|el)\s+)?(?:git\s+(init|commit|push)|(?:un\s+)?(commit|push|pr)|(?:gh\s+pr\s+create)|(pull request))(?:\s+(?:(?:y|and|&)\s+(?:git\s+)?(?:push|pr)|sin\s+push))?[.!]?$/i.exec(content.trim());
  if ((reintento?.turno.work_mode ?? conv.work_mode) !== "plan" && (pedido || numeroPr !== null) && conv.project_id) {
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
    const taskId = encolarTurno(conv, turno, model);
    publicarChat(conversationId, "en_curso");
    return c.json({ messages: [turno], taskId }, 202);
  }
  const promptTurno = reintento?.continuar
    ? promptContinuacion(SEGUIR_INSTRUCCION, sesionCompatible(conv.runner_session_id, conv.runner_session_model, model))
    : content;
  iniciarTurno(conv, turno, promptTurno, model);
  return c.json({ messages: [turno] }, 202);
});

// DELETE /api/conversations/:id/messages/:mensajeId (Tarea 12): se retira un mensaje en cola
// antes de que arranque su turno. Solo acepta filas todavía marcadas; si ya arrancó, 404 igual
// que un mensaje que no existe.
chat.delete("/conversations/:id/messages/:mensajeId", (c) => {
  const conversationId = c.req.param("id");
  const mensajeId = c.req.param("mensajeId");
  const conv = leerConversacion(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  const pendiente = db
    .query("SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user' AND en_cola = 1")
    .get(mensajeId, conversationId);
  if (!pendiente) return c.json({ error: "no_esta_en_cola" }, 404);
  db.query("DELETE FROM messages WHERE id = ?").run(mensajeId);
  return c.json({ ok: true, enColados: contarCola(conversationId) });
});

// POST /api/conversations/:id/seguir
// Tras una cuota agotada: el chat retoma su sesión con el modelo elegido, desde donde se quedó.
// Si el modelo falló antes de abrir sesión, no hay nada que retomar: se vuelve a enviar el mensaje sin respuesta.
chat.post("/conversations/:id/seguir", async (c) => {
  const conversationId = c.req.param("id");
  const conv = leerConversacion(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  if (conv.parent_conversation_id) return c.json({ error: "subagent_read_only" }, 409);
  const tarea = conv.project_id && !conv.parent_conversation_id ? tareaDelChat(conversationId) : null;
  const modeloAgotado = conv.cuota_modelo ?? (tarea?.status === "sin_cuota"
    ? tarea.modelo_agotado ?? tarea.model
    : null);
  if (!modeloAgotado) {
    // El primer clic ya pudo reencolar la tarea y limpiar la cuota antes de que otro dispositivo
    // recibiera la actualización. Un segundo POST es una repetición inocua, no un conflicto.
    if (chatOcupado(conversationId)) {
      return c.json({ messages: [], ...(tarea ? { taskId: tarea.id } : {}), alreadyContinued: true }, 202);
    }
    return c.json({ error: "chat_sin_cuota" }, 409);
  }

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  if (model === modeloAgotado) return c.json({ error: "modelo_sin_cambio" }, 409);
  const bloqueo = motivoDeBloqueo(conv);
  if (bloqueo) return c.json({ error: bloqueo }, 409);

  if (conv.project_id && !conv.parent_conversation_id) {
    if (!tarea || tarea.status !== "sin_cuota") return c.json({ error: "chat_sin_cuota" }, 409);
    const turno = guardarMensajeUsuario(conversationId, SEGUIR_VISIBLE);
    db.transaction(() => {
      db.query("UPDATE tasks SET status='queued',model=?,effort=?,modelo_agotado=NULL,error=NULL,finished_at=NULL,continuar=1,message_id=? WHERE id=?")
        .run(model, conv.effort, turno.id, tarea.id);
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
