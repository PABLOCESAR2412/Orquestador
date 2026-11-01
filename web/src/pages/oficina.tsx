import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { useShell } from "../components/shell-context";
import { useEventosVivos } from "../lib/eventos-vivos";
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

export function OfficePage() {
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const queryClient = useQueryClient();
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const { conectado } = useEventosVivos({}, (evento) => {
    if (evento.tipo === "chat" || evento.tipo === "configuracion_chat") {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });
  const conversaciones = useQuery({ queryKey: ["conversations"], queryFn: api.listConversations, refetchInterval: 30_000, refetchIntervalInBackground: false });
  const principales = (conversaciones.data ?? []).filter((c) => !c.parent_conversation_id);
  const ordenados = [...principales].sort((a, b) => Number(Boolean(b.en_proceso || b.ocupada || b.pendiente_aprobacion)) - Number(Boolean(a.en_proceso || a.ocupada || a.pendiente_aprobacion)));
  const visibles = ordenados.slice(0, 12);
  const actual = visibles.find((c) => c.id === seleccion) ?? visibles[0];
  const abrir = (id: string) => { setSelectedConversationId(id); void navigate({ to: "/chat" }); };
  return <main className="oficina container">
    <header className="oficina-cabecera"><div><h1>Oficina</h1><p>Supervisores, conversaciones y sus subagentes en un espacio compartido.</p></div><span>{conectado ? "Estados en vivo" : "Respaldo cada 30 segundos"}</span></header>
    {conversaciones.isError && <p role="alert">No se pudieron cargar los agentes. <button type="button" onClick={() => void conversaciones.refetch()}>Reintentar</button></p>}
    <div className="oficina-distribucion">
      <section className="oficina-plano" aria-label="Oficina de agentes">
        <div className="oficina-pared"><span className="oficina-ventanas" aria-hidden="true"><i /><i /><i /></span><strong>TELO · OFICINA DE AGENTES</strong></div>
        <div className="oficina-sala oficina-reunion"><strong>Dirección</strong><div className="oficina-pizarra" aria-hidden="true">PLAN DE TRABAJO</div><div className="oficina-mesa-reunion" /><small>Coordinación de supervisores</small></div>
        <div className="oficina-sala oficina-cafe"><strong>Espacio común</strong><div className="oficina-barra">CAFÉ <span aria-hidden="true">▣</span></div><div className="oficina-planta" aria-hidden="true" /><small>Movimientos decorativos</small></div>
        <div className="oficina-area"><div className="oficina-area-titulo"><strong>Supervisores</strong><span>{principales.length} conversaciones</span></div>
          <div className="oficina-escritorios">
            {visibles.map((c, i) => <button type="button" key={c.id} className={`oficina-puesto ${estado(c) === "En ejecución" ? "is-activa" : "is-descanso"} ${actual?.id === c.id ? "is-selected" : ""}`} onClick={() => setSeleccion(c.id)} aria-pressed={actual?.id === c.id}>
              <span className="oficina-persona" style={{ animationDelay: `${i * -1.3}s` }} aria-hidden="true"><span /></span><span className="oficina-mesa" aria-hidden="true"><i /><b /></span><span className="oficina-nombre">{c.title}</span><small>{estado(c)}</small>
              {(c.subchats?.length ?? 0) > 0 && <span className="oficina-hijos">{c.subchats!.length} subagentes</span>}
            </button>)}
          </div>
          {conversaciones.isPending && <p role="status">Cargando agentes…</p>}
          {!conversaciones.isPending && visibles.length === 0 && <p className="oficina-vacia">Tus conversaciones aparecerán aquí como supervisores.</p>}
        </div>
      </section>
      <aside className="oficina-actividad"><h2>Agentes</h2><p>Elige un supervisor para ver su equipo y abrir su conversación.</p>
        {actual ? <><div className="oficina-detalle"><strong>{actual.title}</strong><small>{actual.project_name || "Conversación independiente"} · {estado(actual)}</small><button type="button" onClick={() => abrir(actual.id)}>Abrir chat</button></div>
          <h3>Subagentes</h3>{actual.subchats?.length ? actual.subchats.map(hijo => <button type="button" key={hijo.id} className="oficina-fila" onClick={() => abrir(hijo.id)}><span><strong>{hijo.subagent_agent || hijo.title}</strong><small>{estado(hijo)}</small></span><span>Abrir</span></button>) : <p>No hay subagentes registrados en este chat.</p>}</> : <p>Crea o abre un chat para empezar.</p>}
        {ordenados.length > visibles.length && <p>Se muestran 12 conversaciones; las activas aparecen primero.</p>}
      </aside>
    </div>
  </main>;
}
