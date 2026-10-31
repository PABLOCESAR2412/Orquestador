import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Conversation } from "../api";
import { useShell } from "../components/shell-context";
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const conversaciones = useQuery({ queryKey: ["conversations"], queryFn: api.listConversations, refetchInterval: 10_000, refetchIntervalInBackground: false });
  const uso = useQuery({ queryKey: ["office-jev"], queryFn: api.getJevOficina });
  const jev = useMutation({ mutationFn: api.decidirJevOficina, onSettled: () => void qc.invalidateQueries({ queryKey: ["office-jev"] }) });
  const principales = (conversaciones.data ?? []).filter((c) => !c.parent_conversation_id);
  const ordenados = [...principales].sort((a, b) => Number(Boolean(b.en_proceso || b.ocupada || b.pendiente_aprobacion)) - Number(Boolean(a.en_proceso || a.ocupada || a.pendiente_aprobacion)));
  const visibles = ordenados.slice(0, 12);
  const actual = visibles.find((c) => c.id === seleccion) ?? visibles[0];
  const abrir = (id: string) => { setSelectedConversationId(id); void navigate({ to: "/chat" }); };
  return <main className="oficina container">
    <header className="oficina-cabecera"><div><h1>Oficina</h1><p>Supervisores, conversaciones y sus subagentes en un espacio compartido.</p></div><span>Actualización cada 10 segundos</span></header>
    {conversaciones.isError && <p role="alert">No se pudieron cargar los agentes. <button type="button" onClick={() => void conversaciones.refetch()}>Reintentar</button></p>}
    <div className="oficina-distribucion">
      <section className={`oficina-plano ${jev.data ? `idea-${jev.data.actividad}` : ""}`} aria-label="Oficina de agentes">
        <div className="oficina-pared"><strong>TELO · OFICINA DE AGENTES</strong><span>Dirección · proyectos · memoria</span></div>
        <div className="oficina-sala oficina-reunion"><strong>Dirección</strong><div className="oficina-mesa-reunion" /><small>Coordinación de supervisores</small></div>
        <div className="oficina-sala oficina-cafe"><strong>Espacio común</strong><div className="oficina-barra">CAFÉ</div><small>Movimientos decorativos</small></div>
        <div className="oficina-area"><div className="oficina-area-titulo"><strong>Supervisores</strong><span>{principales.length} conversaciones</span></div>
          <div className="oficina-escritorios">
            {visibles.map((c, i) => <button type="button" key={c.id} className={`oficina-puesto ${estado(c) === "En ejecución" ? "is-activa" : "is-descanso"} ${actual?.id === c.id ? "is-selected" : ""}`} onClick={() => setSeleccion(c.id)} aria-pressed={actual?.id === c.id}>
              <span className="oficina-persona" style={{ animationDelay: `${i * -1.3}s` }} aria-hidden="true"><span /></span><span className="oficina-mesa" aria-hidden="true"><i /></span><span className="oficina-nombre">{c.title}</span><small>{estado(c)}</small>
              {(c.subchats?.length ?? 0) > 0 && <span className="oficina-hijos">{c.subchats!.length} subagentes</span>}
            </button>)}
          </div>
          {conversaciones.isPending && <p role="status">Cargando agentes…</p>}
          {!conversaciones.isPending && visibles.length === 0 && <p className="oficina-vacia">Tus conversaciones aparecerán aquí como supervisores.</p>}
        </div>
        <div className="oficina-memoria"><strong>Memoria</strong><span>Baúl general y proyectos</span><Link to="/cerebro">Abrir cerebro</Link></div>
      </section>
      <aside className="oficina-actividad"><h2>Agentes</h2><p>Elige un supervisor para ver su equipo y abrir su conversación.</p>
        {actual ? <><div className="oficina-detalle"><strong>{actual.title}</strong><small>{actual.project_name || "Conversación independiente"} · {estado(actual)}</small><button type="button" onClick={() => abrir(actual.id)}>Abrir chat</button></div>
          <h3>Subagentes</h3>{actual.subchats?.length ? actual.subchats.map(hijo => <button type="button" key={hijo.id} className="oficina-fila" onClick={() => abrir(hijo.id)}><span><strong>{hijo.subagent_agent || hijo.title}</strong><small>{estado(hijo)}</small></span><span>Abrir</span></button>) : <p>No hay subagentes registrados en este chat.</p>}</> : <p>Crea o abre un chat para empezar.</p>}
        {ordenados.length > visibles.length && <p>Se muestran 12 conversaciones; las activas aparecen primero.</p>}
        <h3>Idea de Jev</h3><p>Una consulta puntual para elegir una actividad decorativa; hasta una por minuto.</p>
        <button type="button" disabled={jev.isPending} onClick={() => jev.mutate()}>{jev.isPending ? "Consultando…" : "Pedir una idea a Jev"}</button>
        {jev.data && <p role="status">Jev propone: {({ cafe: "ir por café", ventana: "mirar por la ventana", charla: "conversar junto a la mesa" })[jev.data.actividad]}.</p>}
        {jev.isError && <p role="alert">No se pudo consultar Jev. Revisa su clave en Ajustes o espera un minuto antes de reintentar.</p>}
        {uso.data && <p>Oficina: {uso.data.llamadas} intentos · {uso.data.completadas ?? 0} respuestas · {uso.data.entrada ?? 0} tokens de entrada y {uso.data.salida ?? 0} de salida{(uso.data.sin_datos ?? 0) > 0 ? ` · ${uso.data.sin_datos} respuestas sin datos completos` : ""}. Estimación parcial: USD {(((uso.data.entrada ?? 0) * 0.042) / 1_000_000).toFixed(6)}. El saldo y cobro real se consultan en TypeSafe.</p>}
      </aside>
    </div>
  </main>;
}

