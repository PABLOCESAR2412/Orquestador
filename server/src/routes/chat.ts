import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { runOpenCode, type RunResult } from "../runners/opencode";

const DEFAULT_MODEL = "opencode/big-pickle";
const chatWorkspace = join(config.dataDir, "chat-workspace");
mkdirSync(chatWorkspace, { recursive: true });

type ConversationRow = {
  id: string;
  model: string | null;
  effort: string | null;
  runner_session_id: string | null;
};
type Conversation = { id: string; title: string; created_at: string };
type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export const chat = new Hono();

chat.get("/conversations", (c) => {
  const rows = db
    .query<Conversation, []>(
      "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC, rowid DESC",
    )
    .all();
  return c.json(rows);
});

chat.post("/conversations", async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const id = crypto.randomUUID();
  const title = body.title?.trim() || "Nuevo chat";
  db.query("INSERT INTO conversations (id, title) VALUES (?, ?)").run(id, title);
  return c.json({ id, title, created_at: new Date().toISOString() }, 201);
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
      "SELECT id, model, effort, runner_session_id FROM conversations WHERE id = ?",
    )
    .get(conversationId);
  if (!conv) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
  const content = body.content?.trim() ?? "";
  if (!content || content.length > 10_000) {
    return c.json({ error: "invalid_content" }, 400);
  }

  const model = conv.model ?? DEFAULT_MODEL;

  let result: RunResult;
  try {
    result = await runOpenCode({
      prompt: content,
      model,
      variant: conv.effort ?? undefined,
      sessionId: conv.runner_session_id,
      cwd: chatWorkspace,
      timeoutMs: 180_000,
    });
  } catch (err) {
    const detail = String(err);
    if (detail.includes("Insufficient account funds")) {
      return c.json({ error: "insufficient_funds", message: "La cuenta de OpenCode Zen no tiene saldo para este modelo. Usa un modelo gratis o agrega saldo." }, 402);
    }
    return c.json({ error: "runner_failed", detail }, 502);
  }

  const userMsg = { id: crypto.randomUUID(), role: "user" as const, content };
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: result.text,
  };

  db.transaction(() => {
    const insert = db.query(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
    );
    insert.run(userMsg.id, conversationId, userMsg.role, userMsg.content);
    insert.run(assistantMsg.id, conversationId, assistantMsg.role, assistantMsg.content);

    db.query("UPDATE conversations SET title = ? WHERE id = ? AND title = 'Nuevo chat'").run(
      content.slice(0, 60),
      conversationId,
    );

    if (result.sessionId) {
      db.query("UPDATE conversations SET runner_session_id = ?, model = ? WHERE id = ?").run(
        result.sessionId,
        model,
        conversationId,
      );
    }

    if (result.usage) {
      const u = result.usage;
      db.query(
        `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        conversationId,
        model.split("/")[0],
        model,
        u.input,
        u.output,
        u.reasoning,
        u.cacheRead,
        u.cost,
      );
    }
  })();

  return c.json({ messages: [userMsg, assistantMsg] }, 201);
});
