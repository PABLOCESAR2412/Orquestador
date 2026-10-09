import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation, type ModelInfo } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { errorText } from "../lib/model";

type Patch = { model?: string | null; effort?: string | null };

export function ChatPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
  });

  // Abre el chat más reciente al cargar, para no dejar la pantalla vacía en móvil.
  useEffect(() => {
    if (!selectedId && conversations.data?.length) setSelectedId(conversations.data[0].id);
  }, [selectedId, conversations.data]);

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
      setRailOpen(false);
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

  // Elegir un chat: cierra el cajón en móvil y limpia el error anterior.
  const select = (id: string) => {
    setSelectedId(id);
    setRailOpen(false);
    setPickerOpen(false);
    send.reset();
    configure.reset();
  };

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
    <div className="shell">
      <aside className={`rail${railOpen ? " open" : ""}`}>
        <div className="rail-head">
          <span className="wordmark">orquestador</span>
          <button
            type="button"
            className="ghost"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            Nuevo chat
          </button>
        </div>

        <nav className="conv-list" aria-label="Chats">
          {conversations.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              className="conv"
              aria-current={c.id === selectedId || undefined}
              onClick={() => select(c.id)}
            >
              {c.title}
            </button>
          ))}
        </nav>

        <Link to="/estado" className="rail-foot">
          Estado del servidor
        </Link>
      </aside>

      {railOpen && <div className="scrim dim" onClick={() => setRailOpen(false)} />}

      <section className="thread">
        <header className="thread-head">
          <button
            type="button"
            className="ghost menu-btn"
            aria-label="Abrir chats"
            onClick={() => setRailOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <h1 className="thread-title">{current?.title ?? "Orquestador"}</h1>
        </header>

        {!selectedId ? (
          <div className="empty">
            <p>Crea un chat para empezar.</p>
            <button type="button" className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
              Nuevo chat
            </button>
          </div>
        ) : (
          <>
            <div className="messages">
              <div className="column">
                {messages.data?.length === 0 && !send.isPending && (
                  <p className="muted-note center">Escribe un mensaje para empezar.</p>
                )}
                {messages.data?.map((m) => (
                  <div key={m.id} className={`msg msg-${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {send.isPending && (
                  <>
                    <div className="msg msg-user">{send.variables}</div>
                    <div className="msg msg-assistant thinking" aria-live="polite">
                      <span className="dot" aria-hidden="true" />
                      <span className="muted-note">Pensando</span>
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
    </div>
  );
}
