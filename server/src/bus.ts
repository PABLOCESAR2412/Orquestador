import type { FilaActividad } from "./actividad";

// Bus de eventos en memoria. El worker y las tareas publican; cada conexión SSE se suscribe.
// No guarda nada: si no hay nadie suscrito, el evento se pierde (el historial está en task_events
// y, para los chats, en chat_actividad).

export type EventoVivo =
  | { tipo: "tarea"; id: string; status: string; finished_at: string | null }
  | { tipo: "evento"; task_id: string; kind: string; detail: string | null; created_at: string }
  | { tipo: "salida"; task_id: string; linea: string }
  | { tipo: "actividad"; conversacion_id: string; turno_id: string; paso: FilaActividad }
  | { tipo: "chat"; conversacion_id: string; estado: "en_curso" | "terminado" };

export type Suscriptor = (evento: EventoVivo) => void;

const suscriptores = new Set<Suscriptor>();

export function publicar(evento: EventoVivo): void {
  // Copia antes de recorrer: un suscriptor puede darse de baja mientras se notifica.
  for (const fn of [...suscriptores]) {
    try {
      fn(evento);
    } catch {
      // Un suscriptor roto no debe impedir que reciban el evento los demás.
    }
  }
}

// Devuelve la función que quita la suscripción.
export function suscribir(fn: Suscriptor): () => void {
  suscriptores.add(fn);
  return () => {
    suscriptores.delete(fn);
  };
}

// Para diagnóstico: cuántas conexiones en vivo hay ahora.
export function cantidadSuscriptores(): number {
  return suscriptores.size;
}
