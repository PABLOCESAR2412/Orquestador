import { useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ContextoConversacion, type Message, type ModelInfo } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText, formatUsd, nombreProveedor } from "../lib/model";
import { compact } from "./charts";
import { useDialogo } from "./controls";

type Props = {
  conversationId: string;
  messages: Message[];
  models: ModelInfo[];
  onClose: () => void;
  disparador?: RefObject<HTMLElement | null>;
};

const entero = (n: number) => new Intl.NumberFormat("es-EC").format(n);
const fecha = (value: string | null) => value
  ? new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Sin actividad";

export function ChatContexto({ conversationId, messages, models, onClose, disparador }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const previo = useRef(document.activeElement as HTMLElement | null);
  const [todosLosMensajes, setTodosLosMensajes] = useState(false);
  const cerrar = () => {
    (disparador?.current ?? previo.current)?.focus();
    onClose();
  };
  useDialogo(ref, cerrar);

  const contexto = useQuery({
    queryKey: ["conversation-context", conversationId],
    queryFn: () => api.conversationContext(conversationId),
    refetchInterval: 5000,
  });

  const exportar = () => {
    if (!contexto.data) return;
    const blob = new Blob([JSON.stringify({ ...contexto.data, messages }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${nombreArchivo(contexto.data.conversation.title)}-contexto.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <div className="scrim dim" onClick={cerrar} />
      <aside className="tl-chat-contexto" role="dialog" aria-modal="true" aria-label="Contexto del chat" ref={ref}>
        <header className="tl-chat-contexto-cabecera">
          <div>
            <span className="tl-chat-contexto-etiqueta">DETALLES DE CONVERSACIÓN</span>
            <h2>Contexto del chat</h2>
            <p>Uso registrado y mensajes guardados de esta conversación.</p>
          </div>
          <div className="tl-chat-contexto-acciones">
            <button type="button" className="tl-boton" onClick={exportar} disabled={!contexto.data}>
              Exportar sesión
            </button>
            <button type="button" className="tl-boton tl-chat-contexto-cerrar" onClick={cerrar} aria-label="Cerrar contexto">×</button>
          </div>
        </header>

        <div className="tl-chat-contexto-cuerpo">
          {contexto.isPending && !contexto.data && <LoadingSkeleton tipo="tarjetas" cantidad={3} />}
          {contexto.isError && (
            <div className="tl-chat-contexto-error" role="alert">
              <p>No se pudo cargar el contexto: {errorText(contexto.error)}</p>
              <button type="button" className="tl-boton" onClick={() => void contexto.refetch()}>Reintentar</button>
            </div>
          )}
          {contexto.data && <DetalleContexto data={contexto.data} messages={messages} models={models} todosLosMensajes={todosLosMensajes} onMostrarMensajes={() => setTodosLosMensajes(true)} />}
        </div>
      </aside>
    </>
  );
}

function DetalleContexto({
  data,
  messages,
  models,
  todosLosMensajes,
  onMostrarMensajes,
}: {
  data: ContextoConversacion;
  messages: Message[];
  models: ModelInfo[];
  todosLosMensajes: boolean;
  onMostrarMensajes: () => void;
}) {
  const { conversation, usage } = data;
  const ultimoModelo = data.lastInput ? models.find((model) => model.id === data.lastInput?.model) : undefined;
  const limite = ultimoModelo?.context ?? 0;
  const entrada = data.lastInput;
  const entradaConPrecision = !!entrada && entrada.inputTokens > 0 && ["medida", "estimado"].includes(entrada.tokensPrecision);
  const porcentaje = limite > 0 && entradaConPrecision ? Math.min(100, Math.round(entrada.inputTokens / limite * 100)) : null;
  const mostrados = todosLosMensajes ? messages : messages.slice(-30);

  return (
    <>
      <section className="tl-chat-contexto-ventana" aria-label="Contexto reciente">
        <div className="tl-chat-contexto-ventana-titulo">
          <div>
            <span className="tl-chat-contexto-etiqueta">ÚLTIMA PETICIÓN AL MODELO</span>
            <strong>{data.lastInput ? etiquetaModelo(data.lastInput.model, models) : "Sin métricas todavía"}</strong>
          </div>
          {porcentaje !== null && <span className="tl-chat-contexto-porcentaje">{porcentaje}%</span>}
        </div>
        {entradaConPrecision && limite > 0 ? (
          <>
            <div className="tl-chat-contexto-barra" role="progressbar" aria-label="Uso de la ventana de contexto en la última petición" aria-valuemin={0} aria-valuemax={limite} aria-valuenow={Math.min(limite, entrada.inputTokens)}>
              <span style={{ width: `${porcentaje}%` }} />
            </div>
            <div className="tl-chat-contexto-ventana-meta">
              <span>{entero(entrada.inputTokens)} tokens de entrada ({entrada.tokensPrecision})</span>
              <span>límite {compact(limite)}</span>
            </div>
          </>
        ) : (
          <p className="tl-chat-contexto-nota">{entradaConPrecision
            ? `${entero(entrada.inputTokens)} tokens de entrada (${entrada.tokensPrecision}); este modelo no publica su límite de contexto.`
            : entrada?.inputTokens
              ? `${entero(entrada.inputTokens)} tokens registrados con precisión «${entrada.tokensPrecision}»; no se calcula el porcentaje de contexto.`
              : entrada
                ? "El proveedor no informó tokens de entrada para la última llamada."
            : "El proveedor aún no ha guardado tokens de una llamada para este chat."}</p>
        )}
        <p className="tl-chat-contexto-nota">La barra representa la entrada de la llamada más reciente, no los tokens acumulados durante toda la conversación.</p>
      </section>

      <section className="tl-chat-contexto-bloque" aria-label="Sesión">
        <h3>Sesión</h3>
        <div className="tl-chat-contexto-datos">
          <Dato label="Modelo seleccionado" value={conversation.model ? etiquetaModelo(conversation.model, models) : "Predeterminado"} />
          <Dato label="Proveedor" value={conversation.provider ? nombreProveedor(conversation.provider) : (conversation.model ? nombreProveedor(conversation.model.split("/")[0]) : "Lo elige el servidor")} />
          <Dato label="Mensajes" value={entero(data.messages.total)} />
          <Dato label="Usuario / asistente" value={`${entero(data.messages.user)} / ${entero(data.messages.assistant)}`} />
          <Dato label="Acciones del agente" value={entero(data.actions)} />
          <Dato label="Chat creado" value={fecha(conversation.createdAt)} />
          <Dato label="Última actividad" value={fecha(conversation.lastActivity)} />
          {conversation.sessionModel && conversation.sessionModel !== conversation.model && <Dato label="Modelo de la sesión persistente" value={etiquetaModelo(conversation.sessionModel, models)} />}
          {conversation.sessionId && <Dato label="Sesión persistente" value={conversation.sessionId} mono />}
        </div>
      </section>

      <section className="tl-chat-contexto-bloque" aria-label="Uso registrado">
        <div className="tl-chat-contexto-seccion-titulo">
          <h3>Uso registrado</h3>
          <span>{entero(usage.calls)} llamadas</span>
        </div>
        <div className="tl-chat-contexto-datos">
          <Dato label="Tokens totales" value={entero(usage.inputTokens + usage.outputTokens)} />
          <Dato label="Tokens de entrada" value={entero(usage.inputTokens)} />
          <Dato label="Tokens de salida" value={entero(usage.outputTokens)} />
          <Dato label="Razonamiento · incluido en salida" value={entero(usage.reasoningTokens)} />
          <Dato label="Caché leída · incluida en entrada" value={entero(usage.cacheReadTokens)} />
          <Dato label="Costo registrado" value={formatUsd(usage.costUsd)} />
          <Dato label="Llamadas del chat / tareas" value={`${entero(usage.chatCalls)} / ${entero(usage.taskCalls)}`} />
        </div>
        <p className="tl-chat-contexto-nota">Los tokens de razonamiento y de caché ya están incluidos en salida y entrada respectivamente; no se suman de nuevo.</p>
        <p className="tl-chat-contexto-nota">Precisión de tokens: {entero(usage.measured)} medidas · {entero(usage.estimated)} estimadas · {entero(usage.unavailable)} sin datos · {entero(usage.unknown)} desconocidas.</p>
      </section>

      {data.byModel.length > 0 && (
        <section className="tl-chat-contexto-bloque" aria-label="Uso por modelo">
          <h3>Uso por modelo</h3>
          <ul className="tl-chat-contexto-modelos">
            {data.byModel.map((item) => (
              <li key={`${item.provider}:${item.model}`}>
                <span><strong>{etiquetaModelo(item.model, models)}</strong><small>{nombreProveedor(item.provider)} · {entero(item.calls)} llamadas</small></span>
                <span className="tl-chat-contexto-modelo-uso">{compact(item.inputTokens + item.outputTokens)} tokens<small>{formatUsd(item.costUsd)}</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tl-chat-contexto-bloque" aria-label="Mensajes guardados">
        <div className="tl-chat-contexto-seccion-titulo">
          <h3>Mensajes guardados</h3>
          <span>{entero(messages.length)}</span>
        </div>
        <p className="tl-chat-contexto-nota">Es la conversación almacenada por Telo; puede diferir del prompt exacto enviado al proveedor.</p>
        <div className="tl-chat-contexto-mensajes">
          {messages.length === 0 && <p className="tl-nota">Aún no hay mensajes.</p>}
          {mostrados.map((message) => (
            <details key={message.id}>
              <summary><span>{etiquetaRol(message.role)} · {message.id}</span><time>{fecha(message.created_at)}</time></summary>
              <pre>{message.content}</pre>
            </details>
          ))}
        </div>
        {!todosLosMensajes && messages.length > mostrados.length && (
          <button type="button" className="tl-boton tl-chat-contexto-mas" onClick={onMostrarMensajes}>Mostrar los {entero(messages.length - mostrados.length)} anteriores</button>
        )}
      </section>
    </>
  );
}

function Dato({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="tl-chat-contexto-dato"><span>{label}</span><strong className={mono ? "is-mono" : undefined} title={value}>{value}</strong></div>;
}

function etiquetaModelo(id: string, models: ModelInfo[]) {
  return models.find((model) => model.id === id)?.name ?? id;
}

function etiquetaRol(role: Message["role"]) {
  return role === "user" ? "Usuario" : role === "assistant" ? "Asistente" : "Sistema";
}

function nombreArchivo(title: string) {
  return title.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chat";
}
