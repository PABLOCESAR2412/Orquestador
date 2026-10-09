import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export function ChatPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
  });

  const messages = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => api.listMessages(selectedId!),
    enabled: !!selectedId,
  });

  const create = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedId(conv.id);
    },
  });

  const send = useMutation({
    mutationFn: (content: string) => api.sendMessage(selectedId!, content),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  return (
    <div className="chat">
      <aside className="chat-list">
        <button onClick={() => create.mutate()} disabled={create.isPending}>
          Nuevo chat
        </button>
        {conversations.data?.map((c) => (
          <button
            key={c.id}
            className={c.id === selectedId ? "active" : ""}
            onClick={() => setSelectedId(c.id)}
          >
            {c.title}
          </button>
        ))}
      </aside>

      <section className="chat-main">
        {!selectedId && <p className="muted">Elige un chat o crea uno nuevo.</p>}
        {selectedId && (
          <>
            <div className="messages">
              {messages.data?.map((m) => (
                <div key={m.id} className={`msg msg-${m.role}`}>
                  {m.content}
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                if (text) send.mutate(text);
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje"
                rows={2}
              />
              <button type="submit" disabled={send.isPending || !draft.trim()}>
                Enviar
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
