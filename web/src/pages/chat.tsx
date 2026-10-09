import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation, type ModelInfo } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { errorText, formatWhen } from "../lib/model";
import { useShell } from "../components/shell-context";

type Patch = { model?: string | null; effort?: string | null };

export function ChatPage() {
  const qc = useQueryClient();
  const {
    selectedConversationId,
    setSelectedConversationId,
    toggleDrawer,
  } = useShell();
  const selectedId = selectedConversationId;
  const setSelectedId = setSelectedConversationId;

  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
  });

  // Abre el chat más reciente al cargar si no hay uno seleccionado
  useEffect(() => {
    if (!selectedId && conversations.data?.length) {
      setSelectedId(conversations.data[0].id);
    }
  }, [selectedId, conversations.data, setSelectedId]);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    staleTime: 5 * 60_000,
  });

  const messages = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => api.listMessages(selectedId!),
    enabled: !!selectedId,
  });

  const current: Conversation | null =
    conversations.data?.find((c) => c.id === selectedId) ?? null;
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === current?.model) ?? null;

  const create = useMutation({
    mutationFn: api.createConversation,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedId(conv.id);
    },
  });

  const configure = useMutation({
    mutationFn: (patch: Patch) => api.updateConversation(selectedId!, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      const previous = qc.getQueryData<Conversation[]>(["conversations"]);
      qc.setQueryData<Conversation[]>(["conversations"], (list) =>
        list?.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                model: patch.model !== undefined ? patch.model : c.model,
                effort: patch.effort !== undefined ? patch.effort : c.effort,
              }
            : c,
        ),
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(["conversations"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const send = useMutation({
    mutationFn: (content: string) => api.sendMessage(selectedId!, content),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const pickModel = (m: ModelInfo | null) => {
    setPickerOpen(false);
    if (!m) {
      configure.mutate({ model: null, effort: null });
      return;
    }
    // Conserva el esfuerzo solo si el nuevo modelo también lo admite.
    const effort = current?.effort && m.variants.includes(current.effort) ? current.effort : null;
    configure.mutate({ model: m.id, effort });
  };

  const submit = () => {
    const text = draft.trim();
    if (text && selectedId && !send.isPending) send.mutate(text);
  };

  // El campo crece con el texto hasta un máximo.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  // Mantiene visible el último mensaje, incluido el de "pensando".
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, send.isPending, selectedId]);

  const sendError = send.isError ? errorText(send.error) : null;
  const settingsError = configure.isError ? errorText(configure.error) : null;
  const error = sendError ?? settingsError;

  return (
    <section className="thread">
      <header className="thread-head">
        <div className="thread-head-info">
          {/* En móvil, «telo» abre el cajón con la navegación y los chats recientes */}
          <button
            type="button"
            className="thread-brand"
            aria-label="telo: abrir navegación y chats recientes"
            onClick={toggleDrawer}
          >
            telo
          </button>

          <div className="thread-model-trigger-wrap">
            <button
              type="button"
              className="thread-model-btn"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
            >
              <span className="pill-dot is-live thread-model-dot" aria-hidden="true" />
              <span className="thread-model-btn-name">
                {modelInfo?.name ?? current?.model ?? "Predeterminado"}
              </span>
              {modelInfo && <CostMeter tier={modelInfo.costTier} />}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {pickerOpen && (
              <ModelPicker
                models={modelList}
                currentId={current?.model ?? null}
                onSelect={pickModel}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          <span className="thread-head-sep" aria-hidden="true">•</span>
          <h1 className="thread-title">{current?.title ?? "Nuevo chat"}</h1>
        </div>
      </header>

      {!selectedId ? (
        <div className="empty">
          <div className="empty-box">
            <h2>Sin conversación activa</h2>
            <p>Inicia un nuevo chat con tus agentes o selecciona uno de la lista.</p>
            <button type="button" className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
              Nuevo chat
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="messages">
            <div className="column">
              {messages.data?.length === 0 && !send.isPending && (
                <p className="muted-note center">Escribe un mensaje para empezar.</p>
              )}
              {messages.data?.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`msg-row msg-row-${m.role}`}>
                    <div className="msg-meta-bar">
                      {isUser ? (
                        <>
                          <span className="msg-author">Tú</span>
                          <span className="msg-meta-dot">•</span>
                          <time className="msg-time">{formatWhen(m.created_at)}</time>
                        </>
                      ) : (
                        <>
                          <div className="msg-author-icon" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="16 18 22 12 16 6" />
                              <polyline points="8 6 2 12 8 18" />
                            </svg>
                          </div>
                          <span className="msg-author">{modelInfo?.name ?? current?.model ?? "Asistente"}</span>
                          <span className="msg-meta-dot">•</span>
                          <time className="msg-time">{formatWhen(m.created_at)}</time>
                        </>
                      )}
                    </div>
                    <div className={`msg msg-${m.role}`}>
                      {m.content}
                    </div>
                  </div>
                );
              })}
              {send.isPending && (
                <>
                  <div className="msg-row msg-row-user">
                    <div className="msg-meta-bar">
                      <span className="msg-author">Tú</span>
                      <span className="msg-meta-dot">•</span>
                      <span className="msg-time">Ahora</span>
                    </div>
                    <div className="msg msg-user">{send.variables}</div>
                  </div>
                  <div className="msg-row msg-row-assistant">
                    <div className="msg-meta-bar">
                      <div className="msg-author-icon" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 18 22 12 16 6" />
                          <polyline points="8 6 2 12 8 18" />
                        </svg>
                      </div>
                      <span className="msg-author">{modelInfo?.name ?? current?.model ?? "Asistente"}</span>
                      <span className="msg-meta-dot">•</span>
                      <span className="msg-time">Pensando…</span>
                    </div>
                    <div className="msg msg-assistant thinking" aria-live="polite">
                      <span className="dot" aria-hidden="true" />
                      <span className="muted-note">Pensando</span>
                    </div>
                  </div>
                </>
              )}
              <div ref={endRef} />
            </div>
          </div>

            <form
              className="composer"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                submit();
              }}
            >
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {modelInfo?.costWarning && <p className="hint">{modelInfo.costWarning}</p>}

              <div className="composer-box">
                {pickerOpen && (
                  <ModelPicker
                    models={modelList}
                    currentId={current?.model ?? null}
                    onSelect={pickModel}
                    onClose={() => setPickerOpen(false)}
                  />
                )}

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  placeholder="Escribe un mensaje"
                  aria-label="Mensaje"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />

                <div className="toolbar">
                  <button
                    type="button"
                    className="model-chip"
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((o) => !o)}
                  >
                    <span className="model-chip-name">
                      {modelInfo?.name ?? current?.model ?? "Predeterminado"}
                    </span>
                    {modelInfo && <CostMeter tier={modelInfo.costTier} />}
                  </button>

                  <EffortControl
                    variants={modelInfo?.variants ?? []}
                    value={current?.effort ?? null}
                    disabled={!current?.model || configure.isPending}
                    onChange={(effort) => configure.mutate({ effort })}
                  />

                  <button
                    type="submit"
                    className="send"
                    aria-label="Enviar"
                    disabled={!draft.trim() || send.isPending}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </section>
  );
}
