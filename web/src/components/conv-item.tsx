import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../api";
import { haceTextoCorto } from "../lib/tiempo";

type Props = {
  conv: Conversation;
  active: boolean;
  variant?: "arbol" | "lista";
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

const SVG = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

// Un chat en la barra lateral. Renombrar, anclar y eliminar están a la vista como iconos en la misma fila,
// para que funcionen igual con el dedo en el teléfono.
export function ConvItem({ conv, active, variant = "arbol", onSelect, onRename, onTogglePin, onDelete }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelarEliminarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (renombrando) inputRef.current?.focus();
  }, [renombrando]);
  useEffect(() => {
    if (confirmando) cancelarEliminarRef.current?.focus();
  }, [confirmando]);

  if (renombrando) {
    return (
      <form
        className="conv-rename"
        onSubmit={(e) => {
          e.preventDefault();
          const titulo = nombre.trim();
          setRenombrando(false);
          if (titulo && titulo !== conv.title) onRename(conv.id, titulo);
          else setNombre(conv.title);
        }}
      >
        <input
          ref={inputRef}
          className="conv-rename-input"
          aria-label="Nuevo nombre del chat"
          value={nombre}
          maxLength={80}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRenombrando(false);
              setNombre(conv.title);
            }
          }}
        />
        <div className="conv-rename-acciones">
          <button type="submit" className="primary task-mini-btn">Guardar</button>
          <button
            type="button"
            className="ghost task-mini-btn"
            onClick={() => {
              setRenombrando(false);
              setNombre(conv.title);
            }}
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  const anclado = Boolean(conv.pinned_at);
  const esProyecto = Boolean(conv.project_id);
  const tiempoRelativo = haceTextoCorto(conv.last_message_at || conv.created_at);

  return (
    <div className={`conv-item${variant === "arbol" ? " is-arbol" : ""}`}>
      <div className="conv-row">
        <button
          type="button"
          className={`sidebar-conv${active ? " active" : ""}`}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(conv.id)}
          title={`${conv.title}${esProyecto ? ` (${conv.project_name || "Proyecto"})` : " (Chat libre)"}`}
        >
          {variant !== "arbol" && (
            <span className={`sidebar-conv-tipo-icono ${esProyecto ? "is-proyecto" : "is-libre"}`} aria-hidden="true">
              {esProyecto ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
            </span>
          )}
          <span className="sidebar-conv-texto">
            <span className="sidebar-conv-title">{conv.title}</span>
            {variant !== "arbol" && (
              <span className={`sidebar-conv-sub ${esProyecto ? "is-proyecto" : "is-libre"}`}>
                {esProyecto ? (conv.project_name || "Proyecto") : "Chat libre"}
              </span>
            )}
          </span>

          {/* Indicadores de estado (spinner en proceso, punto pendiente, visto completado) o tiempo relativo */}
          <span className="sidebar-conv-meta" aria-hidden="true">
            {conv.en_proceso ? (
              <span className="tl-indicador-spinner" title="En proceso…" aria-label="En proceso">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </span>
            ) : conv.pendiente_aprobacion ? (
              <span className="tl-indicador-alerta" title="Requiere aprobación / atención" aria-label="Requiere aprobación">
                <span className="tl-indicador-dot is-pendiente" />
              </span>
            ) : conv.completada ? (
              <span className="tl-indicador-listo" title="Listo para revisar" aria-label="Listo para revisar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="tl-icono-visto">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : tiempoRelativo ? (
              <span className="sidebar-conv-tiempo">{tiempoRelativo}</span>
            ) : null}
          </span>
        </button>
        <div className="conv-acciones" role="group" aria-label={`Acciones de ${conv.title}`}>
          <button
            type="button"
            className="conv-icono"
            aria-label={`Renombrar ${conv.title}`}
            title="Renombrar"
            onClick={() => {
              setConfirmando(false);
              setNombre(conv.title);
              setRenombrando(true);
            }}
          >
            <svg {...SVG}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
          <button
            type="button"
            className={`conv-icono${anclado ? " is-activo" : ""}`}
            aria-label={anclado ? `Quitar ${conv.title} del ancla` : `Anclar ${conv.title} arriba`}
            aria-pressed={anclado}
            title={anclado ? "Quitar del ancla" : "Anclar arriba"}
            onClick={() => onTogglePin(conv.id, !anclado)}
          >
            <svg {...SVG}>
              <path d="M12 17v5" />
              <path d="M9 10.76V6a3 3 0 0 1 6 0v4.76l2.5 2.5V15h-11v-1.74z" />
            </svg>
          </button>
          <button
            type="button"
            className="conv-icono is-peligro"
            aria-label={`Eliminar ${conv.title}`}
            aria-expanded={confirmando}
            aria-controls={`conv-delete-${conv.id}`}
            title="Eliminar"
            onClick={() => setConfirmando((o) => !o)}
          >
            <svg {...SVG}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </div>

      {confirmando && (
        <div
          id={`conv-delete-${conv.id}`}
          className="conv-menu conv-confirm"
          role="group"
          aria-labelledby={`conv-delete-title-${conv.id}`}
          aria-describedby={`conv-delete-description-${conv.id}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmando(false);
          }}
        >
          <div className="conv-confirm-cabecera">
            <span className="conv-confirm-icono" aria-hidden="true">
              <svg {...SVG}>
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <div>
              <strong id={`conv-delete-title-${conv.id}`} className="conv-confirm-titulo">Eliminar este chat</strong>
              <p id={`conv-delete-description-${conv.id}`}>Se eliminarán «{conv.title}» y todos sus mensajes. No se puede deshacer.</p>
            </div>
          </div>
          <div className="conv-rename-acciones">
            <button ref={cancelarEliminarRef} type="button" className="ghost task-mini-btn" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="danger-solid task-mini-btn"
              onClick={() => {
                setConfirmando(false);
                onDelete(conv.id);
              }}
            >
              Eliminar chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
