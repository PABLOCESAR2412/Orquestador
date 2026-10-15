import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Conversation, type ModelInfo } from "../api";
import { CostMeter } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { UsoPanel } from "../components/uso-panel";
import { effortLabel, errorText, formatWhen, tierBars } from "../lib/model";
import { useShell } from "../components/shell-context";
import { BotonTema } from "../components/tema-boton";
import { AppNav } from "../components/nav";
import { PlanRevision } from "../components/plan-revision";
import { ReporteTarea } from "../components/reporte-tarea";
import { AccionesRepositorioChat } from "../components/repository-approval";
import { sugerenciasChat } from "../lib/sugerencias";
import "../styles-flujo.css";

type Patch = { model?: string | null; effort?: string | null };

// Errores en los que el servidor ya guardó el mensaje del usuario (no hay que reenviarlo).
const GUARDADO_EN_ERROR = ["runner_failed", "insufficient_funds", "aislamiento_no_disponible"];

// Borrador por chat, guardado en este navegador: sobrevive a cambiar de pantalla o a una señal caída.
// Si el navegador no deja guardar, el borrador solo vive en la pantalla.
const claveBorrador = (id: string) => `telo:borrador:${id}`;
function leerBorrador(id: string): string {
  try {
    return localStorage.getItem(claveBorrador(id)) ?? "";
  } catch {
    return "";
  }
}
function guardarBorrador(id: string, texto: string) {
  try {
    if (texto) localStorage.setItem(claveBorrador(id), texto);
    else localStorage.removeItem(claveBorrador(id));
  } catch {
    // Sin almacenamiento disponible: se ignora.
  }
}

