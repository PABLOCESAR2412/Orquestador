import type { Conversation } from "../api";

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
