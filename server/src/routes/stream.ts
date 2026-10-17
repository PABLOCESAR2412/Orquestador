import { Hono } from "hono";
import { cantidadSuscriptores, suscribirConEventosDesde, type EventoVivo } from "../bus";
import { sinLimiteDeInactividad } from "../conexion";

// Canal en vivo: estados de tareas, eventos del historial, líneas de salida del agente y pasos de los chats.
// Contrato: scratchpad/contrato.md (sección Tareas).

const PING_MS = 25_000;
// Conexiones en vivo a la vez. Una app de un solo usuario no necesita más; el resto se rechaza.
const MAX_SUSCRIPTORES = 20;
const MAX_EVENTOS_PENDIENTES = 100;
const MAX_BYTES_PENDIENTES = 256 * 1024;
const MAX_CARACTERES_SALIDA = 8_000;
const MAX_CARACTERES_DETALLE = 4_000;

export const stream = new Hono();

function aMensaje(evento: EventoVivo): { event: string; data: string } {
  if (evento.tipo === "tarea") {
    return {
      event: "tarea",
      data: JSON.stringify({ id: evento.id, status: evento.status, finished_at: evento.finished_at }),
    };
  }
  if (evento.tipo === "evento") {
    return {
      event: "evento",
      data: JSON.stringify({
        task_id: evento.task_id,
        kind: evento.kind,
        detail: evento.detail?.slice(0, MAX_CARACTERES_DETALLE) ?? null,
        created_at: evento.created_at,
      }),
    };
  }
  if (evento.tipo === "actividad") {
    return {
      event: "actividad",
      data: JSON.stringify({ conversacion_id: evento.conversacion_id, turno_id: evento.turno_id, paso: evento.paso }),
    };
  }
  if (evento.tipo === "chat") {
    return {
      event: "chat",
      data: JSON.stringify({ conversacion_id: evento.conversacion_id, estado: evento.estado }),
    };
  }
  return { event: "salida", data: JSON.stringify({ task_id: evento.task_id, linea: evento.linea.slice(0, MAX_CARACTERES_SALIDA) }) };
}

// GET /api/eventos-vivos -> text/event-stream
stream.get("/eventos-vivos", (c) => {
  if (cantidadSuscriptores() >= MAX_SUSCRIPTORES) {
    return c.json({ error: "demasiadas_conexiones" }, 503);
  }
  sinLimiteDeInactividad(c);

  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined;
  let baja: (() => void) | undefined;
  let terminado = false;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cola: Uint8Array[] = [];
  let bytesPendientes = 0;

  const vaciar = () => {
    if (!ctrl || terminado) return;
    while (cola.length && (ctrl.desiredSize ?? 0) > 0) {
      const siguiente = cola.shift()!;
      bytesPendientes -= siguiente.byteLength;
      try {
        ctrl.enqueue(siguiente);
      } catch {
        limpiar();
        return;
      }
    }
  };

  const limpiar = () => {
    if (terminado) return;
    terminado = true;
    if (ping !== undefined) {
      clearInterval(ping);
      ping = undefined;
    }
    if (baja) {
      baja();
      baja = undefined;
    }
    cola.length = 0;
    bytesPendientes = 0;
    try {
      ctrl?.close();
    } catch {
      // Si el stream ya fue cerrado o abortado, ignorar el error.
    }
  };

  const encolar = (bytes: Uint8Array, salida = false) => {
    if (terminado) return;
    if (
      cola.length >= MAX_EVENTOS_PENDIENTES ||
      bytesPendientes + bytes.byteLength > MAX_BYTES_PENDIENTES
    ) {
      // stdout es informativo y no se guarda en el buffer de reconexión. Si faltan eventos de estado,
      // cerrar fuerza a EventSource a reconectar con Last-Event-ID y recuperar el buffer circular.
      if (!salida) limpiar();
      return;
    }
    cola.push(bytes);
    bytesPendientes += bytes.byteLength;
    vaciar();
  };

  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      const lastEventIdStr = c.req.header("last-event-id");
      const parsedLastEventId = lastEventIdStr && /^\d+$/.test(lastEventIdStr) ? Number(lastEventIdStr) : null;
      const lastEventId = parsedLastEventId !== null && Number.isSafeInteger(parsedLastEventId) ? parsedLastEventId : null;
      const suscripcion = suscribirConEventosDesde(lastEventId, (evento, id) => {
        if (terminado) return;
        const mensaje = aMensaje(evento);
        encolar(encoder.encode(`id: ${id}\nevent: ${mensaje.event}\ndata: ${mensaje.data}\n\n`), evento.tipo === "salida");
      });
      baja = suscripcion.baja;
      // Abre el canal de inmediato. En una primera conexión se guarda el cursor actual en el comentario
      // para que una reconexión lenta pueda recuperar estados desde el buffer circular.
      try {
        controller.enqueue(encoder.encode(lastEventId === null ? `id: ${suscripcion.cursor}\n: ok\n\n` : ": ok\n\n"));
      } catch {
        limpiar();
        return;
      }

      // Si el cliente reconectó con Last-Event-ID, entrega los eventos perdidos en orden
      for (const item of suscripcion.eventos) {
        const mensaje = aMensaje(item.evento);
        encolar(encoder.encode(`id: ${item.id}\nevent: ${mensaje.event}\ndata: ${mensaje.data}\n\n`), item.evento.tipo === "salida");
        if (terminado) return;
      }

      ping = setInterval(() => {
        if (terminado) return;
        if (cola.length > 0 || (ctrl?.desiredSize ?? 0) <= 0) return;
        try {
          controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
        } catch {
          limpiar();
        }
      }, PING_MS);
    },
    cancel() {
      limpiar();
    },
    pull() {
      vaciar();
    },
  }, { highWaterMark: 1 });

  c.req.raw.signal.addEventListener("abort", () => {
    limpiar();
  });

  return new Response(cuerpo, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
