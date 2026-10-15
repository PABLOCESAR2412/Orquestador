import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { useLatencia } from "../lib/latencia";
import { useNotificacionesDeTareas } from "../lib/notificaciones";
import { VERSION_SISTEMA } from "../lib/version-sistema";
import { AppNav } from "./nav";
import { ConvItem } from "./conv-item";
import { NuevoProyectoDialog } from "./proyecto-nuevo";
import { PaletaComandos } from "./paleta-comandos";
import { useShell } from "./shell-context";
import { ShellTopbar } from "./shell-topbar";
import "../styles-shell.css";

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

// El atajo se muestra según el sistema: ⌘N en Mac, Ctrl+N en lo demás.
const ES_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ATAJO_NUEVO = ES_MAC ? "⌘N" : "Ctrl+N";

export function Shell({ children }: { children: ReactNode }) {
  const {
    drawerOpen,
    closeDrawer,
    toggleDrawer,
    selectedConversationId,
    setSelectedConversationId,
    nuevoProyectoAbierto,
    setNuevoProyectoAbierto,
    abrirNuevoProyecto,
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
  // Avisos del sistema cuando una tarea termina, falla o pide decisión (activos por defecto).
  useNotificacionesDeTareas();
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

  // Estado del servidor: ida y vuelta a /api/health, cada 30 s (ver lib/latencia.ts).
  const latencia = useLatencia();

  // "Nuevo proyecto" abre su ventana desde cualquier pantalla (también Ctrl+N).
  const nuevoRef = useRef(abrirNuevoProyecto);
  useEffect(() => {
    nuevoRef.current = abrirNuevoProyecto;
  });

  // ⌘N / Ctrl+N desde cualquier pantalla. Ctrl+Shift+N (ventana privada) y Alt siguen siendo del navegador.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        nuevoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      ? "is-online"
      : latencia.estado === "lenta"
        ? "is-slow"
        : latencia.estado === "sin_conexion"
          ? "is-offline"
          : "";

  return (
    <div className="tl-app">
      {/* Riel fijo en escritorio, cajón en móvil */}
      <aside className={`tl-rail${drawerOpen ? " open" : ""}`} aria-label="Barra lateral">
        <div className="tl-rail-top">
          <div className="tl-rail-marca">
            <Link to="/chat" className="tl-marca" onClick={closeDrawer} aria-label="telo: ir al chat">
              <span className="tl-marca-icono" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <span className="tl-marca-nombre">telo</span>
            </Link>
            <button type="button" className="tl-rail-cerrar" onClick={closeDrawer} aria-label="Cerrar barra lateral">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="tl-nuevo"
            onClick={abrirNuevoProyecto}
            title={`Nuevo proyecto (${ATAJO_NUEVO})`}
            aria-keyshortcuts={ES_MAC ? "Meta+N" : "Control+N"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="tl-nuevo-texto">Nuevo proyecto</span>
            <kbd className="tl-kbd">{ATAJO_NUEVO}</kbd>
          </button>

          <AppNav variant="sidebar" onItemClick={closeDrawer} />

          <div className="tl-rail-lista">
            {conversations.isLoading && <span className="tl-rail-aviso">Cargando…</span>}
            {conversations.isError && (
              <div className="tl-rail-aviso tl-rail-aviso-error">
                <span>Error al cargar</span>
                <button type="button" className="tl-boton" onClick={() => void conversations.refetch()}>
                  Reintentar
                </button>
              </div>
            )}
            {accionError && (
              <p className="error tl-rail-error" role="alert">
                {accionError}
              </p>
            )}
            {groupedConversations.map((group) => (
              <div key={group.title} className="tl-grupo">
                <div className="tl-grupo-titulo">{group.title}</div>
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

        {mostrarInstalar && (
          <div className="tl-instalar">
            <button
              type="button"
              className="tl-boton tl-instalar-boton"
              onClick={() => (install.canInstall ? void install.promptInstall() : setPistaIOS((p) => !p))}
            >
              Instalar Telo
            </button>
            {pistaIOS && !install.canInstall && (
              <p className="tl-instalar-pista">En iPhone: toca Compartir y luego «Agregar a pantalla de inicio».</p>
            )}
          </div>
        )}

        <div className="tl-rail-pie">
          <div className="tl-rail-estado">
            <span className={`tl-punto ${claseEstado}`} aria-hidden="true" />
            <div className="tl-rail-estado-texto">
              <span className="tl-rail-estado-titulo">Servidor</span>
              <span>{etiquetaLatencia}</span>
            </div>
          </div>
          <hr className="tl-rail-separador" />
          <p className="tl-rail-version">Versión {VERSION_SISTEMA}</p>
        </div>
      </aside>

      {nuevoProyectoAbierto && <NuevoProyectoDialog onCerrar={() => setNuevoProyectoAbierto(false)} />}

      {/* Scrim para cerrar el cajón en móvil */}
      {drawerOpen && <div className="scrim dim" onClick={closeDrawer} aria-hidden="true" />}

      <div className="tl-main">
        <ShellTopbar latencia={latencia} drawerOpen={drawerOpen} onMenu={toggleDrawer} />
        <div className={`tl-pagina${currentPath === "/chat" ? " is-chat" : ""}`}>{children}</div>
      </div>

      {/* Paleta de comandos: Ctrl+K o Cmd+K desde cualquier pantalla */}
      <PaletaComandos />
    </div>
  );
}
