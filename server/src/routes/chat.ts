import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { publicar } from "../bus";
import { AislamientoError } from "../runners/aislamiento";
import { ejecutarAgente, ErrorCuota, promptContinuacion, type ResultadoAgente } from "../ejecutar";
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

const DEFAULT_MODEL = "opencode/big-pickle";
// Texto de un mensaje: incluye los adjuntos de texto. El cuerpo HTTP sigue limitado a 64 KB.
const MAX_CONTENIDO = 30_000;
// Lo que se muestra en el chat si el agente falla: se corta para que no llene la conversación.
const MAX_DETALLE_ERROR = 300;
const chatWorkspace = join(config.dataDir, "chat-workspace");
mkdirSync(chatWorkspace, { recursive: true });

type ConversationRow = {
  id: string;
  model: string | null;
  effort: string | null;
  runner_session_id: string | null;
  project_id: string | null;
  repo_path: string | null;
  // Modelo que se quedó sin cuota en el último turno; null si el chat puede seguir.
  cuota_modelo: string | null;
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
};
type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};
type TurnoUsuario = { id: string; role: "user"; content: string };

export const chat = new Hono();

// Anclados primero (el más reciente anclado, arriba); luego los demás por fecha.
chat.get("/conversations", (c) => {
  const rows = db
    .query<Conversation, []>(
      "SELECT c.id, c.title, c.model, c.effort, c.project_id, p.name AS project_name, c.pinned_at, c.cuota_modelo, c.created_at FROM conversations c LEFT JOIN projects p ON p.id = c.project_id ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, c.created_at DESC, c.rowid DESC",
    )
    .all();
  return c.json(rows.map((r) => ({ ...r, ocupada: chatOcupado(r.id) })));
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
  const result = db.query("DELETE FROM conversations WHERE id = ?").run(id);
  if (result.changes === 0) return c.json({ error: "conversation_not_found" }, 404);
  return c.json({ ok: true });
});

// Pasos del agente de un turno (el id es el del mensaje del usuario). Se piden al abrir "Ver proceso".
chat.get("/conversations/:id/turnos/:turno/actividad", (c) => {
  return c.json(actividadDelTurno(c.req.param("id"), c.req.param("turno")));
});

