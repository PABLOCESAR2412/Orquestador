export type Conversation = { id: string; title: string; created_at: string };
export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>("/api/health"),
  listConversations: () => request<Conversation[]>("/api/conversations"),
  createConversation: () =>
    request<Conversation>("/api/conversations", { method: "POST", body: "{}" }),
  listMessages: (id: string) => request<Message[]>(`/api/conversations/${id}/messages`),
  sendMessage: (id: string, content: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
};
