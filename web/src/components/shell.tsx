import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation, type Project } from "../api";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { useLatencia } from "../lib/latencia";
import { useNotificacionesDeTareas } from "../lib/notificaciones";
import { VERSION_SISTEMA } from "../lib/version-sistema";
import { AppNav } from "./nav";
import { ConvItem } from "./conv-item";
import { NuevoProyectoDialog } from "./proyecto-nuevo";
import { HistorialCambios } from "./historial-cambios";
import { LoadingSkeleton } from "./loading-skeleton";
import { PaletaComandos } from "./paleta-comandos";
import { useShell } from "./shell-context";
import { ShellTopbar } from "./shell-topbar";
import { nuevoChatDelProyecto } from "../lib/chat-proyecto";
import { aprobacionRevisada } from "../lib/actividad-chat";
import "../styles-shell.css";



// El atajo se muestra según el sistema: ⌘N en Mac, Ctrl+N en lo demás.
const ES_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ATAJO_NUEVO = ES_MAC ? "⌘N" : "Ctrl+N";

// Cuántas conversaciones trae cada tanda del historial (paginación del servidor).
const CANTIDAD_HISTORIAL = 50;

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
  const [historialCambiosAbierto, setHistorialCambiosAbierto] = useState(false);
  const versionRef = useRef<HTMLButtonElement>(null);
  const mostrarInstalar = !isStandalone() && (install.canInstall || isIOS());

  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  // Cada 5 s refresca la primera tanda del historial; las más antiguas se cargan con «Cargar anteriores».
  const conversations = useQuery({
    queryKey: ["conversations", "historial"],
    queryFn: () => api.listConversationsPaginadas(CANTIDAD_HISTORIAL, null),
    refetchInterval: 5_000,
  });
  // Tandas más antiguas ya cargadas, cada una con el cursor con que se pidió:
  // así el refresco de la primera (o otra tanda) no duplica ni desordena lo ya mostrado.
  const [anteriores, setAnteriores] = useState<{ desde: string; items: Conversation[]; siguiente: string | null }[]>([]);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const siguientePendiente = anteriores.length
    ? anteriores[anteriores.length - 1].siguiente
    : conversations.data?.siguiente ?? null;
  const cargarAnteriores = async () => {
    const desde = siguientePendiente;
    if (!desde || cargandoAnteriores) return;
    setCargandoAnteriores(true);
    try {
      const pagina = await api.listConversationsPaginadas(CANTIDAD_HISTORIAL, desde);
      setAnteriores((prev) => [...prev, { desde, items: pagina.conversations, siguiente: pagina.siguiente }]);
    } catch {
      // El usuario reintenta con el mismo botón; la tanda anterior no se toca.
    } finally {
      setCargandoAnteriores(false);
    }
  };

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    refetchInterval: 5_000,
  });

  const qc = useQueryClient();
  // Avisos del sistema cuando una tarea termina, falla o pide decisión (activos por defecto).
  useNotificacionesDeTareas();
  const invalidarChats = () => {
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
  };
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
      setAnteriores((prev) => prev.map((t) => ({ ...t, items: t.items.filter((c) => c.id !== id) })));
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

  // Menú desplegable multifunción para "+ Nuevo..."
  const [menuNuevoAbierto, setMenuNuevoAbierto] = useState(false);
  const menuNuevoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuNuevoAbierto) return;
    const onClicFuera = (e: MouseEvent) => {
      if (menuNuevoRef.current && !menuNuevoRef.current.contains(e.target as Node)) {
        setMenuNuevoAbierto(false);
      }
    };
    const onTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuNuevoAbierto(false);
    };
    document.addEventListener("mousedown", onClicFuera);
    document.addEventListener("keydown", onTecla);
    return () => {
      document.removeEventListener("mousedown", onClicFuera);
      document.removeEventListener("keydown", onTecla);
    };
  }, [menuNuevoAbierto]);

  const crearChatLibre = useMutation({
    mutationFn: () => api.createConversation(null),
    onSuccess: (conv) => {
      void invalidarChats();
      setSelectedConversationId(conv.id);
      setMenuNuevoAbierto(false);
      closeDrawer();
      if (currentPath !== "/chat") {
        void navigate({ to: "/chat" });
      }
    },
  });

  const conversacionActiva =
    conversations.data?.conversations.find((c) => c.id === selectedConversationId) ??
    anteriores.flatMap((t) => t.items).find((c) => c.id === selectedConversationId) ??
    null;
  const proyectoActivoId = conversacionActiva?.project_id ?? null;
  const proyectoActivoNombre = conversacionActiva?.project_name ?? null;

  const crearChatProyecto = useMutation({
    mutationFn: (pId: string) => nuevoChatDelProyecto(pId),
    onSuccess: (conv) => {
      void invalidarChats();
      setSelectedConversationId(conv.id);
      setMenuNuevoAbierto(false);
      closeDrawer();
      if (currentPath !== "/chat") {
        void navigate({ to: "/chat" });
      }
    },
  });

  // Estado de carpetas de proyectos expandidas/colapsadas en el árbol
  const [proyectosExpandidos, setProyectosExpandidos] = useState<Record<string, boolean>>(() => {
    try {
      const guardado = localStorage.getItem("telo_proyectos_expandidos");
      if (guardado) return JSON.parse(guardado);
    } catch {
      // ignorar
    }
    return {};
  });

  const toggleProyectoExpandido = (id: string) => {
    setProyectosExpandidos((prev) => {
      const actual = prev[id] !== undefined ? prev[id] : true;
      const next = { ...prev, [id]: !actual };
      try {
        localStorage.setItem("telo_proyectos_expandidos", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Si el usuario tiene seleccionado un chat de un proyecto, expandimos automáticamente esa carpeta
  useEffect(() => {
    if (proyectoActivoId) {
      setProyectosExpandidos((prev) => {
        if (prev[proyectoActivoId] !== false) return prev;
        const next = { ...prev, [proyectoActivoId]: true };
        try {
          localStorage.setItem("telo_proyectos_expandidos", JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [proyectoActivoId]);

  const [filtroTexto, setFiltroTexto] = useState("");
  const [mostrarFiltro, setMostrarFiltro] = useState(false);
  const q = filtroTexto.trim().toLowerCase();

  // La búsqueda con filtro pide el historial COMPLETO aparte (la paginación solo marca el paseo).
  const busqueda = useQuery({
    queryKey: ["conversations", "buscar"],
    queryFn: api.listConversations,
    enabled: q.length > 0,
  });

  // Lo que ve el muelle: la primera tanda + las tandas antiguas cargadas, sin repetir ids
  // (una conversación recién anclada sube a la primera tanda y su copia vieja deja de verse).
  const listadoConversaciones = useMemo<Conversation[]>(() => {
    const cargadas = [...(conversations.data?.conversations ?? []), ...anteriores.flatMap((t) => t.items)];
    if (!q) {
      const porId = new Map<string, Conversation>();
      for (const c of cargadas) porId.set(c.id, c);
      return [...porId.values()];
    }
    if (busqueda.data) return busqueda.data;
    // Mientras llega el listado completo, se busca en lo ya cargado para no parpadear.
    return cargadas.filter((c) => c.title.toLowerCase().includes(q));
  }, [q, busqueda.data, conversations.data, anteriores]);

  // Chats organizados por proyecto y chats libres (sin proyecto)
  const chatsPorProyecto = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of listadoConversaciones) {
      if (c.project_id) {
        const arr = map.get(c.project_id) || [];
        arr.push(c);
        map.set(c.project_id, arr);
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) {
          return a.pinned_at ? -1 : 1;
        }
        const timeA = new Date(a.last_message_at || a.created_at).getTime();
        const timeB = new Date(b.last_message_at || b.created_at).getTime();
        return timeB - timeA;
      });
    }
    return map;
  }, [listadoConversaciones]);

  const chatsLibres = useMemo(() => {
    const list = listadoConversaciones.filter((c) => !c.project_id);
    list.sort((a, b) => {
      if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) {
        return a.pinned_at ? -1 : 1;
      }
      const timeA = new Date(a.last_message_at || a.created_at).getTime();
      const timeB = new Date(b.last_message_at || b.created_at).getTime();
      return timeB - timeA;
    });
    return list;
  }, [listadoConversaciones]);

  const proyectosFiltrados = useMemo(() => {
    if (!projects.data) return [];
    if (!q) return projects.data;
    return projects.data.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      const chats = chatsPorProyecto.get(p.id) || [];
      return chats.some((c) => c.title.toLowerCase().includes(q));
    });
  }, [projects.data, chatsPorProyecto, q]);

  const chatsLibresFiltrados = useMemo(() => {
    if (!q) return chatsLibres;
    return chatsLibres.filter((c) => c.title.toLowerCase().includes(q));
  }, [chatsLibres, q]);

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

          <div className="tl-nuevo-wrap" ref={menuNuevoRef}>
            <button
              type="button"
              className={`tl-nuevo${menuNuevoAbierto ? " is-activo" : ""}`}
              onClick={() => setMenuNuevoAbierto((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuNuevoAbierto}
              title={`Crear nuevo... (${ATAJO_NUEVO} para proyecto)`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="tl-nuevo-texto">Nuevo…</span>
              <kbd className="tl-kbd">{ATAJO_NUEVO}</kbd>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`tl-nuevo-flecha${menuNuevoAbierto ? " is-abierta" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {menuNuevoAbierto && (
              <div className="tl-nuevo-desplegable" role="menu" aria-label="Opciones de creación">
                <button
                  type="button"
                  className="tl-nuevo-item"
                  role="menuitem"
                  onClick={() => {
                    crearChatLibre.mutate();
                  }}
                  disabled={crearChatLibre.isPending}
                >
                  <span className="tl-nuevo-item-icono is-libre" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <div className="tl-nuevo-item-texto">
                    <strong>Nuevo chat libre</strong>
                    <span>Conversación independiente, sin proyecto</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="tl-nuevo-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuNuevoAbierto(false);
                    abrirNuevoProyecto();
                  }}
                >
                  <span className="tl-nuevo-item-icono is-proyecto" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </span>
                  <div className="tl-nuevo-item-texto">
                    <strong>Nuevo proyecto</strong>
                    <span>Workspace y repositorio Git</span>
                  </div>
                  <kbd className="tl-kbd">{ATAJO_NUEVO}</kbd>
                </button>

                {proyectoActivoId && (
                  <button
                    type="button"
                    className="tl-nuevo-item"
                    role="menuitem"
                    onClick={() => {
                      crearChatProyecto.mutate(proyectoActivoId);
                    }}
                    disabled={crearChatProyecto.isPending}
                  >
                    <span className="tl-nuevo-item-icono is-proyecto-chat" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </span>
                    <div className="tl-nuevo-item-texto">
                      <strong>Nuevo chat en este proyecto</strong>
                      <span>Hilo en «{proyectoActivoNombre || "Proyecto"}»</span>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          <AppNav variant="sidebar" onItemClick={closeDrawer} />

          <div className="tl-rail-lista">
            {(conversations.isLoading || projects.isLoading) && !conversations.data && !projects.data && (
              <LoadingSkeleton tipo="lineas" cantidad={5} className="tl-rail-carga" />
            )}
            {(conversations.isError || projects.isError) && (
              <div className="tl-rail-aviso tl-rail-aviso-error">
                <span>Error al cargar</span>
                <button
                  type="button"
                  className="tl-boton"
                  onClick={() => {
                    void conversations.refetch();
                    void projects.refetch();
                  }}
                >
                  Reintentar
                </button>
              </div>
            )}
            {accionError && (
              <p className="error tl-rail-error" role="alert">
                {accionError}
              </p>
            )}

            {/* SECCIÓN 1: PROJECTS (Árbol con carpetas colapsables y chats anidados) */}
            <div className="tl-rail-seccion">
              <div className="tl-rail-seccion-head">
                <span className="tl-rail-seccion-titulo">Proyectos</span>
                <div className="tl-rail-seccion-acciones">
                  <button
                    type="button"
                    className={`tl-rail-icono-btn${mostrarFiltro ? " is-activo" : ""}`}
                    onClick={() => {
                      setMostrarFiltro((v) => !v);
                      if (mostrarFiltro) setFiltroTexto("");
                    }}
                    title="Filtrar proyectos y chats"
                    aria-label="Filtrar proyectos y chats"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="4" y1="6" x2="20" y2="6" />
                      <line x1="7" y1="12" x2="17" y2="12" />
                      <line x1="10" y1="18" x2="14" y2="18" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="tl-rail-icono-btn"
                    onClick={() => abrirNuevoProyecto()}
                    title="Nuevo proyecto (Ctrl+N)"
                    aria-label="Nuevo proyecto"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </button>
                </div>
              </div>

              {mostrarFiltro && (
                <div className="tl-rail-filtro-wrap">
                  <input
                    type="search"
                    className="tl-rail-filtro-input"
                    placeholder="Filtrar proyectos y chats…"
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                    autoFocus
                  />
                </div>
              )}

              <div className="tl-proyectos-arbol">
                {proyectosFiltrados.length === 0 && !projects.isLoading && (
                  <div className="tl-rail-seccion-vacio">
                    <span>{q ? "Sin proyectos coincidentes" : "Sin proyectos aún"}</span>
                  </div>
                )}
                {proyectosFiltrados.map((p) => {
                  const expandido = Boolean(filtroTexto) || (proyectosExpandidos[p.id] ?? true);
                  const chats = chatsPorProyecto.get(p.id) || [];
                  const tieneRevisionNueva = chats.some((chat) => chat.pendiente_aprobacion && !aprobacionRevisada(chat)) ||
                    (p.pendiente_aprobacion && !chats.some((chat) => chat.pendiente_aprobacion));
                  const chatsVisibles = filtroTexto
                    ? chats.filter((c) => c.title.toLowerCase().includes(q))
                    : chats;
                  const tieneChatActivo = chats.some((c) => c.id === selectedConversationId || c.subchats?.some((hijo) => hijo.id === selectedConversationId));

                  return (
                    <div
                      key={p.id}
                      className={`tl-proyecto-rama${expandido ? " is-expandido" : ""}${tieneChatActivo ? " has-active" : ""}`}
                    >
                      <div className="tl-proyecto-fila">
                        <button
                          type="button"
                          className={`tl-proyecto-carpeta${tieneChatActivo ? " is-activo" : ""}`}
                          onClick={() => toggleProyectoExpandido(p.id)}
                          title={`${p.name} (${chats.length} chats)`}
                        >
                          <span className="tl-proyecto-icono" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          </span>
                          <span className="tl-proyecto-nombre">{p.name}</span>
                          <span className="tl-proyecto-meta">
                            {!expandido && p.en_proceso ? (
                              <span className="tl-indicador-spinner" title="Proyecto con tareas en proceso…">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                              </span>
                            ) : !expandido && tieneRevisionNueva ? (
                              <span className="tl-indicador-alerta" title="Requiere aprobación / atención">
                                <span className="tl-indicador-dot is-pendiente" />
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="tl-proyecto-nuevo-chat-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            crearChatProyecto.mutate(p.id);
                          }}
                          disabled={crearChatProyecto.isPending}
                          title={`Nuevo chat en ${p.name}`}
                          aria-label={`Nuevo chat en ${p.name}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      </div>

                      {expandido && (
                        <div className="tl-proyecto-hijos">
                          {chatsVisibles.length === 0 ? (
                            <div className="tl-proyecto-vacio">
                              <span>Sin chats</span>
                              <button
                                type="button"
                                className="tl-proyecto-vacio-btn"
                                onClick={() => crearChatProyecto.mutate(p.id)}
                              >
                                + Crear chat
                              </button>
                            </div>
                          ) : (
                            chatsVisibles.map((c) => (
                              <ConvItem
                                key={c.id}
                                conv={c}
                                variant="arbol"
                                active={currentPath === "/chat" && (selectedConversationId === c.id || Boolean(c.subchats?.some((hijo) => hijo.id === selectedConversationId)))}
                                selectedConversationId={selectedConversationId}
                                onSelect={handleSelectConv}
                                onRename={(id, title) => renombrar.mutate({ id, title })}
                                onTogglePin={(id, pinned) => anclar.mutate({ id, pinned })}
                                onDelete={(id) => eliminar.mutate(id)}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SECCIÓN 2: CONVERSATIONS (Chats libres no ligados a proyectos) */}
            <div className="tl-rail-seccion tl-rail-seccion-conversaciones">
              <div className="tl-rail-seccion-head">
                <span className="tl-rail-seccion-titulo">Conversaciones</span>
                <div className="tl-rail-seccion-acciones">
                  <button
                    type="button"
                    className="tl-rail-icono-btn"
                    onClick={() => crearChatLibre.mutate()}
                    disabled={crearChatLibre.isPending}
                    title="Nueva conversación libre"
                    aria-label="Nueva conversación libre"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="tl-conversaciones-lista">
                {chatsLibresFiltrados.length === 0 ? (
                  <div className="tl-rail-seccion-vacio">
                    <span>{q ? "Sin conversaciones coincidentes" : "Sin conversaciones sueltas"}</span>
                  </div>
                ) : (
                  chatsLibresFiltrados.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      variant="arbol"
                      active={currentPath === "/chat" && (selectedConversationId === c.id || Boolean(c.subchats?.some((hijo) => hijo.id === selectedConversationId)))}
                      selectedConversationId={selectedConversationId}
                      onSelect={handleSelectConv}
                      onRename={(id, title) => renombrar.mutate({ id, title })}
                      onTogglePin={(id, pinned) => anclar.mutate({ id, pinned })}
                      onDelete={(id) => eliminar.mutate(id)}
                    />
                  ))
                )}
                {siguientePendiente && !q && (
                  <button
                    type="button"
                    className="tl-ver-anteriores"
                    onClick={() => void cargarAnteriores()}
                    disabled={cargandoAnteriores}
                  >
                    {cargandoAnteriores ? "Cargando anteriores…" : "Cargar anteriores"}
                  </button>
                )}
              </div>
            </div>
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
          <button
            ref={versionRef}
            type="button"
            className="tl-rail-version"
            aria-label={`Ver historial de cambios de la versión ${VERSION_SISTEMA}`}
            aria-haspopup="dialog"
            aria-expanded={historialCambiosAbierto}
            onClick={() => setHistorialCambiosAbierto(true)}
          >
            Versión {VERSION_SISTEMA}
          </button>
        </div>
      </aside>

      {nuevoProyectoAbierto && <NuevoProyectoDialog onCerrar={() => setNuevoProyectoAbierto(false)} />}
      {historialCambiosAbierto && (
        <HistorialCambios
          disparador={versionRef}
          onCerrar={() => setHistorialCambiosAbierto(false)}
        />
      )}

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
