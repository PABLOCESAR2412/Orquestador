import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { useLatencia } from "../lib/latencia";
import { AppNav } from "./nav";
import { ConvItem } from "./conv-item";
import { PaletaComandos } from "./paleta-comandos";
import { useShell } from "./shell-context";

type DateGroupTitle = "ANCLADOS" | "HOY" | "AYER" | "ÚLTIMOS 7 DÍAS" | "ANTERIORES";

function getGroupForDate(dateStr: string | null | undefined): DateGroupTitle {
  if (!dateStr) return "ANTERIORES";
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7Days = startOfToday - 6 * 86_400_000;
  const time = d.getTime();

  if (time >= startOfToday) return "HOY";
  if (time >= startOfYesterday) return "AYER";
  if (time >= startOf7Days) return "ÚLTIMOS 7 DÍAS";
  return "ANTERIORES";
}

export function Shell({ children }: { children: ReactNode }) {
  const {
    drawerOpen,
    closeDrawer,
    selectedConversationId,
    setSelectedConversationId,
  } = useShell();

  // Instalar la app: en Chrome/Edge con el evento del navegador; en iPhone, con instrucciones.
  const install = useInstallPrompt();
  const [pistaIOS, setPistaIOS] = useState(false);
  const mostrarInstalar = !isStandalone() && (install.canInstall || isIOS());

  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  // Cada 5 s para ver al instante los chats creados, renombrados o ocupados desde otro dispositivo.
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
    refetchInterval: 5_000,
  });

  const qc = useQueryClient();
  const invalidarChats = () => qc.invalidateQueries({ queryKey: ["conversations"] });

  const renombrar = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.updateConversation(id, { title }),
    onSettled: () => void invalidarChats(),
  });
  const anclar = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.updateConversation(id, { pinned }),
    onSettled: () => void invalidarChats(),
  });
  const eliminar = useMutation({
    mutationFn: (id: string) => api.deleteConversation(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ["messages", id] });
      if (selectedConversationId === id) setSelectedConversationId(null);
    },
    onSettled: () => void invalidarChats(),
  });

  const accionError = renombrar.isError
    ? errorText(renombrar.error)
    : anclar.isError
      ? errorText(anclar.error)
      : eliminar.isError
        ? errorText(eliminar.error)
        : null;

  const groupedConversations = useMemo(() => {
    if (!conversations.data) return [];
    const groups: { title: DateGroupTitle; items: Conversation[] }[] = [
      { title: "ANCLADOS", items: [] },
      { title: "HOY", items: [] },
      { title: "AYER", items: [] },
      { title: "ÚLTIMOS 7 DÍAS", items: [] },
      { title: "ANTERIORES", items: [] },
    ];
    for (const c of conversations.data) {
      const groupTitle = c.pinned_at ? "ANCLADOS" : getGroupForDate(c.created_at);
      const target = groups.find((g) => g.title === groupTitle);
      if (target) target.items.push(c);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [conversations.data]);

  // Latencia medida desde este navegador (ida y vuelta a /api/health), cada 30 s.
  const latencia = useLatencia();

  const handleSelectConv = (id: string) => {
    setSelectedConversationId(id);
    closeDrawer();
    if (currentPath !== "/chat") {
      void navigate({ to: "/chat" });
    }
  };

  // El estado va en texto además del color del punto: "Listo · 42 ms", "Lenta · 310 ms" o "Sin conexión".
  const etiquetaLatencia =
    latencia.estado === "midiendo"
      ? "Conectando…"
      : latencia.estado === "sin_conexion"
        ? "Sin conexión"
        : `${latencia.estado === "buena" ? "Listo" : "Lenta"} · ${latencia.ms} ms`;
  const claseEstado =
    latencia.estado === "buena"
      ? "is-live"
      : latencia.estado === "lenta"
        ? "is-slow"
        : latencia.estado === "sin_conexion"
          ? "is-offline"
          : "";

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
                <div className="estado-linea">
                  <span className="sidebar-empty">Error al cargar</span>
                  <button type="button" className="ghost task-mini-btn" onClick={() => void conversations.refetch()}>
                    Reintentar
                  </button>
                </div>
              )}
              {accionError && (
                <p className="error sidebar-error" role="alert">
                  {accionError}
                </p>
              )}
              {conversations.data && conversations.data.length === 0 && (
                <span className="sidebar-empty">Sin conversaciones</span>
              )}
              {groupedConversations.map((group) => (
                <div key={group.title} className="sidebar-group">
                  <div className="sidebar-group-title">{group.title}</div>
                  {group.items.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={currentPath === "/chat" && selectedConversationId === c.id}
                      onSelect={handleSelectConv}
                      onRename={(id, title) => renombrar.mutate({ id, title })}
                      onTogglePin={(id, pinned) => anclar.mutate({ id, pinned })}
                      onDelete={(id) => eliminar.mutate(id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {mostrarInstalar && (
          <div className="sidebar-install">
            <button
              type="button"
              className="sidebar-install-btn"
              onClick={() => (install.canInstall ? void install.promptInstall() : setPistaIOS((p) => !p))}
            >
              Instalar Telo
            </button>
            {pistaIOS && !install.canInstall && (
              <p className="sidebar-install-hint">
                En iPhone: toca Compartir y luego «Agregar a pantalla de inicio».
              </p>
            )}
          </div>
        )}

        <div className="sidebar-foot">
          <div className="sidebar-foot-card">
            <div className="sidebar-foot-info">
              <div className="sidebar-foot-meta">
                <span className="sidebar-foot-status">{etiquetaLatencia}</span>
              </div>
            </div>
            <span className={`pill-dot ${claseEstado}`} aria-hidden="true" />
          </div>
        </div>
      </aside>

      {/* Scrim para cerrar cajón en móvil */}
      {drawerOpen && <div className="scrim dim" onClick={closeDrawer} aria-hidden="true" />}

      {/* Contenedor principal de la aplicación */}
      <div className="shell-main">
        {children}
      </div>

      {/* Paleta de comandos: Ctrl+K o Cmd+K desde cualquier pantalla */}
      <PaletaComandos />
    </div>
  );
}
