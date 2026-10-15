import { Hono } from "hono";
import { ErrorClonado, verificarRepositorio } from "../clonado";
import { sinLimiteDeInactividad } from "../conexion";
import { leerCuerpoJson } from "./projects";

export const github = new Hono();

// POST /api/github/verificar  body: { url } -> { url, repo, visibilidad: "publico" | "privado" }
// Revisa el repo sin clave. Si GitHub pide credenciales, se responde "privado" (un repo que no existe
// también las pide, así que puede ser un nombre mal escrito).
github.post("/github/verificar", async (c) => {
  const body = await leerCuerpoJson<{ url?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  // La consulta a GitHub puede tardar más que el tiempo de inactividad de Bun.
  sinLimiteDeInactividad(c);
  try {
    return c.json(await verificarRepositorio(typeof body.url === "string" ? body.url : ""));
  } catch (err) {
    if (err instanceof ErrorClonado) return c.json({ error: err.code }, err.status);
    throw err;
  }
});
