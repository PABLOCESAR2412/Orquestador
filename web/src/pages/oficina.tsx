import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Task } from "../api";
import { STATUS_LABEL } from "../lib/model";
import "../styles-oficina.css";

const ocupada = (t: Task) => ["queued", "analyzing", "running", "waiting_approval"].includes(t.status);

export function OfficePage() {
  const qc = useQueryClient();
  const tareas = useQuery({ queryKey: ["office-tasks"], queryFn: api.listTasks, refetchInterval: 10_000, refetchIntervalInBackground: false });
  const uso = useQuery({ queryKey: ["office-jev"], queryFn: api.getJevOficina });
  const jev = useMutation({ mutationFn: api.decidirJevOficina, onSettled: () => void qc.invalidateQueries({ queryKey: ["office-jev"] }) });
  const lista = tareas.data ?? [];
  const visibles = [...lista.filter(ocupada), ...lista.filter((t) => !ocupada(t))].slice(0, 12);
  return <main className="oficina container">
    <header className="oficina-cabecera"><div><h1>Oficina</h1><p>Una vista de tus tareas, inspirada en una oficina compartida.</p></div><span>Actualización cada 10 segundos</span></header>
    {tareas.isError && <p role="alert">No se pudieron cargar las tareas. <button type="button" onClick={() => void tareas.refetch()}>Reintentar</button></p>}
    <div className="oficina-distribucion">
      <section className={`oficina-plano ${jev.data ? `idea-${jev.data.actividad}` : ""}`} aria-label="Plano de la oficina">
        <div className="oficina-sala oficina-reunion"><strong>Sala de reuniones</strong><div className="oficina-mesa-reunion" /></div>
        <div className="oficina-sala oficina-cafe"><strong>Zona de café</strong><div className="oficina-barra">Café</div></div>
        <div className="oficina-area"><strong>Área de trabajo</strong><div className="oficina-escritorios">
          {visibles.map((t, i) => <Link key={t.id} to="/tareas/$id" params={{ id: t.id }} className={`oficina-puesto ${ocupada(t) ? "is-activa" : "is-descanso"}`} aria-label={`${t.title}: ${STATUS_LABEL[t.status] ?? t.status}. Abrir tarea`}>
            <span className="oficina-persona" style={{ animationDelay: `${i * -1.3}s` }} aria-hidden="true"><span /></span><span className="oficina-mesa" aria-hidden="true"><i /></span><span className="oficina-nombre">{t.title}</span>
          </Link>)}
        </div>{!tareas.isPending && visibles.length === 0 && <p className="oficina-vacia">Cuando crees una tarea, aparecerá aquí.</p>}</div>
      </section>
      <aside className="oficina-actividad"><h2>Actividad</h2><p>Los estados vienen de tus tareas. Los movimientos automáticos son decorativos.</p>{tareas.isPending && <p role="status">Cargando tareas…</p>}{visibles.map(t => <Link key={t.id} to="/tareas/$id" params={{ id:t.id }} className="oficina-fila"><span><strong>{t.title}</strong><small>{t.project_name || "Tarea independiente"}</small></span><span>{STATUS_LABEL[t.status] ?? t.status}</span></Link>)}{lista.length > visibles.length && <Link to="/tareas">Ver todas las tareas</Link>}
        <h2>Idea de Jev</h2><p>Una consulta puntual para elegir una actividad de descanso. Hasta una consulta por minuto.</p>
        <button type="button" disabled={jev.isPending} onClick={() => jev.mutate()}>{jev.isPending ? "Consultando…" : "Pedir una idea a Jev"}</button>
        {jev.data && <p role="status">Jev propone: {({ cafe: "ir por café", ventana: "mirar por la ventana", charla: "conversar junto a la mesa" })[jev.data.actividad]}.</p>}
        {jev.isError && <p role="alert">No se pudo consultar Jev. Revisa su clave en Ajustes o espera un minuto antes de reintentar.</p>}
        {uso.data && <p>Oficina: {uso.data.llamadas} intentos · {uso.data.completadas ?? 0} respuestas · {uso.data.entrada ?? 0} tokens de entrada y {uso.data.salida ?? 0} de salida{(uso.data.sin_datos ?? 0) > 0 ? ` · ${uso.data.sin_datos} respuestas sin datos completos de tokens` : ""}. Estimación parcial: USD {(((uso.data.entrada ?? 0) * 0.042) / 1_000_000).toFixed(6)} (tarifa de referencia: USD 0,042 por millón de tokens de entrada). El saldo y el cobro real se consultan en TypeSafe.</p>}
      </aside>
    </div>
  </main>;
}

