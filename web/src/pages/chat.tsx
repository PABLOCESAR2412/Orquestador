import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Conversation, type ModelInfo } from "../api";
import { ModelPicker } from "../components/model-picker";
import { UsoPanel } from "../components/uso-panel";
import { IndicadorPensando, MensajeAgente, MensajeUsuario } from "../components/chat-mensajes";
import { effortLabel, errorText, tierBars } from "../lib/model";
import { useShell } from "../components/shell-context";
import "../styles-chat.css";

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

// Ventana de contexto en tokens, abreviada: 128000 es "128k".
function etiquetaContexto(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
}

const EFFORT_OPTIONS = [
  { id: "low", label: "Bajo" },
  { id: "medium", label: "Medio" },
  { id: "high", label: "Alto" },
];

export function ChatPage() {
  const qc = useQueryClient();
  const { selectedConversationId, setSelectedConversationId, triggerPalette } = useShell();
  const selectedId = selectedConversationId;
  const setSelectedId = setSelectedConversationId;

  const [draft, setDraft] = useState("");
  // Al cambiar de chat, carga el borrador de ese chat (no se guarda en un efecto para no mezclar chats).
  useEffect(() => {
    if (selectedId) setDraft(leerBorrador(selectedId));
  }, [selectedId]);
  const cambiarBorrador = (texto: string) => {
    setDraft(texto);
    if (selectedId) guardarBorrador(selectedId, texto);
  };
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

  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  // Cada 4 s mientras la pestaña está visible: los mensajes que llegan desde otro dispositivo aparecen solos.
  const messages = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => api.listMessages(selectedId!),
    enabled: !!selectedId,
    refetchInterval: 4_000,
  });

  const current: Conversation | null =
    conversations.data?.find((c) => c.id === selectedId) ?? null;
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === current?.model) ?? null;

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
  }, [messages.data?.length, send.isPending, selectedId]);

  const sendError = send.isError ? errorText(send.error) : null;
  const settingsError = configure.isError ? errorText(configure.error) : null;
  const error = sendError ?? settingsError;

  // El mensaje que se envió desde este dispositivo ya puede estar en la lista (el sondeo lo trae antes de terminar).
  const ultimoMensaje = messages.data?.at(-1);
  const yaGuardado = send.isPending && ultimoMensaje?.role === "user" && ultimoMensaje.content === send.variables?.content;
  // Pensando: se envió aquí o el chat está ocupado (otro dispositivo lo envió).
  const pensando = send.isPending || !!current?.ocupada;

  // Nombres reales: el modelo del chat o "Agente" si el servidor todavía no ha elegido uno.
  const efectoActual = current?.effort ?? null;
  const nombreAgente = modelInfo?.name ?? current?.model ?? "Agente";
  const nombreChip = current?.model ? nombreAgente : "Predeterminado";
  const contexto = etiquetaContexto(modelInfo?.context);
  // Etiqueta del selector del compositor: "Nombre del modelo · Esfuerzo", o "Predeterminado" si el servidor elige.
  const nombreModelo = current?.model ? (modelInfo?.name ?? current.model) : null;
  const etiquetaChip =
    nombreModelo === null
      ? "Predeterminado"
      : efectoActual
        ? `${nombreModelo} · ${effortLabel(efectoActual)}`
        : (modelInfo?.variants.length ?? 0) > 0
          ? `${nombreModelo} · Auto`
          : nombreModelo;
  const nivelCosto = tierBars(modelInfo?.costTier ?? "medio");

  return (
    <section className="tl-chat" aria-label="Chat">
      {!selectedId ? (
        <div className="tl-vacio">
          <div className="tl-vacio-caja">
            {conversations.isPending ? (
              <p>Cargando chats…</p>
            ) : conversations.isError ? (
              <>
                <h2>No se pudieron cargar los chats</h2>
                <p>Revisa la conexión e intenta de nuevo.</p>
                <button type="button" className="tl-boton" onClick={() => void conversations.refetch()}>
                  Reintentar
                </button>
              </>
            ) : (
              <>
                <h2>Sin conversación activa</h2>
                <p>Inicia un nuevo chat con tus agentes o selecciona uno de la lista.</p>
                {(proyectos.data?.length ?? 0) > 0 && (
                  <select
                    className="tl-select"
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
                  className="tl-boton tl-boton-principal"
                  onClick={() => create.mutate(projectId || null)}
                  disabled={create.isPending}
                >
                  Nuevo chat
                </button>
                {create.isError && (
                  <p className="tl-alerta" role="alert">
                    {errorText(create.error)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <header className="tl-chat-cabecera">
            <div className="tl-chat-cabecera-izq">
              <span className="tl-chip tl-chip-modelo" title="Modelo de este chat">
                <span className="tl-chip-nombre">{nombreChip}</span>
                {contexto && <span className="tl-chip-dato">{contexto}</span>}
              </span>
              <h1 className="tl-chat-titulo">{current?.title ?? "Chat"}</h1>
              {current?.project_name && (
                <span className="tl-chip tl-chip-proyecto" title={`Proyecto: ${current.project_name}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="tl-chip-texto">{current.project_name}</span>
                </span>
              )}
            </div>
            <div className="tl-chat-cabecera-der">
              <button
                type="button"
                className="tl-boton"
                disabled
                aria-label="Bifurcar"
                title="Bifurcar no está disponible: los chats todavía no admiten ramas"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <span className="tl-boton-texto">Bifurcar</span>
              </button>
              <button
                type="button"
                className="tl-boton"
                disabled
                aria-label="Historial"
                title="El historial de este chat todavía no está disponible"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
                </svg>
                <span className="tl-boton-texto">Historial</span>
              </button>
            </div>
          </header>

          <div className="tl-hilo">
            <div className="tl-hilo-columna">
              {messages.isPending && <p className="tl-nota">Cargando mensajes…</p>}
              {messages.isError && (
                <div className="tl-estado-linea">
                  <p className="tl-alerta" role="alert">
                    No se pudieron cargar los mensajes.
                  </p>
                  <button type="button" className="tl-boton" onClick={() => void messages.refetch()}>
                    Reintentar
                  </button>
                </div>
              )}
              {messages.data?.length === 0 && !send.isPending && (
                <p className="tl-nota">Aún no hay mensajes. Escribe una instrucción para el agente o pulsa Ctrl+K para comandos.</p>
              )}
              {messages.data?.map((m) =>
                m.role === "user" ? (
                  <MensajeUsuario key={m.id} texto={m.content} cuando={m.created_at} />
                ) : (
                  <MensajeAgente key={m.id} texto={m.content} cuando={m.created_at} modelo={nombreAgente} />
                ),
              )}
              {send.isPending && !yaGuardado && (
                <MensajeUsuario texto={send.variables?.content ?? ""} cuando={null} />
              )}
              {pensando && <IndicadorPensando modelo={nombreAgente} />}
              <div ref={endRef} />
            </div>
          </div>

          <form
            className="tl-composer"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit();
            }}
          >
            {error && (
              <p className="tl-alerta" role="alert">
                {error}
              </p>
            )}
            {modelInfo?.costWarning && <p className="tl-aviso">{modelInfo.costWarning}</p>}

            <div className="tl-composer-caja">
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
                  modelo={current?.model ?? null}
                  onCerrar={() => setUsoAbierto(false)}
                  disparador={usoRef}
                />
              )}

              <textarea
                ref={inputRef}
                className="tl-composer-input"
                rows={2}
                value={draft}
                placeholder="Escribe un mensaje, o usa / para comandos"
                aria-label="Mensaje"
                onChange={(e) => cambiarBorrador(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />

              <div className="tl-composer-barra">
                <div className="tl-composer-izq">
                  <button
                    type="button"
                    className="tl-accion-icono"
                    disabled
                    aria-label="Adjuntar archivo"
                    title="Adjuntar archivos al chat todavía no está disponible"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="tl-accion-icono"
                    aria-label="Herramientas y comandos"
                    title="Herramientas y comandos (Ctrl+K)"
                    onClick={triggerPalette}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </button>

                  <button
                    ref={chipRef}
                    type="button"
                    className="tl-modelo-boton"
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    onClick={() => {
                      setUsoAbierto(false);
                      setPickerOpen((o) => !o);
                    }}
                  >
                    <span className="tl-modelo-nombre">{etiquetaChip}</span>
                    <span className="cost-meter" title={`Costo: ${nivelCosto} de 5`} aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className={`cost-bar${i < nivelCosto ? " filled" : ""}`} />
                      ))}
                    </span>
                  </button>

                  <div className="tl-esfuerzo" role="radiogroup" aria-label="Esfuerzo del modelo">
                    {EFFORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        className="tl-esfuerzo-opcion"
                        aria-checked={efectoActual === opt.id}
                        onClick={() => configure.mutate({ effort: efectoActual === opt.id ? null : opt.id })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tl-composer-der">
                  <button
                    ref={usoRef}
                    type="button"
                    className="tl-boton tl-boton-compacto"
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
                    className="tl-enviar"
                    aria-label="Enviar"
                    disabled={!draft.trim() || send.isPending || !!current?.ocupada}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <p className="tl-composer-nota">
              Los agentes trabajan en el servidor de forma persistente. Revisa sus cambios antes de aplicarlos.
            </p>
          </form>
        </>
      )}
    </section>
  );
}
