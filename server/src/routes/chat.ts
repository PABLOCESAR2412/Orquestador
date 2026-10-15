import { Hono } from "hono";
import { db } from "../db";
import { crearTarea } from "../tareas";
import { notifyWorker } from "../worker";
import { repositoryActions } from "./repository-actions";

import { getPreferences } from "../preferences";
import { projectRepoPath, leerCuerpoJson } from "./projects";
import { conversacionEnCurso, proyectoRevisandose } from "../ocupacion";

const DEFAULT_MODEL = "opencode/big-pickle";

type ConversationRow = {
  id: string;
  model: string | null;
  effort: string | null;
  runner_session_id: string | null;
  project_id: string | null;
  repo_path: string | null;
};
type Conversation = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  project_id: string | null;
  project_name: string | null;
  pinned_at: string | null;
  created_at: string;
};
type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export const chat = new Hono();

// Anclados primero (el más reciente anclado, arriba); luego los demás por fecha.
chat.get("/conversations", (c) => {
  const rows = db
    .query<
      Conversation,
      []
    >("SELECT c.id, c.title, c.model, c.effort, c.project_id, p.name AS project_name, c.pinned_at, c.created_at FROM conversations c LEFT JOIN projects p ON p.id = c.project_id ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, c.created_at DESC, c.rowid DESC")
    .all();
  return c.json(rows.map((r) => ({ ...r, ocupada: conversacionEnCurso(r.id) })));
});

// POST /api/conversations  body: { title?, projectId? }
// Con projectId, el chat trabaja dentro de la carpeta de ese proyecto.
chat.post("/conversations", async (c) => {
  const body = await leerCuerpoJson<{ title?: unknown; projectId?: unknown }>(c);
  if (
    !body ||
    (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 200)) ||
    (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== "string")
  )
    return c.json({ error: "invalid_body" }, 400);
  const id = crypto.randomUUID();
  const title = typeof body.title === "string" ? body.title.trim() || "Nuevo chat" : "Nuevo chat";
  const projectId = typeof body.projectId === "string" ? body.projectId || null : null;
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
  if (conversacionEnCurso(id)) return c.json({ error: "conversation_busy" }, 409);
  const result = db.query("DELETE FROM conversations WHERE id = ?").run(id);
  if (result.changes === 0) return c.json({ error: "conversation_not_found" }, 404);
  return c.json({ ok: true });
});

chat.get("/conversations/:id/messages", (c) => {
  const messages = db
    .query<
      Message,
      [string]
    >("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(c.req.param("id"));
  return c.json(messages);
});

chat.post("/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const conv = db
    .query<
      ConversationRow,
      [string]
    >("SELECT c.id, c.model, c.effort, c.runner_session_id, c.project_id, p.repo_path AS repo_path FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?")
    .get(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);

  const body = await leerCuerpoJson<{ content?: unknown }>(c);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 10_000) {
    return c.json({ error: "invalid_content" }, 400);
  }
  if (conversacionEnCurso(conversationId)) return c.json({ error: "conversation_busy" }, 409);
  // El servidor está leyendo Git de este proyecto: el chat espera, porque trabaja en la misma carpeta.
  if (conv.project_id && proyectoRevisandose(conv.project_id))
    return c.json({ error: "proyecto_ocupado" }, 409);

  // Las peticiones directas de Git preparan una autorización; nunca llegan al shell del agente.
  const pedido =
    /^(?:(?:haz|hacer|ejecuta|realiza|crea|crear|por favor)\s+)*(?:un\s+)?(?:git\s+(init|commit|push)|(?:un\s+)?(commit|push|pr)|(?:gh\s+pr\s+create)|(pull request))(?:\s+.*)?[.!]?$/i.exec(
      content,
    );
  if (pedido && conv.project_id) {
    const action = (pedido[1] || pedido[2] || "pr").toLowerCase();
    const task = db
      .query<
        { id: string },
        [string]
      >("SELECT id FROM tasks WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1")
      .get(conversationId);
    const response = await repositoryActions.request(
      `http://telo/projects/${conv.project_id}/acciones`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, conversationId, taskId: task?.id }),
      },
    );
    if (!response.ok) return response;
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content };
    db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,?,?)").run(
      userMsg.id,
      conversationId,
      userMsg.role,
      content,
    );
    return c.json({ messages: [userMsg], action: await response.json() }, 202);
  }

  const model = conv.model ?? getPreferences().defaultModel ?? DEFAULT_MODEL;

  // El mensaje del usuario se guarda antes de ejecutar: así aparece en los demás dispositivos
  // y no se pierde si el agente falla.
  const userMsg = { id: crypto.randomUUID(), role: "user" as const, content };
  db.transaction(() => {
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").run(
      userMsg.id,
      conversationId,
      userMsg.role,
      userMsg.content,
    );
    db.query("UPDATE conversations SET title = ? WHERE id = ? AND title = 'Nuevo chat'").run(
      content.slice(0, 60),
      conversationId,
    );
  })();

  // La conversación conserva su tarea y su clon entre turnos.
  const anterior = db
    .query<
      { id: string },
      [string]
    >("SELECT id FROM tasks WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(conversationId);
  let taskId: string;
  if (anterior) {
    taskId = anterior.id;
    db.query(
      "UPDATE repository_actions SET state='superseded' WHERE task_id=? AND state='pending'",
    ).run(taskId);
    db.query(
      "UPDATE tasks SET prompt=?, model=?, effort=?, status='queued', phase='analyzing', plan=NULL, plan_hash=NULL, approved_hash=NULL, report=NULL, result=NULL, error=NULL, finished_at=NULL WHERE id=?",
    ).run(content, model, conv.effort, taskId);
    notifyWorker();
  } else {
    taskId = crearTarea({
      prompt: content,
      model,
      effort: conv.effort,
      projectId: conv.project_id,
      conversationId,
    });
  }
  return c.json({ messages: [userMsg], taskId }, 202);
});