chat.get("/conversations/:id/messages", (c) => {
  const messages = db
    .query<Message, [string]>(
      "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(c.req.param("id"));
  return c.json(messages);
});

chat.get("/conversations/:id/tasks", (c) => {
  const id = c.req.param("id");
  if (!leerConversacion(id)) return c.json({ error: "conversation_not_found" }, 404);
  const filas = db.query<{ plan: string | null; reporte: string | null; [key: string]: unknown }, [string]>(
    "SELECT id,title,status,model,effort,plan,reporte,plan_aprobado_en,plan_hash,approved_hash,error,conversation_id,created_at,started_at,finished_at FROM tasks WHERE conversation_id=? ORDER BY created_at,rowid",
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
        "SELECT c.id, c.model, c.effort, c.runner_session_id, c.project_id, c.cuota_modelo, p.repo_path AS repo_path FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?",
      )
      .get(id) ?? null
  );
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
  return db.query<{ id: string; status: string }, [string]>(
    "SELECT id,status FROM tasks WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
  ).get(id);
}

// Una conversación conserva su clon y sesión; cada nueva petición necesita un plan nuevo.
function encolarTurno(conv: ConversationRow, prompt: string, model: string): string {
  const anterior = tareaDelChat(conv.id);
  if (!anterior) return crearTarea({
    prompt, model, effort: conv.effort, projectId: conv.project_id, conversationId: conv.id,
  });
  db.transaction(() => {
    db.query("UPDATE repository_actions SET state='superseded' WHERE task_id=? AND state='pending'").run(anterior.id);
    db.query(
      "UPDATE tasks SET prompt=?,model=?,effort=?,status='queued',plan=NULL,plan_hash=NULL,approved_hash=NULL,plan_aprobado_en=NULL,reporte=NULL,result=NULL,error=NULL,finished_at=NULL,modelo_agotado=NULL,continuar=0 WHERE id=?",
    ).run(prompt, model, conv.effort, anterior.id);
    db.query("UPDATE conversations SET cuota_modelo=NULL WHERE id=?").run(conv.id);
    registrarEvento(anterior.id, "turno_encolado", "Nuevo mensaje de la conversación");
  })();
  publicarEstado(anterior.id);
  notifyWorker();
  return anterior.id;
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
      content.slice(0, 60),
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

// Límite de un turno del chat. Al llegar a este tiempo, el agente se detiene (SIGTERM, código 143).
const TIEMPO_TURNO_MS = 180_000;

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
  try {
    const cwd = join(chatWorkspace, conversationId);
    mkdirSync(cwd, { recursive: true });
    result = await ejecutarAgente({
      prompt,
      model,
      variant: conv.effort,
      sessionId: conv.runner_session_id,
      cwd,
      timeoutMs: TIEMPO_TURNO_MS,
      projectId: conv.project_id,
      conversationId,
      estilo: "chat",
      // Cada paso del agente (texto intermedio o acción) se guarda y se publica mientras corre.
      onLinea: (linea) => {
        const item = itemDeLinea(linea);
        if (item) registrarActividad(conversationId, turno.id, item);
      },
    });
  } catch (err) {
    if (err instanceof ErrorCuota) {
      // La sesión que sí llegó a abrirse se guarda, para seguirla con otro modelo. El aviso de cuota lo muestra el chat.
      db.query(
        "UPDATE conversations SET cuota_modelo = ?, runner_session_id = COALESCE(?, runner_session_id) WHERE id = ?",
      ).run(err.modelo, err.sessionId, conversationId);
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
        `El agente tardó más de ${TIEMPO_TURNO_MS / 60_000} minutos y se detuvo. Divide la tarea en partes más pequeñas.`,
      );
      return;
    }
    // Sin rutas del servidor ni fragmentos de secretos.
    guardarAviso(
      conversationId,
      `No se pudo responder. ${mensajeSeguro(err).slice(0, MAX_DETALLE_ERROR)}`,
    );
    return;
  }

  // La respuesta del chat es lo dicho tras la última herramienta; lo anterior queda en el proceso.
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: result.textoFinal,
  };

  db.transaction(() => {
    db.query(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
    ).run(assistantMsg.id, conversationId, assistantMsg.role, assistantMsg.content);

    // Una respuesta correcta levanta el aviso de cuota, si lo había.
    db.query("UPDATE conversations SET cuota_modelo = NULL WHERE id = ?").run(conversationId);

    if (result.sessionId) {
      db.query("UPDATE conversations SET runner_session_id = ?, model = ? WHERE id = ?").run(
        result.sessionId,
        model,
        conversationId,
      );
    }

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
       WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.conversation_id=c.id)
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

  const body = await c.req.json<{ content?: unknown }>().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_CONTENIDO) {
    return c.json({ error: "invalid_content" }, 400);
  }
  const bloqueo = motivoDeBloqueo(conv);
  if (bloqueo) return c.json({ error: bloqueo }, 409);

  // Las órdenes directas de Git crean una tarjeta de autorización, sin ejecutar al agente.
  const pedido = /^(?:(?:haz|hacer|ejecuta|realiza|crea|crear|prepara|reintenta|por favor)\s+)*(?:de nuevo\s+)?(?:(?:un|el)\s+)?(?:git\s+(init|commit|push)|(?:un\s+)?(commit|push|pr)|(?:gh\s+pr\s+create)|(pull request))(?:\s+.*)?[.!]?$/i.exec(content);
  if (pedido && conv.project_id) {
    const turno = guardarMensajeUsuario(conversationId, content);
    const response = await repositoryActions.request(`http://telo/projects/${conv.project_id}/acciones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: /\bcommit\s+(?:y|and|&)\s+(?:git\s+)?push\b/i.test(pedido[0]) ? "push" : (pedido[1] || pedido[2] || "pr").toLowerCase(),
        conversationId, taskId: tareaDelChat(conversationId)?.id, messageId: turno.id,
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
        const aviso = { id: crypto.randomUUID(), role: "assistant" as const, content: motivo };
        db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(aviso.id, conversationId, motivo);
        publicarChat(conversationId, "terminado");
        return c.json({ messages: [turno, aviso] }, 202);
      }
      db.query("DELETE FROM messages WHERE id=?").run(turno.id);
      return response;
    }
    publicarChat(conversationId, "terminado");
    return c.json({ messages: [turno], action: await response.json() }, 202);
  }

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  const turno = guardarMensajeUsuario(conversationId, content);
  if (conv.project_id) {
    const taskId = encolarTurno(conv, content, model);
    publicarChat(conversationId, "en_curso");
    return c.json({ messages: [turno], taskId }, 202);
  }
  iniciarTurno(conv, turno, content, model);
  return c.json({ messages: [turno] }, 202);
});

// POST /api/conversations/:id/seguir
// Tras una cuota agotada: el chat retoma su sesión con el modelo elegido, desde donde se quedó.
// Si el modelo falló antes de abrir sesión, no hay nada que retomar: se vuelve a enviar el mensaje sin respuesta.
chat.post("/conversations/:id/seguir", async (c) => {
  const conversationId = c.req.param("id");
  const conv = leerConversacion(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);
  if (!conv.cuota_modelo) return c.json({ error: "chat_sin_cuota" }, 409);

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;
  if (model === conv.cuota_modelo) return c.json({ error: "modelo_sin_cambio" }, 409);
  const bloqueo = motivoDeBloqueo(conv);
  if (bloqueo) return c.json({ error: bloqueo }, 409);

  if (conv.project_id) {
    const tarea = tareaDelChat(conversationId);
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
    ? promptContinuacion(SEGUIR_INSTRUCCION)
    : (ultimoMensaje ?? SEGUIR_INSTRUCCION);
  iniciarTurno(conv, turno, prompt, model);
  return c.json({ messages: [turno] }, 202);
});
