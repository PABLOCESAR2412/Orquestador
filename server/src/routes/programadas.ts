import { Hono } from "hono";
import { crearTarea } from "../tareas";
import {
  borrarProgramada,
  cambiarActiva,
  insertarProgramada,
  leerProgramada,
  listarProgramadas,
  prepararProgramada,
  registrarEjecucionManual,
  ultimaTareaActiva,
} from "../programadas";
import { leerCuerpoJson, leerTareaApi } from "./projects";

// Tareas programadas. El planificador vive en ../programadas.ts y revisa cada 30 s.
export const programadasRoute = new Hono();

// GET /api/programadas -> Programada[]
programadasRoute.get("/programadas", (c) => c.json(listarProgramadas()));

// POST /api/programadas  body: { titulo?, prompt, model?, effort?, projectId?, frecuencia, cada_horas | hora }
programadasRoute.post("/programadas", async (c) => {
  const body = await leerCuerpoJson<Record<string, unknown>>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const preparada = await prepararProgramada(body);
  if (!preparada.ok) return c.json({ error: preparada.error }, preparada.status);

  const id = insertarProgramada(preparada.valor);
  if (!id) return c.json({ error: "too_many_programadas" }, 409);
  return c.json(leerProgramada(id), 201);
});

// PATCH /api/programadas/:id  body: { activa }
programadasRoute.patch("/programadas/:id", async (c) => {
  const id = c.req.param("id");
  if (!leerProgramada(id)) return c.json({ error: "programada_not_found" }, 404);

  const body = await leerCuerpoJson<{ activa?: unknown }>(c);
  if (!body || typeof body.activa !== "boolean") return c.json({ error: "invalid_body" }, 400);

  cambiarActiva(id, body.activa);
  return c.json(leerProgramada(id));
});

// DELETE /api/programadas/:id -> { ok: true }
programadasRoute.delete("/programadas/:id", (c) => {
  if (!borrarProgramada(c.req.param("id"))) return c.json({ error: "programada_not_found" }, 404);
  return c.json({ ok: true });
});

// POST /api/programadas/:id/ejecutar -> crea la tarea ahora. No mueve la próxima ejecución.
programadasRoute.post("/programadas/:id/ejecutar", (c) => {
  const id = c.req.param("id");
  const p = leerProgramada(id);
  if (!p) return c.json({ error: "programada_not_found" }, 404);
  // Sin solapes: mientras la última tarea de esta programada siga en cola o en curso, no se lanza otra.
  if (ultimaTareaActiva(id)) return c.json({ error: "programada_en_curso" }, 409);

  let tareaId: string;
  try {
    tareaId = crearTarea({
      prompt: p.prompt,
      model: p.model,
      effort: p.effort,
      projectId: p.project_id,
      titulo: p.titulo,
      origen: "programada",
    });
  } catch (err) {
    console.error(`Programada ${id}: no se pudo crear la tarea. ${err instanceof Error ? err.message.slice(0, 200) : ""}`);
    return c.json({ error: "tarea_no_creada" }, 500);
  }

  registrarEjecucionManual(id, tareaId);
  return c.json(leerTareaApi(tareaId), 201);
});
