import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { useShell } from "../components/shell-context";
import { OficinaLienzo, type OficinaLienzoHandle } from "../components/oficina-lienzo";
import { useEventosVivos } from "../lib/eventos-vivos";
import { entradasDesdeConversaciones, nombreAgente } from "../lib/oficina-datos";
import { entradasDemo, parametroDemo } from "../lib/oficina-demo";
import { ESCRITORIOS } from "../lib/oficina-mapa";
import { errorText } from "../lib/model";
import "../styles-oficina.css";

function estado(c: Conversation) {
  if (c.subagent_status === "failed") return "Error";
  if (c.subagent_status === "cancelled") return "Cancelado";
  if (c.subagent_status === "interrupted") return "Interrumpido";
  if (c.pendiente_aprobacion) return "Espera aprobación";
  if (c.subagent_status === "running" || c.en_proceso || c.ocupada) return "En ejecución";
  if (c.subagent_status === "done" || c.completada) return "Completado";
  return "Sin actividad";
}

const activa = (c: Conversation) => Boolean(c.en_proceso || c.ocupada || c.pendiente_aprobacion);
type AccionAgente = { tipo: "apodo"; id: string; apodo: string } | { tipo: "detener"; id: string };

export function OfficePage() {
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const queryClient = useQueryClient();
  const lienzo = useRef<OficinaLienzoHandle>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [apodo, setApodo] = useState<string | null>(null);
  const botonMenu = useRef<HTMLButtonElement | null>(null);
  function cerrarMenu() {
    setMenu(null);
    setApodo(null);
    botonMenu.current?.focus();
  }
  const accionAgente = useMutation({
    mutationFn: async (accion: AccionAgente) => {
      if (accion.tipo === "detener") await api.detenerChat(accion.id);
      else await api.updateConversation(accion.id, { apodo_oficina: accion.apodo.trim() || null });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      cerrarMenu();
    },
  });
  // Último paso de actividad de cada chat (la burbuja del personaje). Se refresca con los eventos en vivo.
  const pasos = useRef(new Map<string, string>());
  const [versionPasos, setVersionPasos] = useState(0);
  const temporizador = useRef<number>(undefined);
  const avisarPasos = () => {
    if (temporizador.current !== undefined) return;
    temporizador.current = window.setTimeout(() => { temporizador.current = undefined; setVersionPasos((v) => v + 1); }, 400);
  };
  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const { conectado } = useEventosVivos({}, (evento) => {
    if (evento.tipo === "chat" || evento.tipo === "configuracion_chat") {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (evento.tipo === "chat" && evento.estado === "terminado") { pasos.current.delete(evento.conversacion_id); avisarPasos(); }
    }
    if (evento.tipo === "actividad" && evento.paso.estado !== "texto") {
      pasos.current.set(evento.conversacion_id, evento.paso.titulo);
      avisarPasos();
    }
  });
  const conversaciones = useQuery({ queryKey: ["conversations"], queryFn: api.listConversations, refetchInterval: 30_000, refetchIntervalInBackground: false });

  // ?demo=N (solo en desarrollo o localhost): N chats falsos que cambian de estado, para calibrar y medir
  const demo = useMemo(() => parametroDemo(window.location.search, window.location.hostname, import.meta.env.DEV), []);
  const calibrar = useMemo(() => {
    const local = import.meta.env.DEV || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    return local && new URLSearchParams(window.location.search).has("calibrar");
  }, []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 3000);
    return () => window.clearInterval(id);
  }, [demo]);

  const principales = useMemo(() => (conversaciones.data ?? []).filter((c) => !c.parent_conversation_id), [conversaciones.data]);
  const entradas = useMemo(
    () => (demo ? entradasDemo(demo, tick) : entradasDesdeConversaciones(conversaciones.data ?? [], pasos.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demo, tick, conversaciones.data, versionPasos],
  );
  const ordenados = useMemo(
    () => [...principales].sort((a, b) => Number(activa(b)) - Number(activa(a))),
    [principales],
  );

  const abrir = (id: string) => { setSelectedConversationId(id); void navigate({ to: "/chat" }); };
  const actual = principales.find((c) => c.id === seleccion) ??
    principales.flatMap((c) => c.subchats ?? []).find((c) => c.id === seleccion);
  const agentes = ordenados.flatMap((principal) => [
    { agente: principal, principal },
    ...(principal.subchats ?? [])
      .filter((hijo) => hijo.subagent_status === "running")
      .map((agente) => ({ agente, principal })),
  ]);
  const elegir = (id: string, enfocar = false) => { setSeleccion(id); if (enfocar) lienzo.current?.enfocar(id); };

  const trabajando = entradas.filter((e) => !e.padre && e.estado === "trabajando").length;
  const esperan = entradas.filter((e) => e.estado === "aprobacion").length;
  const sinEscritorio = Math.max(0, (demo ?? principales.length) - ESCRITORIOS);

  return <main className="oficina container">
    <header className="oficina-cabecera"><div><h1>Oficina</h1><p>Supervisores, conversaciones y sus subagentes en un espacio compartido.</p></div><span>{conectado ? "Estados en vivo" : "Respaldo cada 30 segundos"}</span></header>
    {conversaciones.isError && <p role="alert">No se pudieron cargar los agentes. <button type="button" onClick={() => void conversaciones.refetch()}>Reintentar</button></p>}
    <div className="oficina-distribucion">
      <section className="oficina-escena" aria-label="Oficina de agentes">
        <OficinaLienzo ref={lienzo} entradas={entradas} seleccion={seleccion} onSeleccion={(id) => elegir(id)} calibrar={calibrar} />
        <ul className="oficina-leyenda" aria-label="Qué significa cada lugar">
          <li><b>Escritorio</b> con pantalla encendida: trabajando</li>
          <li><b>Sala de reuniones</b>: planifica con su equipo</li>
          <li><b>Mesa conjunta</b>: supervisor y subagentes trabajando juntos</li>
          <li><b>Frente al gerente</b>: espera tu aprobación</li>
        </ul>
        <p className="oficina-resumen" role="status">{principales.length || demo || 0} conversaciones · {trabajando} trabajando · {esperan} esperan aprobación{sinEscritorio > 0 ? ` · +${sinEscritorio} sin escritorio` : ""}</p>
        {conversaciones.isPending && !demo && <p role="status">Cargando agentes…</p>}
        {!conversaciones.isPending && !demo && principales.length === 0 && <p className="oficina-vacia">Tus conversaciones aparecerán aquí como personajes con su escritorio.</p>}
      </section>
      <aside className="oficina-actividad">
        <h2>Agentes</h2>
        {actual ? <div className="oficina-detalle">
          <button type="button" className="btn-ghost" onClick={() => abrir(actual.id)}>Abrir chat</button>
        </div> : <p>{agentes.length ? "Selecciona un agente para abrir su chat." : "Crea o abre un chat para empezar."}</p>}
        {agentes.length > 0 && <>
          <h3>Todos los agentes</h3>
          {accionAgente.isError && <p className="oficina-error" role="alert">{errorText(accionAgente.error)}</p>}
          <ul className="oficina-lista">
            {agentes.map(({ agente, principal }) => {
              const nombre = nombreAgente(agente);
              const esSubagente = agente.id !== principal.id;
              const menuAbierto = menu === agente.id;
              const menuId = `oficina-acciones-${agente.id}`;
              return <li key={agente.id} className={esSubagente ? "oficina-subagente" : undefined}
                onKeyDown={(evento) => { if (evento.key === "Escape" && menuAbierto) cerrarMenu(); }}>
                <div className="oficina-lista-item">
                  <button type="button" className={`oficina-lista-fila${actual?.id === agente.id ? " is-selected" : ""}`}
                    aria-pressed={actual?.id === agente.id} onClick={() => elegir(agente.id, true)}>
                    <span className={`oficina-punto${agente.pendiente_aprobacion ? " is-aprobacion" : activa(agente) ? " is-activa" : ""}`} aria-hidden="true" />
                    <span className="oficina-lista-titulo" title={nombre}>{nombre}</span><small>{estado(agente)}</small>
                  </button>
                  <button type="button" className="oficina-menu-boton" aria-label={`Acciones de ${nombre}`}
                    aria-expanded={menuAbierto} aria-controls={menuAbierto ? menuId : undefined} aria-disabled={accionAgente.isPending}
                    onClick={(evento) => {
                      if (accionAgente.isPending) return;
                      if (menuAbierto) cerrarMenu();
                      else {
                        botonMenu.current = evento.currentTarget;
                        setMenu(agente.id);
                        setApodo(null);
                        accionAgente.reset();
                      }
                    }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" />
                    </svg>
                  </button>
                </div>
                {menuAbierto && <div className="oficina-acciones" id={menuId}>
                  {apodo === null ? <>
                    <button type="button" className="btn-ghost" disabled={accionAgente.isPending} onClick={() => setApodo(agente.apodo_oficina ?? "")}>Cambiar apodo</button>
                    {activa(principal) && <button type="button" className="btn-ghost oficina-detener" disabled={accionAgente.isPending}
                      onClick={() => accionAgente.mutate({ tipo: "detener", id: principal.id })}>
                      {esSubagente ? "Detener equipo" : "Detener"}
                    </button>}
                  </> : <form className="oficina-apodo" onSubmit={(evento) => {
                    evento.preventDefault();
                    accionAgente.mutate({ tipo: "apodo", id: agente.id, apodo });
                  }}>
                    <label htmlFor={`oficina-apodo-${agente.id}`}>Apodo del agente</label>
                    <input id={`oficina-apodo-${agente.id}`} value={apodo} maxLength={60} placeholder={agente.subagent_agent || agente.title}
                      autoFocus onChange={(evento) => setApodo(evento.target.value)} />
                    <span>Déjalo vacío para usar el nombre original.</span>
                    <div>
                      <button type="submit" className="btn-ghost" disabled={accionAgente.isPending}>Guardar</button>
                      <button type="button" className="btn-ghost" disabled={accionAgente.isPending} onClick={cerrarMenu}>Cancelar</button>
                    </div>
                  </form>}
                </div>}
              </li>;
            })}
          </ul>
        </>}
      </aside>
    </div>
  </main>;
}
