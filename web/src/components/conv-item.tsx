import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../api";

type Props = {
  conv: Conversation;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

const SVG = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

// Un chat en la barra lateral. Renombrar, anclar y eliminar están a la vista como iconos en la misma fila,
// para que funcionen igual con el dedo en el teléfono.
export function ConvItem({ conv, active, onSelect, onRename, onTogglePin, onDelete }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renombrando) inputRef.current?.focus();
  }, [renombrando]);

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

  return (
    <div className="conv-item">
      <div className="conv-row">
        <button
          type="button"
          className={`sidebar-conv${active ? " active" : ""}`}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(conv.id)}
          title={conv.title}
        >
          <span className="sidebar-conv-texto">
            <span className="sidebar-conv-title">{conv.title}</span>
            {conv.project_name && <span className="sidebar-conv-proyecto">{conv.project_name}</span>}
          </span>
          {conv.ocupada && <span className="pill-dot is-live conv-busy" role="img" aria-label="Respondiendo" />}
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
        <div className="conv-menu conv-confirm" role="group" aria-label="Confirmar eliminación">
          <p className="muted-note">¿Eliminar este chat y sus mensajes? No se puede deshacer.</p>
          <div className="conv-rename-acciones">
            <button
              type="button"
              className="danger-solid task-mini-btn"
              onClick={() => {
                setConfirmando(false);
                onDelete(conv.id);
              }}
            >
              Sí, eliminar
            </button>
            <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmando(false)}>
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
