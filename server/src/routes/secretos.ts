import { Hono } from "hono";
import {
  borrarSecreto,
  guardarSecreto,
  listarSecretos,
  nombreSecretoValido,
  secretosDisponibles,
  valorSecretoValido,
} from "../secretos";
import { leerCuerpoJson, projectRepoPath } from "./projects";

// Los valores nunca salen por la API: solo nombres y fechas. El valor se escribe una vez.
export const secretosRoute = new Hono();
const CREDENCIALES_GITHUB_PROYECTO = new Set(["GITHUB_TOKEN", "GITHUB_PR_TOKEN"]);

// GET /api/projects/:id/secretos -> { disponible, secretos: [{ nombre, actualizado_en }] }
secretosRoute.get("/projects/:id/secretos", (c) => {
  const id = c.req.param("id");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  return c.json({ disponible: secretosDisponibles(), secretos: listarSecretos(id) });
});

// PUT /api/projects/:id/secretos/:nombre  body: { valor }
secretosRoute.put("/projects/:id/secretos/:nombre", async (c) => {
  const id = c.req.param("id");
  const nombre = c.req.param("nombre");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  if (!nombreSecretoValido(nombre)) return c.json({ error: "invalid_secret_name" }, 400);
  if (CREDENCIALES_GITHUB_PROYECTO.has(nombre)) return c.json({ error: "github_token_por_proyecto" }, 409);

  const body = await leerCuerpoJson<{ valor?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  if (!valorSecretoValido(body.valor)) return c.json({ error: "invalid_secret_value" }, 400);

  const guardado = guardarSecreto(id, nombre, body.valor);
  if (!guardado) return c.json({ error: "secretos_no_configurados" }, 503);
  return c.json(guardado);
});

// DELETE /api/projects/:id/secretos/:nombre -> { ok: true }
secretosRoute.delete("/projects/:id/secretos/:nombre", (c) => {
  const id = c.req.param("id");
  const nombre = c.req.param("nombre");
  if (!projectRepoPath(id)) return c.json({ error: "project_not_found" }, 404);
  if (!nombreSecretoValido(nombre)) return c.json({ error: "invalid_secret_name" }, 400);
  if (!borrarSecreto(id, nombre)) return c.json({ error: "secret_not_found" }, 404);
  return c.json({ ok: true });
});
