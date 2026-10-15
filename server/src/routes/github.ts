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

import {
  cuentaGithubGlobal,
  guardarCuentaGithubGlobal,
  borrarCuentaGithubGlobal,
} from "../github-auth";

// GET /api/github/cuenta -> devuelve si hay cuenta vinculada, usuario y permisos
github.get("/github/cuenta", (c) => c.json(cuentaGithubGlobal()));

// POST /api/github/cuenta -> valida el token en api.github.com/user y guarda la sesión
github.post("/github/cuenta", async (c) => {
  const body = await leerCuerpoJson<{ token?: unknown }>(c);
  if (!body || typeof body.token !== "string" || !body.token.trim()) {
    return c.json({ error: "token_requerido" }, 400);
  }

  const token = body.token.trim();
  sinLimiteDeInactividad(c);

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Telo-Orquestador",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401) {
      return c.json({ error: "token_invalido", mensaje: "GitHub rechazó el token. Verifica que no haya expirado." }, 401);
    }
    if (!res.ok) {
      return c.json({ error: "github_error", mensaje: `GitHub respondió con error ${res.status}` }, 502);
    }

    const data = (await res.json()) as { login: string; name?: string; avatar_url?: string };
    const scopesHeader = res.headers.get("x-oauth-scopes") || "";
    const scopes = scopesHeader.split(",").map((s) => s.trim()).filter(Boolean);

    guardarCuentaGithubGlobal({
      token,
      login: data.login,
      name: data.name || data.login,
      avatar_url: data.avatar_url || "",
      scopes,
      actualizado_en: new Date().toISOString(),
    });

    return c.json(cuentaGithubGlobal());
  } catch (e) {
    return c.json({ error: "conexion_fallida", mensaje: "No se pudo conectar con api.github.com" }, 502);
  }
});

// DELETE /api/github/cuenta -> desvincula la cuenta global
github.delete("/github/cuenta", (c) => {
  borrarCuentaGithubGlobal();
  return c.json({ ok: true });
});

