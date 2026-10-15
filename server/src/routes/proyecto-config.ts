import { Hono } from "hono";
import { db } from "../db";
import { projectRepoPath, leerCuerpoJson } from "./projects";
import {
  listarSkills,
  guardarSkill,
  borrarSkill,
  buscarSkills,
  importarSkill,
  SkillError,
} from "../skills-proyecto";
import { conProyectoRevisado } from "../ocupacion";
import { gitOk, prepararRepoSeguro, tieneGitReal } from "../git";
import { urlGithubPermitida, mensajeSeguro } from "../workspace";
import { valorSecreto } from "../secretos";
import { clavePublicaDe } from "../clave-ssh";
import { tokenGithubGlobal } from "../github-auth";

export const proyectoConfig = new Hono();
proyectoConfig.use("/projects/:id/*", async (c, next) => {
  if (!projectRepoPath(c.req.param("id"))) return c.json({ error: "project_not_found" }, 404);
  await next();
});
proyectoConfig.get("/skills/catalogo/buscar", async (c) => {
  try {
    return c.json(await buscarSkills(c.req.query("q") ?? ""));
  } catch (e) {
    return c.json({ error: e instanceof SkillError ? e.code : "skill_catalog_failed" }, 502);
  }
});
proyectoConfig.get("/projects/:id/skills-importadas", (c) => c.json(listarSkills(c.req.param("id"))));
proyectoConfig.post("/projects/:id/skills-importadas", async (c) => {
  const b = await leerCuerpoJson<{ name: string; content: string; url?: string }>(c);
  if (!b) return c.json({ error: "invalid_body" }, 400);
  try {
    return c.json(
      b.url ? await importarSkill(c.req.param("id"), b.url) : guardarSkill(c.req.param("id"), b),
      201,
    );
  } catch (e) {
    return c.json(
      {
        error: e instanceof SkillError ? e.code : "invalid_skill_content",
        detail: mensajeSeguro(e),
      },
      e instanceof SkillError ? e.status : 400,
    );
  }
});
proyectoConfig.delete("/projects/:id/skills-importadas/:name", (c) => {
  try {
    borrarSkill(c.req.param("id"), c.req.param("name"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof SkillError ? e.code : "invalid_skill_name" }, 400);
  }
});
proyectoConfig.get("/projects/:id/contexto", (c) => {
  const row = db
    .query<
      { compartir_contexto: number },
      [string]
    >("SELECT compartir_contexto FROM projects WHERE id=?")
    .get(c.req.param("id"))!;
  const chats = db
    .query<
      { id: string; title: string; mensajes: number },
      [string]
    >("SELECT c.id,c.title,COUNT(m.id) AS mensajes FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id WHERE c.project_id=? GROUP BY c.id ORDER BY c.created_at DESC")
    .all(c.req.param("id"));
  return c.json({ compartir: !!row.compartir_contexto, chats });
});
proyectoConfig.put("/projects/:id/contexto", async (c) => {
  const b = await leerCuerpoJson<{ compartir: boolean }>(c);
  if (!b || typeof b.compartir !== "boolean") return c.json({ error: "invalid_body" }, 400);
  db.query("UPDATE projects SET compartir_contexto=? WHERE id=?").run(
    Number(b.compartir),
    c.req.param("id"),
  );
  return c.json({ ok: true });
});
export function configGit(id: string) {
  return (
    db
      .query<
        { remote: string | null; author_name: string; author_email: string; base_branch: string },
        [string]
      >("SELECT remote,author_name,author_email,base_branch FROM project_git WHERE project_id=?")
      .get(id) ?? {
      remote: null,
      author_name: "Telo",
      author_email: "telo@localhost",
      base_branch: "main",
    }
  );
}
proyectoConfig.get("/projects/:id/git", async (c) => {
  const id = c.req.param("id");
  const cfg = configGit(id);
  const cwd = projectRepoPath(id)!;
  const repo = await conProyectoRevisado(id, async () => {
    if (!(await prepararRepoSeguro(cwd))) return { inicializado: false, remote: null };
    const remoto = await gitOk(["config", "--get", "remote.origin.url"], { cwd }).catch(() => "");
    return { inicializado: true, remote: urlGithubPermitida(remoto) ?? null };
  });
  return c.json({
    ...cfg,
    remote: cfg.remote ?? repo?.remote ?? null,
    inicializado: repo?.inicializado ?? tieneGitReal(cwd),
    ocupado: repo === null,
    token: !!valorSecreto(id, "GITHUB_TOKEN") || !!tokenGithubGlobal(),
    prToken: !!valorSecreto(id, "GITHUB_PR_TOKEN"),
    ssh: !!clavePublicaDe(id),
  });
});
proyectoConfig.put("/projects/:id/git", async (c) => {
  const b = await leerCuerpoJson<{
    remote: string;
    author_name: string;
    author_email: string;
    base_branch: string;
  }>(c);
  if (
    !b ||
    typeof b.remote !== "string" ||
    typeof b.author_name !== "string" ||
    !b.author_name.trim() ||
    b.author_name.length > 100 ||
    typeof b.author_email !== "string" ||
    !/^[^\s@]+@[^\s@]+$/.test(b.author_email) ||
    b.author_email.length > 200 ||
    typeof b.base_branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(b.base_branch) ||
    b.base_branch.includes("..")
  )
    return c.json({ error: "invalid_git_config" }, 400);
  const remoto = b.remote.trim() ? urlGithubPermitida(b.remote) : null;
  if (b.remote.trim() && !remoto) return c.json({ error: "remoto_no_permitido" }, 400);
  db.query(
    "INSERT INTO project_git(project_id,remote,author_name,author_email,base_branch) VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET remote=excluded.remote,author_name=excluded.author_name,author_email=excluded.author_email,base_branch=excluded.base_branch",
  ).run(c.req.param("id"), remoto, b.author_name.trim(), b.author_email, b.base_branch);
  return c.json({ ok: true });
});

