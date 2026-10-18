import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../api";
import { haceTextoCorto } from "../lib/tiempo";
import { aprobacionRevisada, marcaAprobacion, marcarAprobacionRevisada } from "../lib/actividad-chat";

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
// Un chat de la barra lateral con estado de actividad y un menú compacto de acciones.
export function ConvItem({ conv, active, variant = "arbol", onSelect, onRename, onTogglePin, onDelete }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [nombre, setNombre] = useState(conv.title);
  const [marcaVista, setMarcaVista] = useState<string | null>(() => aprobacionRevisada(conv) ? marcaAprobacion(conv) : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelarEliminarRef = useRef<HTMLButtonElement>(null);
  const filaRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (renombrando) inputRef.current?.focus(); }, [renombrando]);
  useEffect(() => { if (confirmando) cancelarEliminarRef.current?.focus(); }, [confirmando]);
  useEffect(() => {
    if (!menuAbierto) return;
    const clickFuera = (event: PointerEvent) => {
      if (filaRef.current && !filaRef.current.contains(event.target as Node)) setMenuAbierto(false);
    };
    const tecla = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuAbierto(false);
    };
    document.addEventListener("pointerdown", clickFuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", clickFuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuAbierto]);

  const marcaPendiente = marcaAprobacion(conv);
  useEffect(() => {
    if (!active || !conv.pendiente_aprobacion) return;
    marcarAprobacionRevisada(conv);
    setMarcaVista(marcaPendiente);
  }, [active, conv.id, conv.pendiente_aprobacion, marcaPendiente]);

  if (renombrando) {
    return (
      <form className="conv-rename" onSubmit={(event) => {
        event.preventDefault();
        const titulo = nombre.trim();
        setRenombrando(false);
        if (titulo && titulo !== conv.title) onRename(conv.id, titulo);
        else setNombre(conv.title);
      }}>
        <input
          ref={inputRef}
          className="conv-rename-input"
          aria-label="Nuevo nombre del chat"
          value={nombre}
          maxLength={80}
          onChange={(event) => setNombre(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setRenombrando(false); setNombre(conv.title); }
          }}
        />
        <div className="conv-rename-acciones">
          <button type="submit" className="primary task-mini-btn">Guardar</button>
          <button type="button" className="ghost task-mini-btn" onClick={() => { setRenombrando(false); setNombre(conv.title); }}>Cancelar</button>
        </div>
      </form>
    );
  }

  const anclado = Boolean(conv.pinned_at);
  const esProyecto = Boolean(conv.project_id);
  const tiempoRelativo = haceTextoCorto(conv.last_message_at || conv.created_at);
  const pendienteSinLeer = Boolean(conv.pendiente_aprobacion && marcaVista !== marcaPendiente);
  const estado = conv.en_proceso ? "En proceso" : pendienteSinLeer ? "Requiere revisión" : conv.completada ? "Lista para revisar" : "";

  return (
    <div ref={filaRef} className={`conv-item${variant === "arbol" ? " is-arbol" : ""}`}>
      <div className="conv-row">
        <button
          type="button"
          className={`sidebar-conv${active ? " active" : ""}`}
          aria-current={active ? "true" : undefined}
          aria-label={estado ? `${conv.title} · ${estado}` : conv.title}
          onClick={() => { setMenuAbierto(false); onSelect(conv.id); }}
          title={`${conv.title}${esProyecto ? ` (${conv.project_name || "Proyecto"})` : " (Chat libre)"}${estado ? ` · ${estado}` : ""}`}
        >
          {variant !== "arbol" && (
            <span className={`sidebar-conv-tipo-icono ${esProyecto ? "is-proyecto" : "is-libre"}`} aria-hidden="true">
              {esProyecto ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              )}
            </span>
          )}
          {variant === "arbol" && (
            <span className="sidebar-conv-chat-icon" aria-hidden="true">
              <svg {...SVG}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </span>
          )}
          <span className="sidebar-conv-texto">
            <span className="sidebar-conv-title">{conv.title}</span>
            {variant !== "arbol" && <span className={`sidebar-conv-sub ${esProyecto ? "is-proyecto" : "is-libre"}`}>{esProyecto ? (conv.project_name || "Proyecto") : "Chat libre"}</span>}
          </span>
          <span className="sidebar-conv-meta" aria-label={estado || undefined}>
            {conv.en_proceso ? (
              <span className="tl-indicador-spinner" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg></span>
            ) : pendienteSinLeer ? (
              <span className="tl-indicador-alerta" aria-hidden="true"><span className="tl-indicador-dot is-pendiente" /></span>
            ) : conv.completada ? (
              <span className="tl-indicador-listo" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="tl-icono-visto"><polyline points="20 6 9 17 4 12" /></svg></span>
            ) : tiempoRelativo ? <span className="sidebar-conv-tiempo">{tiempoRelativo}</span> : null}
          </span>
        </button>
        <div className="conv-acciones">
          <button
            type="button"
            className={`conv-icono conv-mas${menuAbierto ? " is-activo" : ""}`}
            aria-label={`Más opciones para ${conv.title}`}
            aria-haspopup="true"
            aria-expanded={menuAbierto}
            title="Más opciones"
            onClick={() => { setConfirmando(false); setMenuAbierto((open) => !open); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
          </button>
          {menuAbierto && (
            <div className="conv-menu conv-acciones-menu" role="group" aria-label={`Acciones de ${conv.title}`}>
              <button type="button" onClick={() => { setMenuAbierto(false); setConfirmando(false); setNombre(conv.title); setRenombrando(true); }}>Renombrar</button>
              <button type="button" aria-pressed={anclado} onClick={() => { setMenuAbierto(false); onTogglePin(conv.id, !anclado); }}>{anclado ? "Quitar de anclados" : "Anclar arriba"}</button>
              <button type="button" className="danger" onClick={() => { setMenuAbierto(false); setConfirmando(true); }}>Eliminar</button>
            </div>
          )}
        </div>
      </div>

      {confirmando && (
        <div id={`conv-delete-${conv.id}`} className="conv-menu conv-confirm" role="group" aria-labelledby={`conv-delete-title-${conv.id}`} aria-describedby={`conv-delete-description-${conv.id}`} onKeyDown={(event) => { if (event.key === "Escape") setConfirmando(false); }}>
          <div className="conv-confirm-cabecera">
            <span className="conv-confirm-icono" aria-hidden="true"><svg {...SVG}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg></span>
            <div>
              <strong id={`conv-delete-title-${conv.id}`} className="conv-confirm-titulo">Eliminar este chat</strong>
              <p id={`conv-delete-description-${conv.id}`}>Se eliminarán «{conv.title}» y todos sus mensajes. No se puede deshacer.</p>
            </div>
          </div>
          <div className="conv-rename-acciones">
            <button ref={cancelarEliminarRef} type="button" className="ghost task-mini-btn" onClick={() => setConfirmando(false)}>Cancelar</button>
            <button type="button" className="danger-solid task-mini-btn" onClick={() => { setConfirmando(false); onDelete(conv.id); }}>Eliminar chat</button>
          </div>
        </div>
      )}
    </div>
  );
}
