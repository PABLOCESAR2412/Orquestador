import { Hono } from "hono";
import { cantidadSuscriptores, suscribir, eventosDesde, type EventoVivo } from "../bus";
import { sinLimiteDeInactividad } from "../conexion";

// Canal en vivo: estados de tareas, eventos del historial, líneas de salida del agente y pasos de los chats.
// Contrato: scratchpad/contrato.md (sección Tareas).

const PING_MS = 25_000;
// Conexiones en vivo a la vez. Una app de un solo usuario no necesita más; el resto se rechaza.
const MAX_SUSCRIPTORES = 20;

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
        detail: evento.detail,
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
  return { event: "salida", data: JSON.stringify({ task_id: evento.task_id, linea: evento.linea }) };
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
    try {
      ctrl?.close();
    } catch {
      // Si el stream ya fue cerrado o abortado, ignorar el error.
    }
  };

  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      // Abre el canal de inmediato con un comentario SSE para que el proxy envíe cabeceras
      try {
        controller.enqueue(encoder.encode(": ok\n\n"));
      } catch {
        limpiar();
        return;
      }

      // Si el cliente reconectó con Last-Event-ID, entrega los eventos perdidos en orden
      const lastEventIdStr = c.req.header("last-event-id");
      if (lastEventIdStr) {
        const lastEventId = parseInt(lastEventIdStr, 10);
        if (!Number.isNaN(lastEventId) && lastEventId > 0) {
          const pendientes = eventosDesde(lastEventId);
          for (const item of pendientes) {
            try {
              const msg = aMensaje(item.evento);
              controller.enqueue(encoder.encode(`id: ${item.id}\nevent: ${msg.event}\ndata: ${msg.data}\n\n`));
            } catch {
              limpiar();
              return;
            }
          }
        }
      }

      baja = suscribir((evento, id) => {
        if (terminado) return;
        try {
          const mensaje = aMensaje(evento);
          controller.enqueue(encoder.encode(`id: ${id}\nevent: ${mensaje.event}\ndata: ${mensaje.data}\n\n`));
        } catch {
          limpiar();
        }
      });

      ping = setInterval(() => {
        if (terminado) return;
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
  });

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
