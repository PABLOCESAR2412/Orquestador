import { Hono } from "hono";
import { ErrorClonado, verificarRepositorio } from "../clonado";
import { sinLimiteDeInactividad } from "../conexion";
import { leerCuerpoJson } from "./projects";
import { secretosDisponibles } from "../secretos";

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
import {
  borrarInstalacionGithubApp,
  ErrorGithubApp,
  estadoGithubApp,
  instalacionSeleccionadaGithubApp,
  listarInstalacionesGithubApp,
  seleccionarInstalacionGithubApp,
} from "../github-app";

// GET /api/github/cuenta -> devuelve si hay cuenta vinculada, usuario y permisos
github.get("/github/cuenta", (c) => c.json(cuentaGithubGlobal()));

// POST /api/github/cuenta -> valida el token en api.github.com/user y guarda la sesión
github.post("/github/cuenta", async (c) => {
  const body = await leerCuerpoJson<{ token?: unknown }>(c);
  if (!body || typeof body.token !== "string" || !body.token.trim()) {
    return c.json({ error: "token_requerido" }, 400);
  }

  const token = body.token.trim();
  if (!secretosDisponibles()) return c.json({ error: "clave_sin_cifrado" }, 503);
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

// La App vive en el servidor; el navegador solo puede elegir entre instalaciones que el servidor
// ya verificó con el JWT firmado por la clave privada.
github.get("/github/app/instalaciones", async (c) => {
  const estado = estadoGithubApp();
  if (!estado.configurado) {
    return c.json({ ...estado, seleccionada: instalacionSeleccionadaGithubApp()?.id ?? null, instalaciones: [] });
  }
  sinLimiteDeInactividad(c);
  try {
    return c.json({
      ...estado,
      seleccionada: instalacionSeleccionadaGithubApp()?.id ?? null,
      instalaciones: await listarInstalacionesGithubApp(),
    });
  } catch (error) {
    return c.json(
      {
        ...estado,
        seleccionada: instalacionSeleccionadaGithubApp()?.id ?? null,
        instalaciones: [],
        error: error instanceof ErrorGithubApp ? error.code : "github_app_error",
        mensaje: error instanceof ErrorGithubApp ? error.message : "No se pudieron consultar las instalaciones de GitHub.",
      },
      error instanceof ErrorGithubApp ? error.status : 502,
    );
  }
});

github.post("/github/app/instalacion", async (c) => {
  const body = await leerCuerpoJson<{ id?: unknown }>(c);
  if (!body || typeof body.id !== "number") return c.json({ error: "invalid_body" }, 400);
  sinLimiteDeInactividad(c);
  try {
    const instalacion = await seleccionarInstalacionGithubApp(body.id);
    return c.json({ ok: true, instalacion, cuenta: cuentaGithubGlobal() });
  } catch (error) {
    return c.json(
      {
        error: error instanceof ErrorGithubApp ? error.code : "github_app_error",
        mensaje: error instanceof ErrorGithubApp ? error.message : "No se pudo vincular la instalación de GitHub.",
      },
      error instanceof ErrorGithubApp ? error.status : 502,
    );
  }
});

// Desvincula la instalación en Telo; no la desinstala ni cambia sus permisos en GitHub.
github.delete("/github/app/instalacion", (c) => {
  borrarInstalacionGithubApp();
  return c.json({ ok: true });
});

