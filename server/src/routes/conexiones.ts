import { Hono } from "hono";
import {
  actualizarConexionMcp,
  borrarConexionMcp,
  crearConexionMcp,
  listarConexionesMcp,
  normalizarUrlMcp,
  validarNombreConexion,
  validarTokenMcp,
} from "../conexiones-mcp";
import { claveMaestra } from "../secretos";

type BodyConexion = {
  nombre?: unknown;
  url?: unknown;
  token?: unknown;
  habilitada?: unknown;
  quitar_token?: unknown;
};

export const conexiones = new Hono();

conexiones.get("/conexiones", (c) => c.json({
  conexiones: listarConexionesMcp(),
  // Solo informa si el servidor puede cifrar nuevos tokens; nunca expone la clave.
  cifrado_disponible: Boolean(claveMaestra()),
}));

conexiones.post("/conexiones", async (c) => {
  const body = await c.req.json<BodyConexion>().catch(() => null);
  if (!body || !validarNombreConexion(body.nombre)) return c.json({ error: "conexion_nombre_invalido" }, 400);
  const url = normalizarUrlMcp(body.url);
  if (!url) return c.json({ error: "conexion_url_invalida" }, 400);
  const token = body.token === undefined ? "" : body.token;
  if (!validarTokenMcp(token)) return c.json({ error: "conexion_token_invalido" }, 400);
  if (token && !claveMaestra()) return c.json({ error: "secretos_no_disponibles" }, 503);

  const creada = crearConexionMcp(body.nombre.trim(), url, token);
  if (!creada) return c.json({ error: "conexion_nombre_duplicado" }, 409);
  return c.json(creada, 201);
});

conexiones.patch("/conexiones/:id", async (c) => {
  const body = await c.req.json<BodyConexion>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const patch: Parameters<typeof actualizarConexionMcp>[1] = {};

  if (body.nombre !== undefined) {
    if (!validarNombreConexion(body.nombre)) return c.json({ error: "conexion_nombre_invalido" }, 400);
    patch.nombre = body.nombre.trim();
  }
  if (body.url !== undefined) {
    const url = normalizarUrlMcp(body.url);
    if (!url) return c.json({ error: "conexion_url_invalida" }, 400);
    patch.url = url;
  }
  if (body.habilitada !== undefined) {
    if (typeof body.habilitada !== "boolean") return c.json({ error: "conexion_estado_invalido" }, 400);
    patch.habilitada = body.habilitada;
  }
  if (body.token !== undefined) {
    if (!validarTokenMcp(body.token)) return c.json({ error: "conexion_token_invalido" }, 400);
    if (body.token) {
      if (!claveMaestra()) return c.json({ error: "secretos_no_disponibles" }, 503);
      patch.token = body.token;
    }
  }
  if (body.quitar_token !== undefined) {
    if (typeof body.quitar_token !== "boolean") return c.json({ error: "conexion_estado_invalido" }, 400);
    patch.quitarToken = body.quitar_token;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "invalid_body" }, 400);

  const actualizada = actualizarConexionMcp(c.req.param("id"), patch);
  if (!actualizada) {
    // Distingue conflicto de nombre de una conexión que ya no existe sin revelar el secreto.
    const existe = listarConexionesMcp().some((item) => item.id === c.req.param("id"));
    return existe
      ? c.json({ error: "conexion_nombre_duplicado" }, 409)
      : c.json({ error: "conexion_not_found" }, 404);
  }
  return c.json(actualizada);
});

conexiones.delete("/conexiones/:id", (c) => {
  if (!borrarConexionMcp(c.req.param("id"))) return c.json({ error: "conexion_not_found" }, 404);
  return c.json({ ok: true });
});
