import { useEffect, useRef, useState } from "react";
import type { EventoVivo } from "../api";

// Filtro del canal: con tareaId solo llegan los eventos de esa tarea.
export type FiltroVivo = { tareaId?: string | null };

type Suscriptor = {
  filtro: () => FiltroVivo;
  onEvento: (evento: EventoVivo) => void;
  onEstado: (conectado: boolean) => void;
};

const ESPERA_MIN_MS = 1_000;
const ESPERA_MAX_MS = 30_000;
const ESPERA_POLL_MS = 8_000;
const DEMORA_DESCONEXION_MS = 2_000;
const TIEMPO_CONEXION_ESTABLE_MS = 45_000;

// Estado compartido del sondeo de eventos en esta pestaña
let controlador: AbortController | null = null;
let conectado = false;
let intentos = 0;
let ultimoEventoId: number | null = null;
let timerEspera: number | undefined;
let timerDesconexion: number | undefined;
let timerConexionEstable: number | undefined;
let descargando = false;
const suscriptores = new Set<Suscriptor>();

function notificarEstado(nuevo: boolean) {
  conectado = nuevo;
  for (const s of suscriptores) {
    s.onEstado(nuevo);
  }
}

function programarReconexion() {
  if (timerEspera !== undefined || suscriptores.size === 0) return;
  const demora = Math.min(ESPERA_MAX_MS, ESPERA_MIN_MS * 2 ** intentos);
  intentos += 1;
  timerEspera = window.setTimeout(() => {
    timerEspera = undefined;
    void conectar();
  }, demora);
}

function entregar(evento: EventoVivo) {
  // Los pasos de un chat no son de una tarea: el filtro por tarea no los deja pasar.
  const tareaId =
    evento.tipo === "tarea"
      ? evento.id
      : evento.tipo === "actividad" || evento.tipo === "chat" || evento.tipo === "configuracion_chat"
      ? null
      : evento.task_id;

  for (const s of suscriptores) {
    const filtrarA = s.filtro().tareaId;
    if (filtrarA && tareaId !== filtrarA) continue;
    try {
      s.onEvento(evento);
    } catch {
      // Un suscriptor roto no debe impedir que reciban el evento los demás.
    }
  }
}

async function conectar() {
  if (descargando) return;
  if (controlador) return;
  if (suscriptores.size === 0) return;
  if (typeof fetch === "undefined") return;

  const actual = new AbortController();
  controlador = actual;
  try {
    while (!descargando && suscriptores.size > 0 && controlador === actual) {
      const params = new URLSearchParams({ espera: ultimoEventoId === null ? "0" : String(ESPERA_POLL_MS) });
      if (ultimoEventoId !== null) params.set("desde", String(ultimoEventoId));
      const response = await fetch(`/api/eventos-vivos/poll?${params}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: actual.signal,
      });
      if (!response.ok) throw new Error("El canal de eventos no está disponible");
      const lote = await response.json() as {
        cursor?: unknown;
        eventos?: { id?: unknown; evento?: EventoVivo }[];
      };
      if (!Number.isSafeInteger(lote.cursor) || !Array.isArray(lote.eventos)) {
        throw new Error("Respuesta inválida del canal de eventos");
      }
      // El cursor vive en memoria del servidor y vuelve a cero tras un reinicio.
      if (ultimoEventoId !== null && (lote.cursor as number) < ultimoEventoId) ultimoEventoId = null;

      for (const registro of lote.eventos) {
        if (!Number.isSafeInteger(registro.id) || !registro.evento) continue;
        if (ultimoEventoId !== null && (registro.id as number) <= ultimoEventoId) continue;
        entregar(registro.evento);
        ultimoEventoId = registro.id as number;
      }
      ultimoEventoId = Math.max(ultimoEventoId ?? 0, lote.cursor as number);

      if (timerConexionEstable === undefined) {
        timerConexionEstable = window.setTimeout(() => {
          timerConexionEstable = undefined;
          intentos = 0;
        }, TIEMPO_CONEXION_ESTABLE_MS);
      }
      notificarEstado(true);
    }
  } catch {
    if (!actual.signal.aborted && !descargando) notificarEstado(false);
  } finally {
    if (controlador === actual) {
      controlador = null;
      if (!descargando && suscriptores.size > 0) programarReconexion();
    }
  }
}

// Cierra la conexión SSE antes de recargar o cerrar la página para no dejar reintentos en segundo plano.
export function cerrarEventosVivos(): void {
  descargando = true;
  if (timerEspera !== undefined) {
    window.clearTimeout(timerEspera);
    timerEspera = undefined;
  }
  if (timerDesconexion !== undefined) {
    window.clearTimeout(timerDesconexion);
    timerDesconexion = undefined;
  }
  if (timerConexionEstable !== undefined) {
    window.clearTimeout(timerConexionEstable);
    timerConexionEstable = undefined;
  }
  controlador?.abort();
  controlador = null;
  notificarEstado(false);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cerrarEventosVivos);
  window.addEventListener("pagehide", cerrarEventosVivos);
  window.addEventListener("pageshow", () => {
    descargando = false;
    if (suscriptores.size > 0 && !controlador) {
      void conectar();
    }
  });
}

// Usa sondeos de respuesta corta compartidos por pestaña para evitar streams largos que algunos
// proxies HTTP/2 interrumpen. Si hay una caída, reintenta con backoff; las pantallas conservan su polling.
export function useEventosVivos(
  filtro: FiltroVivo,
  onEvento: (evento: EventoVivo) => void,
): { conectado: boolean } {
  const [estaConectado, setEstaConectado] = useState(conectado);
  const filtroRef = useRef(filtro);
  const onEventoRef = useRef(onEvento);

  useEffect(() => {
    filtroRef.current = filtro;
    onEventoRef.current = onEvento;
  });

  useEffect(() => {
    if (typeof fetch === "undefined") return;

    descargando = false;

    if (timerDesconexion !== undefined) {
      window.clearTimeout(timerDesconexion);
      timerDesconexion = undefined;
    }

    const suscriptor: Suscriptor = {
      filtro: () => filtroRef.current,
      onEvento: (ev) => onEventoRef.current(ev),
      onEstado: (c) => setEstaConectado(c),
    };

    suscriptores.add(suscriptor);
    setEstaConectado(conectado);

    if (!controlador) {
      void conectar();
    }

    return () => {
      suscriptores.delete(suscriptor);
      if (suscriptores.size === 0) {
        // Pausa breve antes de desconectar para que los cambios de pantalla no corten el canal
        timerDesconexion = window.setTimeout(() => {
          if (suscriptores.size === 0 && controlador) {
            if (timerEspera !== undefined) {
              window.clearTimeout(timerEspera);
              timerEspera = undefined;
            }
            if (timerConexionEstable !== undefined) {
              window.clearTimeout(timerConexionEstable);
              timerConexionEstable = undefined;
            }
            controlador.abort();
            controlador = null;
            notificarEstado(false);
          }
        }, DEMORA_DESCONEXION_MS);
      }
    };
  }, []);

  return { conectado: estaConectado };
}