export async function githubApi(projectId: string, path: string, body?: unknown) {
  const token = valorSecreto(projectId, "GITHUB_TOKEN") || tokenGithubGlobal();
  if (!token)
    throw new Error(
      "Inicia sesión con GitHub en Ajustes o configura GITHUB_TOKEN en los secretos del proyecto. Para subir necesita Contents de escritura.",
    );
  return githubLlamar(token, path, body);
}

// Crear un pull request usa solo GITHUB_PR_TOKEN, con permiso de Pull requests. No hay respaldo a la
// cuenta de GitHub ni a GITHUB_TOKEN, que puede subir código.
export async function githubApiPr(projectId: string, path: string, body: unknown) {
  const token = valorSecreto(projectId, "GITHUB_PR_TOKEN");
  if (!token)
    throw new Error(
      "Configura GITHUB_PR_TOKEN en los secretos del proyecto. Debe tener solo permiso de Pull requests (lectura y escritura).",
    );
  return githubLlamar(token, path, body);
}

async function githubLlamar(token: string, path: string, body?: unknown) {
  const res = await fetch("https://api.github.com" + path, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? "GitHub rechazó el token. Revísalo en los secretos del proyecto."
        : res.status === 403 || res.status === 404
          ? "El token no tiene acceso a ese repositorio o le faltan permisos."
          : `GitHub no pudo completar la acción (${res.status}).`,
    );
  return res.json();
}
proyectoConfig.post("/projects/:id/git/comprobar", async (c) => {
  const id = c.req.param("id"),
    remoto = configGit(id).remote;
  if (!remoto) return c.json({ error: "sin_remoto" }, 409);
  try {
    const repo = (await githubApi(id, "/repos/" + remoto.replace("https://github.com/", ""))) as {
      permissions?: { push?: boolean };
      full_name: string;
    };
    return c.json({ ok: true, repo: repo.full_name, push: repo.permissions?.push === true });
  } catch (e) {
    return c.json({ error: "github_access", detail: mensajeSeguro(e) }, 409);
  }
});
