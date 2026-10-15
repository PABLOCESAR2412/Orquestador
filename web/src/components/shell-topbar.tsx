import { Link, useRouterState } from "@tanstack/react-router";
import type { Latencia } from "../lib/latencia";
import { BotonTema } from "./tema-boton";
import { useShell } from "./shell-context";

const ICONO_AJUSTES = (
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
);

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
  const { triggerConfig, activeProjectId, activeProjectName } = useShell();
  const enChat = useRouterState({ select: (r) => r.location.pathname === "/chat" });
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
        {enChat && activeProjectId ? (
          <Link
            to="/proyectos/$id"
            params={{ id: activeProjectId }}
            className="tl-boton"
            title={activeProjectName ? `Ir al proyecto: ${activeProjectName}` : "Ir al proyecto (carpeta, resumen, instrucciones)"}
            aria-label="Proyecto"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span className="tl-boton-texto">Proyecto</span>
          </Link>
        ) : enChat ? (
          <button
            type="button"
            className="tl-boton"
            aria-label="Configuración"
            title="Configuración de este chat"
            onClick={triggerConfig}
          >
            {ICONO_AJUSTES}
            <span className="tl-boton-texto">Configuración</span>
          </button>
        ) : (
          <Link to="/ajustes" className="tl-boton" title="Configuración de Telo" aria-label="Configuración">
            {ICONO_AJUSTES}
            <span className="tl-boton-texto">Configuración</span>
          </Link>
        )}
        <BotonTema />
      </div>
    </header>
  );
}
