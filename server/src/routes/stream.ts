import { Hono } from "hono";
import { cantidadSuscriptores, suscribir, type EventoVivo } from "../bus";
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
  };

  const cuerpo = new ReadableStream({
    start(controller) {
      // Abre el canal de inmediato con un comentario SSE para que el proxy envíe cabeceras
      controller.enqueue(encoder.encode(": ok\n\n"));

      baja = suscribir((evento) => {
        if (terminado) return;
        try {
          const mensaje = aMensaje(evento);
          controller.enqueue(encoder.encode(`event: ${mensaje.event}\ndata: ${mensaje.data}\n\n`));
        } catch {
          limpiar();
          try {
            controller.close();
          } catch {}
        }
      });

      ping = setInterval(() => {
        if (terminado) return;
        try {
          controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
        } catch {
          limpiar();
          try {
            controller.close();
          } catch {}
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
