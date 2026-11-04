import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { useShell } from "../components/shell-context";
import { OficinaLienzo, type OficinaLienzoHandle } from "../components/oficina-lienzo";
import { useEventosVivos } from "../lib/eventos-vivos";
import { entradasDesdeConversaciones } from "../lib/oficina-datos";
import { entradasDemo, parametroDemo } from "../lib/oficina-demo";
import { ESCRITORIOS } from "../lib/oficina-mapa";
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

export function OfficePage() {
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const queryClient = useQueryClient();
  const lienzo = useRef<OficinaLienzoHandle>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
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
  // Un subagente seleccionado en el plano muestra a su supervisor
  const principalDe = (id: string | null) => {
    if (!id) return undefined;
    return principales.find((c) => c.id === id) ?? principales.find((c) => c.subchats?.some((h) => h.id === id));
  };
  const actual = principalDe(seleccion) ?? ordenados[0];
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
      <aside className="oficina-actividad"><h2>Agentes</h2><p>Elige un supervisor para ver su equipo y abrir su conversación.</p>
        {actual ? <><div className="oficina-detalle"><strong>{actual.title}</strong><small>{actual.project_name || "Conversación independiente"} · {estado(actual)}</small><button type="button" onClick={() => abrir(actual.id)}>Abrir chat</button></div>
          <h3>Subagentes</h3>{actual.subchats?.length ? actual.subchats.map(hijo => <button type="button" key={hijo.id} className="oficina-fila" onClick={() => abrir(hijo.id)}><span><strong>{hijo.subagent_agent || hijo.title}</strong><small>{estado(hijo)}</small></span><span>Abrir</span></button>) : <p>No hay subagentes registrados en este chat.</p>}</> : <p>Crea o abre un chat para empezar.</p>}
        {ordenados.length > 1 && <><h3>Todos los agentes</h3>
          <ul className="oficina-lista">{ordenados.map((c) => <li key={c.id}><button type="button" className={`oficina-lista-fila${actual?.id === c.id ? " is-selected" : ""}`} aria-pressed={actual?.id === c.id} onClick={() => elegir(c.id, true)}>
            <span className={`oficina-punto${c.pendiente_aprobacion ? " is-aprobacion" : activa(c) ? " is-activa" : ""}`} aria-hidden="true" /><span className="oficina-lista-titulo">{c.title}</span><small>{estado(c)}</small></button></li>)}</ul></>}
      </aside>
    </div>
  </main>;
}
