import type { FilaActividad } from "./actividad";

// Bus de eventos en memoria con buffer circular para reconexión SSE (Last-Event-ID).
// Mantiene los últimos 100 eventos en memoria para que clientes móviles que sufran
// una microdesconexión reciban los eventos pendientes al reconectar sin pérdidas.

export type EventoVivo =
  | { tipo: "tarea"; id: string; status: string; finished_at: string | null }
  | { tipo: "evento"; task_id: string; kind: string; detail: string | null; created_at: string }
  | { tipo: "salida"; task_id: string; linea: string }
  | { tipo: "actividad"; conversacion_id: string; turno_id: string; paso: FilaActividad }
  | { tipo: "chat"; conversacion_id: string; estado: "en_curso" | "terminado" };

export type EventoConSecuencia = { id: number; evento: EventoVivo };

export type Suscriptor = (evento: EventoVivo, id: number) => void;

const suscriptores = new Set<Suscriptor>();

const CAPACIDAD_BUFFER = 100;
const bufferEventos: EventoConSecuencia[] = [];
let contadorSecuencia = 0;

export function publicar(evento: EventoVivo): number {
  contadorSecuencia += 1;
  const conSecuencia: EventoConSecuencia = { id: contadorSecuencia, evento };
  bufferEventos.push(conSecuencia);
  if (bufferEventos.length > CAPACIDAD_BUFFER) {
    bufferEventos.shift();
  }

  // Copia antes de recorrer: un suscriptor puede darse de baja mientras se notifica.
  for (const fn of [...suscriptores]) {
    try {
      fn(evento, contadorSecuencia);
    } catch {
      // Un suscriptor roto no debe impedir que reciban el evento los demás.
    }
  }
  return contadorSecuencia;
}

// Devuelve los eventos almacenados en el buffer circular posteriores a `ultimoId`.
export function eventosDesde(ultimoId: number): EventoConSecuencia[] {
  if (ultimoId <= 0) return [];
  return bufferEventos.filter((e) => e.id > ultimoId);
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
