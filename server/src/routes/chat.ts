import { Hono } from "hono";
import { db } from "../db";

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
  const exists = db
    .query<{ id: string }, [string]>("SELECT id FROM conversations WHERE id = ?")
    .get(conversationId);
  if (!exists) return c.json({ error: "conversation_not_found" }, 404);

  const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
  const content = body.content?.trim() ?? "";
  if (!content || content.length > 10_000) {
    return c.json({ error: "invalid_content" }, 400);
  }

  const userMsg = { id: crypto.randomUUID(), role: "user" as const, content };
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: `Eco (sin modelo todavía): ${content}`,
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
  })();

  return c.json({ messages: [userMsg, assistantMsg] }, 201);
});