export function ChatPage() {
  const qc = useQueryClient();
  const { selectedConversationId, setSelectedConversationId, toggleDrawer, triggerPalette } =
    useShell();
  const selectedId = selectedConversationId;
  const setSelectedId = setSelectedConversationId;

  const [draft, setDraft] = useState("");
  // Al cambiar de chat, carga el borrador de ese chat (no se guarda en un efecto para no mezclar chats).
  useEffect(() => {
    if (selectedId) setDraft(leerBorrador(selectedId));
  }, [selectedId]);
  const cambiarBorrador = (texto: string) => {
    setDraft(texto);
    setSugerenciaOculta(false);
    if (selectedId) guardarBorrador(selectedId, texto);
  };
  const [sugerenciaOculta, setSugerenciaOculta] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [usoAbierto, setUsoAbierto] = useState(false);
  // "" significa sin proyecto: el chat usa su carpeta temporal.
  const [projectId, setProjectId] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Botones que abren el selector y el panel de uso: reciben el foco al cerrar.
  const chipRef = useRef<HTMLButtonElement>(null);
  const usoRef = useRef<HTMLButtonElement>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
    refetchInterval: 4_000,
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

  const tareasChat = useQuery({
    queryKey: ["conversation-tasks", selectedId],
    queryFn: () => api.conversationTasks(selectedId!),
    enabled: !!selectedId,
    refetchInterval: 2000,
  });
  const tareaChat = tareasChat.data?.[0];
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  // Cada 4 s mientras la pestaña está visible: los mensajes que llegan desde otro dispositivo aparecen solos.
  const messages = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => api.listMessages(selectedId!),
    enabled: !!selectedId,
    refetchInterval: 4_000,
  });

  const current: Conversation | null = conversations.data?.find((c) => c.id === selectedId) ?? null;
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modeloEfectivo = current?.model ?? prefs.data?.defaultModel ?? "opencode/big-pickle";
  const modelInfo = modelList.find((m) => m.id === modeloEfectivo) ?? null;

  const create = useMutation({
    mutationFn: (proyecto?: string | null) => api.createConversation(proyecto ?? null),
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
    mutationFn: ({ id, content }: { id: string; content: string }) => api.sendMessage(id, content),
    onSuccess: (_data, { id }) => {
      guardarBorrador(id, "");
      if (id === selectedId) setDraft("");
    },
    // El servidor guarda el mensaje antes de responder: aunque el agente falle, el mensaje ya está en el chat.
    onError: (err, { id }) => {
      const guardado = err instanceof ApiError && GUARDADO_EN_ERROR.includes(err.code);
      if (guardado) {
        guardarBorrador(id, "");
        if (id === selectedId) setDraft("");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-tasks"] });
      qc.invalidateQueries({ queryKey: ["repository-actions"] });
      qc.invalidateQueries({ queryKey: ["uso"] });
    },
  });

  // Un solo control: el modelo y su nivel de esfuerzo se eligen juntos. null en esfuerzo es "Auto".
  const elegirModelo = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    setPickerOpen(false);
    if (!m) {
      configure.mutate({ model: null, effort: null });
      return;
    }
    configure.mutate({ model: m.id, effort: esfuerzo });
  };

  const submit = () => {
    const text = draft.trim();
    if (text && selectedId && !send.isPending) send.mutate({ id: selectedId, content: text });
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
  }, [messages.data?.length, send.isPending, selectedId, tareaChat?.phase]);

  const sendError = send.isError ? errorText(send.error) : null;
  const settingsError = configure.isError ? errorText(configure.error) : null;
  const error = sendError ?? settingsError;

  // El mensaje que se envió desde este dispositivo ya puede estar en la lista (el sondeo lo trae antes de terminar).
  const ultimoMensaje = messages.data?.at(-1);
  const yaGuardado =
    send.isPending &&
    ultimoMensaje?.role === "user" &&
    ultimoMensaje.content === send.variables?.content;
  // Pensando: se envió aquí o el chat está ocupado (otro dispositivo lo envió).
  const pensando =
    send.isPending ||
    tareaChat?.status === "running" ||
    (tareaChat?.status === "queued" && tareaChat.phase !== "waiting_approval");
  useEffect(() => {
    if (!pensando) {
      setSegundos(0);
      return;
    }
    const inicio = Date.now();
    const timer = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pensando]);
  const sugerencias = sugerenciasChat(messages.data ?? []);
  const sugerencia =
    !sugerenciaOculta && !pensando
      ? sugerencias.find(
          (s) =>
            !draft ||
            (s.toLocaleLowerCase().startsWith(draft.toLocaleLowerCase()) &&
              s.length > draft.length),
        )
      : undefined;
  useEffect(() => setSugerenciaOculta(false), [selectedId, messages.data?.length]);

  // Etiqueta del chip: "Nombre del modelo · Esfuerzo", o "Predeterminado" si el servidor elige.
  const efectoActual = current?.effort ?? null;
  const nombreModelo = current?.model ? (modelInfo?.name ?? current.model) : null;
  const etiquetaChip =
    nombreModelo === null
      ? "Predeterminado"
      : efectoActual
        ? `${nombreModelo} · ${effortLabel(efectoActual)}`
        : (modelInfo?.variants.length ?? 0) > 0
          ? `${nombreModelo} · Auto`
          : nombreModelo;

  return (
    <div className="page-wrap">
      <AppNav variant="row" />

      <main className="container">
        <header className="header-row">
          <div>
            <div className="header-title-row">
              <button
                type="button"
                className="thread-brand"
                aria-label="telo: abrir navegación y chats recientes"
                onClick={toggleDrawer}
              >
                telo
              </button>
              <h1 className="page-title">{current?.title ?? "Chat"}</h1>
            </div>
            <span className="page-subtitle">
              {current?.project_name
                ? `Proyecto: ${current.project_name}`
                : "Proyecto: Orquestador Daemon"}
            </span>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="palette-btn"
              title="Paleta de comandos (Ctrl+K)"
              onClick={triggerPalette}
            >
              Ctrl+K
            </button>
            <BotonTema />
          </div>
        </header>

        {!selectedId ? (
          <div className="empty">
            <div className="empty-box">
              {conversations.isPending ? (
                <p>Cargando chats…</p>
              ) : conversations.isError ? (
                <>
                  <h2>No se pudieron cargar los chats</h2>
                  <p>Revisa la conexión e intenta de nuevo.</p>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void conversations.refetch()}
                  >
                    Reintentar
                  </button>
                </>
              ) : (
                <>
                  <h2>Sin conversación activa</h2>
                  <p>Inicia un nuevo chat con tus agentes o selecciona uno de la lista.</p>
                  {(proyectos.data?.length ?? 0) > 0 && (
                    <select
                      className="project-select"
                      aria-label="Proyecto del chat"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">Sin proyecto</option>
                      {proyectos.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => create.mutate(projectId || null)}
                    disabled={create.isPending}
                  >
                    Nuevo chat
                  </button>
                  {create.isError && (
                    <p className="error" role="alert">
                      {errorText(create.error)}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="chat-thread">
              {messages.isPending && <p className="muted-note">Cargando mensajes…</p>}
              {messages.isError && (
                <div className="estado-linea">
                  <p className="error" role="alert">
                    No se pudieron cargar los mensajes.
                  </p>
                  <button type="button" className="ghost" onClick={() => void messages.refetch()}>
                    Reintentar
                  </button>
                </div>
              )}
              {messages.data?.length === 0 && !send.isPending && (
                <div className="chat-msg">
                  <span className="msg-meta">Asistente · Listo</span>
                  <p>Escribe una instrucción para el agente o pulsa Ctrl+K para comandos.</p>
                </div>
              )}
              {messages.data?.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div
                    key={m.id}
                    className={`chat-msg${isUser ? " chat-msg-user" : " chat-msg-assistant"}`}
                  >
                    <div className="msg-meta">
                      {isUser ? (
                        <span>Tú · {formatWhen(m.created_at)}</span>
                      ) : (
                        <>
                          <span className="msg-author-icon" aria-hidden="true">
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="16 18 22 12 16 6" />
                              <polyline points="8 6 2 12 8 18" />
                            </svg>
                          </span>
                          <span>
                            {modelInfo?.name ?? current?.model ?? "Codex CLI"} ·{" "}
                            {formatWhen(m.created_at)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="msg-content">{m.content}</div>
                  </div>
                );
              })}
              {send.isPending && !yaGuardado && (
                <div className="chat-msg chat-msg-user">
                  <div className="msg-meta">
                    <span>Tú · Ahora</span>
                  </div>
                  <div className="msg-content">{send.variables?.content}</div>
                </div>
              )}
              {pensando && (
                <div className="chat-msg chat-msg-assistant">
                  <div className="msg-meta">
                    <span className="msg-author-icon" aria-hidden="true">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                    </span>
                    <span>{modelInfo?.name ?? current?.model ?? "Codex CLI"} · Pensando…</span>
                  </div>
                  <div className="thinking" aria-live="polite">
                    <span className="dot" aria-hidden="true" />
                    <span className="muted-note">
                      {tareaChat?.phase === "analyzing"
                        ? "Preparando el plan"
                        : tareaChat?.status === "queued"
                          ? "Esperando turno"
                          : "Ejecutando el plan"}{" "}
                      · {segundos} s
                      {segundos >= 20
                        ? " · El agente sigue trabajando. Puedes salir de esta pantalla."
                        : ""}
                    </span>
                  </div>
                </div>
              )}
              {tareaChat && (
                <PlanRevision key={tareaChat.plan_hash ?? tareaChat.id} tarea={tareaChat} />
              )}
              {tareaChat && <ReporteTarea reporte={tareaChat.report} />}
              {selectedId && (
                <AccionesRepositorioChat
                  conversationId={selectedId}
                  projectId={current?.project_id ?? null}
                  taskId={tareaChat?.id}
                  terminada={tareaChat?.status === "done"}
                />
              )}
              <div ref={endRef} />
            </div>

            <form
              className="composer-form"
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
                    conEsfuerzo
                    currentEffort={efectoActual}
                    onSelect={elegirModelo}
                    onClose={() => setPickerOpen(false)}
                    disparador={chipRef}
                    cargando={models.isPending}
                    error={models.isError ? errorText(models.error) : null}
                    onReintentar={() => void models.refetch()}
                  />
                )}

                {usoAbierto && (
                  <UsoPanel
                    modelo={modeloEfectivo}
                    onCerrar={() => setUsoAbierto(false)}
                    disparador={usoRef}
                  />
                )}

                <textarea
                  ref={inputRef}
                  className="composer-input"
                  rows={2}
                  value={draft}
                  placeholder="Escribe una instrucción para el agente o pulsa Ctrl+K para comandos..."
                  aria-label="Mensaje"
                  onChange={(e) => cambiarBorrador(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key === "Escape") {
                      setSugerenciaOculta(true);
                      return;
                    }
                    if (
                      e.key === "Tab" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      sugerencia
                    ) {
                      e.preventDefault();
                      cambiarBorrador(sugerencia);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />

                {sugerencia && (
                  <button
                    type="button"
                    className="composer-suggestion"
                    onClick={() => {
                      cambiarBorrador(sugerencia);
                      inputRef.current?.focus();
                    }}
                    aria-label={"Completar sugerencia: " + sugerencia}
                  >
                    <span>{sugerencia}</span>
                    <kbd>Tab</kbd>
                  </button>
                )}
                <div className="composer-controls">
                  <div className="controls-left">
                    <button
                      ref={chipRef}
                      type="button"
                      className="model-chip"
                      aria-haspopup="dialog"
                      aria-expanded={pickerOpen}
                      onClick={() => {
                        setUsoAbierto(false);
                        setPickerOpen((o) => !o);
                      }}
                    >
                      <span>{etiquetaChip}</span>
                      <div
                        className="cost-meter"
                        title={`Costo: ${tierBars(modelInfo?.costTier ?? "medio")} de 5`}
                      >
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className={`cost-bar${i < tierBars(modelInfo?.costTier ?? "medio") ? " filled" : ""}`}
                          />
                        ))}
                      </div>
                    </button>
                  </div>

                  <div className="controls-right">
                    <button
                      ref={usoRef}
                      type="button"
                      className="btn-usage"
                      aria-haspopup="dialog"
                      aria-expanded={usoAbierto}
                      onClick={() => {
                        setPickerOpen(false);
                        setUsoAbierto((o) => !o);
                      }}
                    >
                      Uso
                    </button>

                    <button
                      type="submit"
                      className="send"
                      aria-label="Enviar"
                      disabled={!draft.trim() || send.isPending || !!current?.ocupada}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
