import { Link } from "@tanstack/react-router";
import type { Latencia } from "../lib/latencia";
import { BotonTema } from "./tema-boton";

// Barra superior de todas las pantallas. El estado sale de /api/health: si responde, el servidor está arriba.
export function ShellTopbar({
  latencia,
  drawerOpen,
  onMenu,
}: {
  latencia: Latencia;
  drawerOpen: boolean;
  onMenu: () => void;
}) {
  const sinConexion = latencia.estado === "sin_conexion";
  const midiendo = latencia.estado === "midiendo";

  return (
    <header className="tl-top">
      <button
        type="button"
        className="tl-boton tl-boton-icono tl-menu"
        onClick={onMenu}
        aria-label="Abrir navegación"
        aria-expanded={drawerOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="tl-top-estado" role="status">
        <span
          className={`tl-punto${sinConexion ? " is-offline" : midiendo ? "" : " is-online"}`}
          aria-hidden="true"
        />
        <span>{sinConexion ? "Sin conexión" : midiendo ? "Conectando…" : "Listo"}</span>
        {!sinConexion && !midiendo && <span className="tl-top-estado-extra"> · Local daemon</span>}
      </div>

      <div className="tl-top-acciones">
        <button
          type="button"
          className="tl-boton"
          disabled
          aria-label="Compartir"
          title="Compartir no está disponible todavía en Telo"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
            <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
          </svg>
          <span className="tl-boton-texto">Compartir</span>
        </button>
        <button
          type="button"
          className="tl-boton"
          disabled
          aria-label="Exportar"
          title="Exportar no está disponible todavía en Telo"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="tl-boton-texto">Exportar</span>
        </button>
        <Link to="/ajustes" className="tl-boton" title="Parámetros de Telo" aria-label="Parámetros">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span className="tl-boton-texto">Parámetros</span>
        </Link>
        <BotonTema />
      </div>
    </header>
  );
}
