import { Hono } from "hono";
import { estadoInstalacion, esInstalable, InstalacionError, iniciarInstalacion } from "../instalacion";

// Instalación de herramientas del servidor (hoy solo OpenCode). La instalación exige confirmación explícita
// en el cuerpo: la interfaz muestra primero el comando y luego pide que se confirme.
export const herramientas = new Hono();

// GET /api/herramientas/:id/instalacion
herramientas.get("/herramientas/:id/instalacion", (c) => {
  const id = c.req.param("id");
  if (!esInstalable(id)) return c.json({ error: "herramienta_desconocida" }, 404);
  return c.json(estadoInstalacion(id));
});

// POST /api/herramientas/:id/instalacion  body: { confirmar: true }
herramientas.post("/herramientas/:id/instalacion", async (c) => {
  const id = c.req.param("id");
  const cuerpo = (await c.req.json().catch(() => null)) as { confirmar?: unknown } | null;
  if (cuerpo?.confirmar !== true) return c.json({ error: "confirmacion_requerida" }, 400);
  try {
    return c.json(iniciarInstalacion(id), 202);
  } catch (err) {
    if (err instanceof InstalacionError) return c.json({ error: err.code }, err.status);
    throw err;
  }
});
