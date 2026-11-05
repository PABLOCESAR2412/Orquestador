import type { FilaActividad } from "./actividad";

// Bus de eventos en memoria con buffer circular para reconexión SSE (Last-Event-ID).
// Mantiene los últimos 100 eventos no relacionados con stdout. Si el cliente queda más atrás,
// el canal declara el hueco para que la interfaz vuelva a consultar el estado persistido.

export type EventoVivo =
  | { tipo: "configuracion_chat"; conversacion_id: string }
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
let ultimaSecuenciaRetirada = 0;

export function publicar(evento: EventoVivo): number {
  contadorSecuencia += 1;
  const conSecuencia: EventoConSecuencia = { id: contadorSecuencia, evento };
  // No desplazar eventos críticos de estado (tarea, chat, evento, actividad) con ráfagas de stdout de terminal
  if (evento.tipo !== "salida") {
    bufferEventos.push(conSecuencia);
    if (bufferEventos.length > CAPACIDAD_BUFFER) {
      ultimaSecuenciaRetirada = bufferEventos.shift()!.id;
    }
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
  if (ultimoId < 0) return [];
  return bufferEventos.filter((e) => e.id > ultimoId);
}

export function hayHuecoDesde(ultimoId: number | null): boolean {
  return ultimoId !== null && ultimoId < ultimaSecuenciaRetirada;
}

// Registra el cliente y captura su cursor/replay en el mismo tramo síncrono para evitar huecos
// entre consultar el buffer y comenzar la suscripción.
export function suscribirConEventosDesde(
  ultimoId: number | null,
  fn: Suscriptor,
): { cursor: number; eventos: EventoConSecuencia[]; hueco: boolean; baja: () => void } {
  suscriptores.add(fn);
  const cursor = contadorSecuencia;
  const eventos = ultimoId === null ? [] : eventosDesde(ultimoId);
  return {
    cursor,
    eventos,
    hueco: hayHuecoDesde(ultimoId),
    baja: () => {
      suscriptores.delete(fn);
    },
  };
}

// Para diagnóstico: cuántas conexiones en vivo hay ahora.
export function cantidadSuscriptores(): number {
  return suscriptores.size;
}
