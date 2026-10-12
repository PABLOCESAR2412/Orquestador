import { Hono } from "hono";
import { borrarClaveProyecto, clavePublicaDe, ErrorClaveSsh, generarClaveProyecto } from "../clave-ssh";
import { secretosDisponibles } from "../secretos";
import { projectRepoPath } from "./projects";

// La clave privada nunca sale por la API: solo la parte pública y su huella.
export const claveSshRoute = new Hono();

const ESTADO_ERROR: Record<string, 409 | 500 | 503> = {
  clave_existente: 409,
  clave_sin_cifrado: 503,
  clave_no_generada: 500,
};

// GET /api/projects/:id/clave-ssh -> { disponible, existe, publica, huella, creada_en }
claveSshRoute.get("/projects/:id/clave-ssh", (c) => {
  const id = c.req.param("id");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  const clave = clavePublicaDe(id);
  return c.json({
    disponible: secretosDisponibles(),
    existe: clave !== null,
    publica: clave?.publica ?? null,
    huella: clave?.huella ?? null,
    creada_en: clave?.creada_en ?? null,
  });
});

// POST /api/projects/:id/clave-ssh -> crea el par de claves. 409 si el proyecto ya tiene una.
claveSshRoute.post("/projects/:id/clave-ssh", async (c) => {
  const id = c.req.param("id");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  try {
    const clave = await generarClaveProyecto(id);
    return c.json({ disponible: true, existe: true, publica: clave.publica, huella: clave.huella, creada_en: clave.creada_en }, 201);
  } catch (err) {
    if (err instanceof ErrorClaveSsh && ESTADO_ERROR[err.code]) {
      return c.json({ error: err.code }, ESTADO_ERROR[err.code]);
    }
    throw err;
  }
});

// DELETE /api/projects/:id/clave-ssh -> { ok: true }. Quita la clave de Telo; la deploy key sigue en GitHub hasta que se borre allí.
claveSshRoute.delete("/projects/:id/clave-ssh", (c) => {
  const id = c.req.param("id");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  if (!borrarClaveProyecto(id)) return c.json({ error: "clave_no_encontrada" }, 404);
  return c.json({ ok: true });
});
