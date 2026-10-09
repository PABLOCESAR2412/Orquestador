import { type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { AppNav } from "./nav";
import { useShell } from "./shell-context";

export function Shell({ children }: { children: ReactNode }) {
  const {
    drawerOpen,
    closeDrawer,
    selectedConversationId,
    setSelectedConversationId,
    triggerNewTask,
  } = useShell();

  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
  });

  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });

  const handleSelectConv = (id: string) => {
    setSelectedConversationId(id);
    closeDrawer();
    if (currentPath !== "/chat") {
      void navigate({ to: "/chat" });
    }
  };

  const isOnline = Boolean(health.data?.ok);

  return (
    <div className="shell-root">
      {/* Sidebar fijo en escritorio, cajón en móvil */}
      <aside className={`sidebar${drawerOpen ? " open" : ""}`} aria-label="Barra lateral">
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <Link to="/chat" className="sidebar-brand" onClick={closeDrawer}>
              <span className="sidebar-brand-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="19" cy="5" r="2" />
                  <circle cx="5" cy="5" r="2" />
                  <circle cx="5" cy="19" r="2" />
                  <circle cx="19" cy="19" r="2" />
                  <line x1="7" y1="6.5" x2="10" y2="10.5" />
                  <line x1="17" y1="6.5" x2="14" y2="10.5" />
                  <line x1="7" y1="17.5" x2="10" y2="13.5" />
                  <line x1="17" y1="17.5" x2="14" y2="13.5" />
                </svg>
              </span>
              <span className="sidebar-brand-name">telo</span>
            </Link>
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={closeDrawer}
              aria-label="Cerrar barra lateral"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="sidebar-new-task"
            onClick={triggerNewTask}
            title="Crear nueva tarea (⌘N)"
          >
            <span className="sidebar-new-task-left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Nueva tarea</span>
            </span>
            <kbd className="sidebar-kbd">⌘N</kbd>
          </button>

          <AppNav variant="sidebar" onItemClick={closeDrawer} />

          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <span className="sidebar-section-title">Recientes</span>
            </div>
            <div className="sidebar-recientes" role="list">
              {conversations.isLoading && (
                <span className="sidebar-empty">Cargando…</span>
              )}
              {conversations.isError && (
                <span className="sidebar-empty">Error al cargar</span>
              )}
              {conversations.data && conversations.data.length === 0 && (
                <span className="sidebar-empty">Sin conversaciones</span>
              )}
              {conversations.data?.map((c) => {
                const isActive = currentPath === "/chat" && selectedConversationId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`sidebar-conv${isActive ? " active" : ""}`}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => handleSelectConv(c.id)}
                    title={c.title}
                  >
                    <span className="sidebar-conv-title">{c.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="sidebar-foot">
          <div className="sidebar-foot-card">
            <div className="sidebar-foot-info">
              <div className="sidebar-foot-avatar" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </div>
              <div className="sidebar-foot-meta">
                <span className="sidebar-foot-user">telo@local</span>
                <span className="sidebar-foot-status">
                  {health.isLoading ? "Conectando…" : isOnline ? "Listo · Servidor local" : "Sin conexión"}
                </span>
              </div>
            </div>
            <span
              className={`pill-dot${isOnline ? " is-live" : " is-offline"}`}
              aria-label={isOnline ? "Servidor activo" : "Servidor desconectado"}
            />
          </div>
        </div>
      </aside>

      {/* Scrim para cerrar cajón en móvil */}
      {drawerOpen && <div className="scrim dim" onClick={closeDrawer} aria-hidden="true" />}

      {/* Contenedor principal de la aplicación */}
      <div className="shell-main">
        {children}
      </div>
    </div>
  );
}
