import type { Conversation, PasoActividad, Task } from "../api";

export function integrarActividadGuardada(actuales: PasoActividad[], guardados: PasoActividad[]): PasoActividad[] {
  const pasos = new Map(actuales.map(paso => [paso.seq, paso]));
  for (const paso of guardados) {
    const previo = pasos.get(paso.seq);
    // Una respuesta de sondeo anterior al último evento no vuelve a abrir una herramienta terminada.
    if (previo && previo.estado !== "en_curso" && paso.estado === "en_curso" && !["provider", "capacity"].includes(paso.herramienta ?? "")) continue;
    pasos.set(paso.seq, paso);
  }
  return [...pasos.values()].sort((a, b) => a.seq - b.seq);
}

export function tareaVisibleDelChat(tareas: Task[] = []): Task | undefined {
  return tareas.find((tarea) => ["running", "analyzing", "waiting_approval"].includes(tarea.status))
    ?? tareas.find((tarea) => tarea.status === "queued")
    ?? tareas.at(-1);
}

const claveAprobacionVista = (id: string) => `telo_aprobacion_vista:${id}`;
export const marcaAprobacion = (conv: Conversation) => conv.estado_tarea_id
  ? `${conv.estado_tarea_id}:${conv.estado_tarea_version ?? "actual"}`
  : conv.last_message_at ?? "pendiente";

export function aprobacionRevisada(conv: Conversation): boolean {
  if (!conv.pendiente_aprobacion) return false;
  try { return localStorage.getItem(claveAprobacionVista(conv.id)) === marcaAprobacion(conv); } catch { return false; }
}

export function marcarAprobacionRevisada(conv: Conversation): void {
  try { localStorage.setItem(claveAprobacionVista(conv.id), marcaAprobacion(conv)); } catch { /* La marca solo afecta esta vista. */ }
}
