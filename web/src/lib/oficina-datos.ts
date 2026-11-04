// Traduce las conversaciones de la app a las entradas que entiende el motor de la oficina.
import type { Conversation } from "../api";
import type { Entrada, EstadoEntrada } from "./oficina-motor";

export const TEXTO_ACTIVIDAD_MAX = 26;

export function nombreAgente(c: Conversation): string {
  return c.apodo_oficina || c.subagent_agent || c.title;
}

export function recortarTexto(texto: string, max = TEXTO_ACTIVIDAD_MAX): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

function instante(c: Conversation): number {
  const t = Date.parse(c.last_message_at ?? c.created_at);
  return Number.isFinite(t) ? t : 0;
}

export function estadoEntrada(c: Conversation): EstadoEntrada {
  if (c.pendiente_aprobacion) return "aprobacion";
  if (c.en_proceso || c.ocupada) return "trabajando";
  return "libre";
}

/** Un personaje por chat y uno por subagente que esté corriendo (los terminados salen de la oficina). */
export function entradasDesdeConversaciones(conversaciones: Conversation[], actividad: ReadonlyMap<string, string>): Entrada[] {
  const res: Entrada[] = [];
  for (const c of conversaciones) {
    if (c.parent_conversation_id) continue;
    const estado = estadoEntrada(c);
    res.push({
      id: c.id, titulo: recortarTexto(nombreAgente(c), 22), estado, reciente: instante(c),
      planificando: estado === "trabajando" && c.work_mode === "plan",
      actividad: estado === "trabajando" && actividad.has(c.id) ? recortarTexto(actividad.get(c.id)!) : null,
    });
    for (const h of c.subchats ?? []) {
      if (h.subagent_status !== "running") continue;
      res.push({
        id: h.id, titulo: recortarTexto(nombreAgente(h), 22), padre: c.id, estado: "trabajando", reciente: instante(h),
        actividad: actividad.has(h.id) ? recortarTexto(actividad.get(h.id)!) : null,
      });
    }
  }
  return res;
}
