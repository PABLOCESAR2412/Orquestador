import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { cantidadSuscriptores, suscribir, type EventoVivo } from "../bus";

// Canal en vivo: estados de tareas, eventos del historial y líneas de salida del agente.
// Contrato: scratchpad/contrato.md (sección Tareas).

const PING_MS = 25_000;
// Conexiones en vivo a la vez. Una app de un solo usuario no necesita más; el resto se rechaza.
const MAX_SUSCRIPTORES = 20;

export const stream = new Hono();

// Bun corta a los 10 s las conexiones sin datos. El SSE pasa largos ratos sin nada que decir,
// así que se desactiva el límite solo para esta conexión (server.timeout(req, 0)).
// Bun pasa el servidor como segundo argumento de fetch, y Hono lo recibe como c.env.
function sinLimiteDeInactividad(c: Context) {
  const servidor = c.env as { timeout?: (req: Request, segundos: number) => void } | undefined;
  try {
    servidor?.timeout?.(c.req.raw, 0);
  } catch {
    // Sin esta función (otro runtime o pruebas), la conexión sigue; solo puede cortarse por inactividad.
  }
}

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
  return { event: "salida", data: JSON.stringify({ task_id: evento.task_id, linea: evento.linea }) };
}

// GET /api/eventos-vivos -> text/event-stream
stream.get("/eventos-vivos", (c) => {
  if (cantidadSuscriptores() >= MAX_SUSCRIPTORES) return c.json({ error: "demasiadas_conexiones" }, 503);
  sinLimiteDeInactividad(c);

  return streamSSE(c, async (sse) => {
    const baja = suscribir((evento) => {
      if (sse.aborted) return;
      const mensaje = aMensaje(evento);
      sse.writeSSE(mensaje).catch(() => {
        // La conexión ya se cerró; la baja llega por onAbort.
      });
    });

    // La conexión vive mientras el cliente siga conectado: se resuelve al cerrarse.
    await new Promise<void>((resolve) => {
      const ping = setInterval(() => {
        sse.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }, PING_MS);
      sse.onAbort(() => {
        clearInterval(ping);
        baja();
        resolve();
      });
    });
  });
});
