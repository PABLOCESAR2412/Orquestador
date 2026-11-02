import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { ProcesoAgente } from "./chat-proceso";

export type SeguimientoPrEstado = {
  estado: string; mensaje: string; repo: string; numero: number | null; sha: string;
  comprobado_en: number | null; repair_task_id: string | null; conversation_id: string;
  message_id: string | null; activity_from_seq: number;
  checks: { nombre: string; estado: string; url: string | null }[];
};
export type SeguimientoPrRespuesta = { seguimiento: SeguimientoPrEstado | null };
const TERMINADOS = new Set(["listo", "revision", "bloqueado", "cambiado", "caducado", "cerrado", "traspasado"]);
const TAREAS_TERMINADAS = new Set(["done", "failed", "cancelled", "interrupted"]);
const etiquetas: Record<string, string> = {
  success: "Correcta", failure: "Falló", timed_out: "Tiempo agotado", action_required: "Requiere acción",
  queued: "En cola", in_progress: "En curso", completed: "Terminada", cancelled: "Cancelada", skipped: "Omitida",
  analyzing: "Analizando la corrección", waiting_approval: "Esperando aprobación del plan", running: "Corrigiendo",
  done: "Corrección local lista", failed: "La corrección falló", interrupted: "Interrumpida", sin_cuota: "Esperando cuota o cambio de modelo",
};

export function SeguimientoPr({ accionId }: { accionId: string }) {
  const consulta = useQuery({
    queryKey: ["seguimiento-pr", accionId], queryFn: () => api.getSeguimientoPr(accionId),
    refetchInterval: q => q.state.data?.seguimiento && !TERMINADOS.has(q.state.data.seguimiento.estado) ? 5_000 : false,
  });
  const s = consulta.data?.seguimiento;
  const tarea = useQuery({
    queryKey: ["task", s?.repair_task_id], queryFn: () => api.getTask(s!.repair_task_id!), enabled: Boolean(s?.repair_task_id),
    refetchInterval: q => q.state.data && !TAREAS_TERMINADAS.has(q.state.data.status) ? 3_000 : false,
  });
  const actividad = useQuery({
    queryKey: ["actividad-publicacion", accionId, s?.repair_task_id],
    queryFn: () => api.listTurnoActividad(s!.conversation_id, s!.message_id!),
    enabled: Boolean(s?.repair_task_id && s.message_id),
    refetchInterval: tarea.data && !TAREAS_TERMINADAS.has(tarea.data.status) ? 3_000 : false,
  });
  if (consulta.isError) return <p className="approval-auth approval-auth-warning" role="alert">No se pudo leer el seguimiento: {errorText(consulta.error)}</p>;
  if (!s) return null;
  const enCurso = tarea.data ? !TAREAS_TERMINADAS.has(tarea.data.status) : s.estado === "corrigiendo";
  const pasos = (actividad.data ?? []).filter(p => p.seq > s.activity_from_seq);
  return <section className="approval-conflicts-progress" aria-label="Seguimiento de la publicación">
    <strong>Revisión de la publicación</strong>
    <p role="status" aria-live="polite">{s.mensaje}</p>
    {s.numero && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(s.repo) && <a href={`https://github.com/${s.repo}/pull/${s.numero}`} target="_blank" rel="noreferrer">Ver comprobaciones del PR en GitHub</a>}
    {s.comprobado_en && <p className="approval-auth">Última consulta: {new Date(s.comprobado_en).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })} · commit {s.sha.slice(0, 8)}</p>}
    {s.checks.length > 0 && <ul>{s.checks.map((check, i) => <li key={`${check.nombre}-${i}`}>
      {check.url && /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(check.url)
        ? <a href={check.url} target="_blank" rel="noreferrer">{check.nombre}</a> : check.nombre}
      {" · "}{etiquetas[check.estado] ?? check.estado}
    </li>)}</ul>}
    {s.repair_task_id && <div className="approval-repair">
      <p role="status">{tarea.data ? etiquetas[tarea.data.status] ?? tarea.data.status : "Preparando la corrección…"}</p>
      <ProcesoAgente pasos={pasos} enCurso={enCurso} actor="Corrección" textoFinal={tarea.data?.reporte?.resumen ?? ""} />
      {tarea.data?.reporte && <p>{tarea.data.reporte.resumen}</p>}
      {tarea.data?.error && <p role="alert">{tarea.data.error}</p>}
      {(tarea.isError || actividad.isError) && <p role="alert">No se pudo actualizar la actividad de la corrección. Reintenta al actualizar el chat.</p>}
    </div>}
  </section>;
}
