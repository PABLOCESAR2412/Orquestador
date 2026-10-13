import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { AislamientoError } from "../runners/aislamiento";
import { ejecutarAgente, type ResultadoAgente } from "../ejecutar";
import { getPreferences } from "../preferences";
import { projectRepoPath } from "./projects";
import { mensajeSeguro } from "../workspace";
import {
  conversacionEnCurso,
  liberarConversacion,
  ocuparConversacion,
  proyectoRevisandose,
} from "../ocupacion";

const DEFAULT_MODEL = "opencode/big-pickle";
// Texto de un mensaje: incluye los adjuntos de texto. El cuerpo HTTP sigue limitado a 64 KB.
const MAX_CONTENIDO = 30_000;
const chatWorkspace = join(config.dataDir, "chat-workspace");
mkdirSync(chatWorkspace, { recursive: true });

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
    .query<Conversation, []>(
      "SELECT c.id, c.title, c.model, c.effort, c.project_id, p.name AS project_name, c.pinned_at, c.created_at FROM conversations c LEFT JOIN projects p ON p.id = c.project_id ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, c.created_at DESC, c.rowid DESC",
    )
    .all();
  return c.json(rows.map((r) => ({ ...r, ocupada: conversacionEnCurso(r.id) })));
});

// POST /api/conversations  body: { title?, projectId? }
// Con projectId, el chat trabaja dentro de la carpeta de ese proyecto.
chat.post("/conversations", async (c) => {
  const body = await c.req
    .json<{ title?: string; projectId?: string | null }>()
    .catch(() => ({}) as { title?: string; projectId?: string | null });
  const id = crypto.randomUUID();
  const title = body.title?.trim() || "Nuevo chat";
  const projectId = body.projectId || null;
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
    .query<Message, [string]>(
      "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(c.req.param("id"));
  return c.json(messages);
});

chat.post("/conversations/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const conv = db
    .query<ConversationRow, [string]>(
      "SELECT c.id, c.model, c.effort, c.runner_session_id, c.project_id, p.repo_path AS repo_path FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?",
    )
    .get(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
  const content = body.content?.trim() ?? "";
  if (!content || content.length > MAX_CONTENIDO) {
    return c.json({ error: "invalid_content" }, 400);
  }
  if (conversacionEnCurso(conversationId)) return c.json({ error: "conversation_busy" }, 409);
  // El servidor está leyendo Git de este proyecto: el chat espera, porque trabaja en la misma carpeta.
  if (conv.project_id && proyectoRevisandose(conv.project_id)) return c.json({ error: "proyecto_ocupado" }, 409);

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

  let result: ResultadoAgente;
  ocuparConversacion(conversationId);
  try {
    result = await ejecutarAgente({
      prompt: content,
      model,
      variant: conv.effort,
      sessionId: conv.runner_session_id,
      cwd: conv.repo_path ?? chatWorkspace,
      timeoutMs: 180_000,
      projectId: conv.project_id,
    });
  } catch (err) {
    if (err instanceof AislamientoError) {
      return c.json({ error: err.code, message: err.message }, 503);
    }
    if (String(err).includes("Insufficient account funds")) {
      return c.json({ error: "insufficient_funds", message: "La cuenta de OpenCode Zen no tiene saldo para este modelo. Usa un modelo gratis o agrega saldo." }, 402);
    }
    // Sin rutas del servidor ni fragmentos de secretos.
    return c.json({ error: "runner_failed", detail: mensajeSeguro(err) }, 502);
  } finally {
    liberarConversacion(conversationId);
  }

  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: result.text,
  };

  db.transaction(() => {
    db.query(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
    ).run(assistantMsg.id, conversationId, assistantMsg.role, assistantMsg.content);

    if (result.sessionId) {
      db.query("UPDATE conversations SET runner_session_id = ?, model = ? WHERE id = ?").run(
        result.sessionId,
        model,
        conversationId,
      );
    }

    if (result.usage) {
      // El uso se registra con el modelo que respondió (puede ser el de respaldo) y con el proyecto del chat.
      const u = result.usage;
      db.query(
        `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cost, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        conversationId,
        result.modelo.split("/")[0],
        result.modelo,
        u.input,
        u.output,
        u.reasoning,
        u.cacheRead,
        u.cost,
        conv.project_id,
      );
    }
  })();

  return c.json({ messages: [userMsg, assistantMsg] }, 201);
});
