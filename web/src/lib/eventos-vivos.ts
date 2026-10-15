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
const DEMORA_DESCONEXION_MS = 2_000;

// Estado compartido del canal SSE en este navegador/pestaña
let fuente: EventSource | null = null;
let conectado = false;
let intentos = 0;
let timerEspera: number | undefined;
let timerDesconexion: number | undefined;
let descargando = false;
const suscriptores = new Set<Suscriptor>();

function notificarEstado(nuevo: boolean) {
  conectado = nuevo;
  for (const s of suscriptores) {
    s.onEstado(nuevo);
  }
}

function entregar(tipo: "tarea" | "evento" | "salida" | "actividad" | "chat", crudo: string) {
  let dato: unknown;
  try {
    dato = JSON.parse(crudo);
  } catch {
    return;
  }
  if (typeof dato !== "object" || dato === null) return;
  const evento = { tipo, ...dato } as EventoVivo;
  // Los pasos de un chat no son de una tarea: el filtro por tarea no los deja pasar.
  const tareaId =
    evento.tipo === "tarea"
      ? evento.id
      : evento.tipo === "actividad" || evento.tipo === "chat"
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

function conectar() {
  if (descargando) return;
  if (fuente) return;
  if (suscriptores.size === 0) return;
  if (typeof EventSource === "undefined") return;

  try {
    const nueva = new EventSource("/api/eventos-vivos");
    fuente = nueva;

    nueva.onopen = () => {
      intentos = 0;
      notificarEstado(true);
    };

    nueva.addEventListener("tarea", (ev) => entregar("tarea", (ev as MessageEvent<string>).data));
    nueva.addEventListener("evento", (ev) => entregar("evento", (ev as MessageEvent<string>).data));
    nueva.addEventListener("salida", (ev) => entregar("salida", (ev as MessageEvent<string>).data));
    nueva.addEventListener("actividad", (ev) => entregar("actividad", (ev as MessageEvent<string>).data));
    nueva.addEventListener("chat", (ev) => entregar("chat", (ev as MessageEvent<string>).data));

    nueva.onerror = () => {
      if (descargando) return;
      notificarEstado(false);
      // Con CONNECTING el navegador reintenta solo. Con CLOSED hay que volver a abrirlo.
      if (nueva.readyState === EventSource.CLOSED) {
        try {
          nueva.close();
        } catch {}
        fuente = null;
        const demora = Math.min(ESPERA_MAX_MS, ESPERA_MIN_MS * 2 ** intentos);
        intentos += 1;
        if (timerEspera !== undefined) window.clearTimeout(timerEspera);
        timerEspera = window.setTimeout(conectar, demora);
      }
    };
  } catch {
    notificarEstado(false);
  }
}

// Cierra la conexión SSE de forma limpia antes de recargar o cerrar la página.
// Esto evita abortos bruscos de flujos HTTP/2 que provocan net::ERR_HTTP2_PROTOCOL_ERROR.
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
  if (fuente) {
    try {
      fuente.close();
    } catch {}
    fuente = null;
  }
  notificarEstado(false);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cerrarEventosVivos);
  window.addEventListener("pagehide", cerrarEventosVivos);
  window.addEventListener("pageshow", () => {
    descargando = false;
    if (suscriptores.size > 0 && !fuente) {
      conectar();
    }
  });
}

// Escucha /api/eventos-vivos (SSE) compartiendo una sola conexión por pestaña.
// Si el servidor cierra el canal, reintenta con una espera que crece hasta 30 s.
// El sondeo de cada pantalla sigue activo como respaldo.
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
    if (typeof EventSource === "undefined") return;

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

    if (!fuente) {
      conectar();
    }

    return () => {
      suscriptores.delete(suscriptor);
      if (suscriptores.size === 0) {
        // Pausa breve antes de desconectar para que los cambios de pantalla no corten el canal
        timerDesconexion = window.setTimeout(() => {
          if (suscriptores.size === 0 && fuente) {
            try {
              fuente.close();
            } catch {}
            fuente = null;
            notificarEstado(false);
          }
        }, DEMORA_DESCONEXION_MS);
      }
    };
  }, []);

  return { conectado: estaConectado };
}
