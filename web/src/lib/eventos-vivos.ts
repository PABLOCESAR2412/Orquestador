import { useEffect, useRef, useState } from "react";
import type { EventoVivo } from "../api";

// Filtro del canal: con tareaId solo llegan los eventos de esa tarea.
export type FiltroVivo = { tareaId?: string | null };

const ESPERA_MIN_MS = 1_000;
const ESPERA_MAX_MS = 30_000;

// Escucha /api/eventos-vivos (SSE) mientras la pantalla está montada.
// Si el servidor cierra el canal, reintenta con una espera que crece hasta 30 s.
// El sondeo de cada pantalla sigue activo como respaldo.
export function useEventosVivos(
  filtro: FiltroVivo,
  onEvento: (evento: EventoVivo) => void,
): { conectado: boolean } {
  const [conectado, setConectado] = useState(false);
  // Las referencias evitan reabrir el canal cuando cambia el filtro o la función.
  const filtroRef = useRef(filtro);
  const onEventoRef = useRef(onEvento);

  useEffect(() => {
    filtroRef.current = filtro;
    onEventoRef.current = onEvento;
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let vivo = true;
    let fuente: EventSource | null = null;
    let intentos = 0;
    let espera: number | undefined;

    const entregar = (tipo: "tarea" | "evento" | "salida", crudo: string) => {
      let dato: unknown;
      try {
        dato = JSON.parse(crudo);
      } catch {
        return;
      }
      if (typeof dato !== "object" || dato === null) return;
      const evento = { tipo, ...dato } as EventoVivo;
      const tareaId = evento.tipo === "tarea" ? evento.id : evento.task_id;
      const filtrarA = filtroRef.current.tareaId;
      if (filtrarA && tareaId !== filtrarA) return;
      onEventoRef.current(evento);
    };

    const conectar = () => {
      if (!vivo) return;
      const nueva = new EventSource("/api/eventos-vivos");
      fuente = nueva;

      nueva.onopen = () => {
        intentos = 0;
        setConectado(true);
      };
      nueva.addEventListener("tarea", (ev) => entregar("tarea", (ev as MessageEvent<string>).data));
      nueva.addEventListener("evento", (ev) => entregar("evento", (ev as MessageEvent<string>).data));
      nueva.addEventListener("salida", (ev) => entregar("salida", (ev as MessageEvent<string>).data));

      nueva.onerror = () => {
        if (!vivo) return;
        setConectado(false);
        // Con CONNECTING el navegador reintenta solo. Con CLOSED hay que volver a abrirlo.
        if (nueva.readyState === EventSource.CLOSED) {
          nueva.close();
          fuente = null;
          const demora = Math.min(ESPERA_MAX_MS, ESPERA_MIN_MS * 2 ** intentos);
          intentos += 1;
          espera = window.setTimeout(conectar, demora);
        }
      };
    };

    conectar();

    return () => {
      vivo = false;
      if (espera !== undefined) window.clearTimeout(espera);
      fuente?.close();
    };
  }, []);

  return { conectado };
}
