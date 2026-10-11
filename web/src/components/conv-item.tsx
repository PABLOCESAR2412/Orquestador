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

// Un chat en la barra lateral, con su menú de acciones. Renombrar y eliminar se hacen dentro
// de la misma fila, para que funcionen igual con el dedo en el teléfono.
export function ConvItem({ conv, active, onSelect, onRename, onTogglePin, onDelete }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renombrando) inputRef.current?.focus();
  }, [renombrando]);

  const cerrarMenu = () => {
    setMenuAbierto(false);
    setConfirmando(false);
  };

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
          <span className="sidebar-conv-title">{conv.title}</span>
          {conv.ocupada && <span className="pill-dot is-live conv-busy" role="img" aria-label="Respondiendo" />}
        </button>
        <button
          type="button"
          className="conv-more"
          aria-label={`Opciones de ${conv.title}`}
          aria-expanded={menuAbierto}
          onClick={() => {
            setMenuAbierto((o) => !o);
            setConfirmando(false);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>

      {menuAbierto && !confirmando && (
        <div className="conv-menu" role="group" aria-label="Acciones del chat">
          <button
            type="button"
            onClick={() => {
              cerrarMenu();
              setNombre(conv.title);
              setRenombrando(true);
            }}
          >
            Renombrar
          </button>
          <button
            type="button"
            onClick={() => {
              cerrarMenu();
              onTogglePin(conv.id, !conv.pinned_at);
            }}
          >
            {conv.pinned_at ? "Quitar del ancla" : "Anclar arriba"}
          </button>
          <button type="button" className="danger" onClick={() => setConfirmando(true)}>
            Eliminar
          </button>
        </div>
      )}

      {menuAbierto && confirmando && (
        <div className="conv-menu conv-confirm" role="group" aria-label="Confirmar eliminación">
          <p className="muted-note">¿Eliminar este chat y sus mensajes? No se puede deshacer.</p>
          <div className="conv-rename-acciones">
            <button
              type="button"
              className="danger-solid task-mini-btn"
              onClick={() => {
                cerrarMenu();
                onDelete(conv.id);
              }}
            >
              Sí, eliminar
            </button>
            <button type="button" className="ghost task-mini-btn" onClick={cerrarMenu}>
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
