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
import { cuentaGithubGlobal, tokenGithubGlobal } from "../github-auth";
import { instalacionSeleccionadaGithubApp, tokenGithubAppParaRepo } from "../github-app";

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
  const guardada = db
      .query<
        { remote: string | null; author_name: string; author_email: string; base_branch: string },
        [string]
      >("SELECT remote,author_name,author_email,base_branch FROM project_git WHERE project_id=?")
      .get(id);
  if (guardada) return guardada;
  const cuenta = cuentaGithubGlobal();
  return {
      remote: null,
      author_name: cuenta.name || cuenta.login || "Telo",
      author_email: cuenta.login ? `${cuenta.login}@users.noreply.github.com` : "telo@localhost",
      base_branch: "main",
  };
}

async function datosRepositorio(id: string) {
  const cwd = projectRepoPath(id)!;
  return conProyectoRevisado(id, async () => {
    if (!(await prepararRepoSeguro(cwd))) return { inicializado: false, remote: null };
    const remoto = await gitOk(["config", "--get", "remote.origin.url"], { cwd }).catch(() => "");
    return { inicializado: true, remote: urlGithubPermitida(remoto) ?? null };
  });
}

proyectoConfig.get("/projects/:id/git", async (c) => {
  const id = c.req.param("id");
  const cfg = configGit(id);
  const cwd = projectRepoPath(id)!;
  const repo = await datosRepositorio(id);
  const remote = cfg.remote ?? repo?.remote ?? null;
  return c.json({
    remote,
    repository: remote?.replace(/^https:\/\/github\.com\//, "") ?? null,
    author_name: cfg.author_name,
    base_branch: cfg.base_branch,
    github: cuentaGithubGlobal(),
    inicializado: repo?.inicializado ?? tieneGitReal(cwd),
    ocupado: repo === null,
    token: !!valorSecreto(id, "GITHUB_TOKEN"),
    tokenProyecto: !!valorSecreto(id, "GITHUB_TOKEN"),
    tokenGlobal: !instalacionSeleccionadaGithubApp() && !!tokenGithubGlobal(),
    prToken: !!valorSecreto(id, "GITHUB_PR_TOKEN"),
    ssh: !!clavePublicaDe(id),
  });
});
proyectoConfig.put("/projects/:id/git", async (c) => {
  const b = await leerCuerpoJson<{
    remote: string;
    author_name: string;
    base_branch: string;
  }>(c);
  if (
    !b ||
    typeof b.remote !== "string" ||
    typeof b.author_name !== "string" ||
    !b.author_name.trim() ||
    b.author_name.length > 100 ||
    typeof b.base_branch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(b.base_branch) ||
    b.base_branch.includes("..")
  )
    return c.json({ error: "invalid_git_config" }, 400);
  const remoto = b.remote.trim() ? urlGithubPermitida(b.remote) : null;
  if (b.remote.trim() && !remoto) return c.json({ error: "remoto_no_permitido" }, 400);
  const repo = await datosRepositorio(c.req.param("id"));
  if (!repo) return c.json({ error: "proyecto_ocupado" }, 409);
  const remotoFijado = configGit(c.req.param("id")).remote ?? repo.remote;
  if (remotoFijado && remoto !== remotoFijado) return c.json({ error: "repositorio_inmutable" }, 409);
  const actual = configGit(c.req.param("id"));
  const cuenta = cuentaGithubGlobal();
  const email = actual.author_email === "telo@localhost" && cuenta.login
    ? `${cuenta.login}@users.noreply.github.com`
    : actual.author_email;
  db.query(
    "INSERT INTO project_git(project_id,remote,author_name,author_email,base_branch) VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET remote=excluded.remote,author_name=excluded.author_name,author_email=excluded.author_email,base_branch=excluded.base_branch",
  ).run(c.req.param("id"), remoto, b.author_name.trim(), email, b.base_branch);
  return c.json({ ok: true });
});

export type AccionGithub = "push" | "pr" | "merge";
export type FuenteAutenticacionGithub = {
  tipo: "github_app" | "credencial_anterior" | "clave_ssh" | "ninguna";
  origen: "app" | "sesion_anterior" | "token_proyecto" | "token_pr_proyecto" | "ssh" | "ninguna";
  etiqueta: string;
  cuenta: string | null;
  instalacion_id: number | null;
};

export function fuenteAutenticacionGithub(
  projectId: string,
  accion: AccionGithub,
  remotoOpt?: string | null,
): FuenteAutenticacionGithub {
  const remoto = remotoOpt ?? configGit(projectId).remote;
  const ownerMatch = remoto ? /github\.com\/([A-Za-z0-9-]+)\//i.exec(remoto) : null;
  const ownerRepo = ownerMatch ? ownerMatch[1].toLowerCase() : null;
  const instalacion = instalacionSeleccionadaGithubApp();

  // Si hay GitHub App configurada y coincide con el dueño del repositorio (o no hay dueño conocido aún)
  if (instalacion && (!ownerRepo || instalacion.login.toLowerCase() === ownerRepo)) {
    return {
      tipo: "github_app",
      origen: "app",
      etiqueta: "GitHub App",
      cuenta: instalacion.login,
      instalacion_id: instalacion.id,
    };
  }

  // Sesión global activa de GitHub (máxima precedencia tras la GitHub App para identificar la cuenta de usuario)
  if (tokenGithubGlobal()) {
    return {
      tipo: "credencial_anterior",
      origen: "sesion_anterior",
      etiqueta: "Credencial anterior",
      cuenta: cuentaGithubGlobal().login ?? null,
      instalacion_id: null,
    };
  }

  // Si no hay sesión global activa ni App coincidente, usamos credenciales locales del proyecto
  if (accion === "push" && clavePublicaDe(projectId)) {
    return {
      tipo: "clave_ssh",
      origen: "ssh",
      etiqueta: "Clave SSH del proyecto",
      cuenta: null,
      instalacion_id: null,
    };
  }
  if (accion === "push" && valorSecreto(projectId, "GITHUB_TOKEN")) {
    return {
      tipo: "credencial_anterior",
      origen: "token_proyecto",
      etiqueta: "Credencial anterior del proyecto",
      cuenta: null,
      instalacion_id: null,
    };
  }
  if ((accion === "pr" || accion === "merge") && valorSecreto(projectId, "GITHUB_PR_TOKEN")) {
    return {
      tipo: "credencial_anterior",
      origen: "token_pr_proyecto",
      etiqueta: "Credencial anterior del proyecto",
      cuenta: null,
      instalacion_id: null,
    };
  }

  // Si no hay credenciales locales del proyecto, pero hay GitHub App conectada:
  if (instalacion) {
    return {
      tipo: "github_app",
      origen: "app",
      etiqueta: "GitHub App",
      cuenta: instalacion.login,
      instalacion_id: instalacion.id,
    };
  }

  return {
    tipo: "ninguna",
    origen: "ninguna",
    etiqueta: "Sin credencial disponible",
    cuenta: null,
    instalacion_id: null,
  };
}

export async function githubApi(
  projectId: string,
  path: string,
  autenticacion: FuenteAutenticacionGithub,
  body?: unknown,
) {
  const remoto = remotoDeRutaGithub(path);
  if (!remoto) throw new Error("La ruta de GitHub no identifica un repositorio válido.");
  const token = await tokenParaFuenteGithub(projectId, remoto, "push", autenticacion);
  return {
    data: await githubLlamar(token, path, body, autenticacion.tipo === "github_app" ? "github_app" : "credencial_anterior", "Contents"),
    viaApp: autenticacion.tipo === "github_app",
  };
}

export async function githubApiPr(
  projectId: string,
  path: string,
  autenticacion: FuenteAutenticacionGithub,
  body?: unknown,
  metodo?: string,
  accion: AccionGithub = "pr",
) {
  const remoto = remotoDeRutaGithub(path);
  if (!remoto) throw new Error("La ruta de GitHub no identifica un repositorio válido.");
  const token = await tokenParaFuenteGithub(projectId, remoto, accion, autenticacion);
  const permiso = accion === "merge" && metodo === "PUT" ? "Contents" : "Pull requests";
  return githubLlamar(token, path, body, autenticacion.tipo === "github_app" ? "github_app" : "credencial_anterior", permiso, metodo);
}

async function tokenParaFuenteGithub(
  projectId: string,
  remoto: string,
  accion: AccionGithub,
  autenticacion: FuenteAutenticacionGithub,
): Promise<string> {
  const actual = fuenteAutenticacionGithub(projectId, accion);
  if (
    actual.tipo !== autenticacion.tipo ||
    actual.origen !== autenticacion.origen ||
    actual.cuenta !== autenticacion.cuenta ||
    actual.instalacion_id !== autenticacion.instalacion_id
  ) {
    throw new Error("La credencial de GitHub cambió desde que preparaste la acción. Solicita una autorización nueva.");
  }

  let token: string | null = null;
  if (autenticacion.tipo === "github_app") {
    token = await tokenGithubAppParaRepo(
      remoto,
      accion === "pr"
        ? { pull_requests: "write" }
        : accion === "merge"
          ? { contents: "write", pull_requests: "write" }
          : { contents: "write" },
    );
  } else if (autenticacion.origen === "sesion_anterior") {
    token = tokenGithubGlobal();
  } else if (autenticacion.origen === "token_proyecto" && accion === "push") {
    token = valorSecreto(projectId, "GITHUB_TOKEN");
  } else if (autenticacion.origen === "token_pr_proyecto" && (accion === "pr" || accion === "merge")) {
    token = valorSecreto(projectId, "GITHUB_PR_TOKEN");
  }
  if (!token) {
    throw new Error(autenticacion.tipo === "ninguna"
      ? `No hay una credencial disponible para ${accion === "pr" ? "Pull requests" : accion === "merge" ? "fusionar Pull requests" : "subir cambios"}. Vincula la GitHub App o selecciona una credencial en Ajustes.`
      : "La credencial que autorizaste ya no está disponible. Revisa GitHub en Ajustes y prepara otra autorización.");
  }
  return token;
}

function remotoDeRutaGithub(path: string): string | null {
  const match = /^\/repos\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)(?:\/|$)/.exec(path);
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

async function githubLlamar(
  token: string,
  path: string,
  body?: unknown,
  tipoAutenticacion: "github_app" | "credencial_anterior" = "credencial_anterior",
  permiso = "escritura",
  metodo?: string,
) {
  const method = metodo ?? (body ? "POST" : "GET");
  const res = await fetch("https://api.github.com" + path, {
    method,
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
  if (!res.ok) {
    // GitHub usa 422 tanto para validaciones concretas como para límites anti-spam. Conservamos
    // su mensaje y errores estructurados para que la tarjeta de autorización explique el motivo.
    if (res.status === 422) {
      const respuesta = await res.json().catch(() => null) as {
        message?: unknown;
        errors?: unknown;
      } | null;
      const mensajes = [
        typeof respuesta?.message === "string" ? respuesta.message : "",
        ...(Array.isArray(respuesta?.errors)
          ? respuesta.errors.map((error) => {
              if (typeof error === "string") return error;
              if (!error || typeof error !== "object") return "";
              const detalle = error as { field?: unknown; code?: unknown; message?: unknown };
              const campo = typeof detalle.field === "string" ? `${detalle.field}: ` : "";
              const texto = typeof detalle.message === "string"
                ? detalle.message
                : typeof detalle.code === "string" ? detalle.code : "";
              return `${campo}${texto}`;
            })
          : []),
      ].filter(Boolean);
      const detalle = mensajes.join("; ").slice(0, 500);
      if (path.endsWith("/pulls") && /no commits between/i.test(detalle)) {
        throw new Error(
          "GitHub no ve commits nuevos entre la rama de Telo y la rama base. Comprueba que el commit se haya subido a la rama indicada y que la rama base sea correcta; después prepara una nueva autorización de PR.",
        );
      }
      throw new Error(`GitHub no pudo completar la acción (422)${detalle ? `: ${detalle}` : "."}`);
    }
    if (res.status === 405 && method === "PUT" && /\/pulls\/\d+\/merge$/.test(path)) {
      throw new Error(
        "GitHub indica que este Pull Request no se puede fusionar ahora; puede tener conflictos o requisitos de rama pendientes. Corrígelos en GitHub y solicita una nueva autorización de merge.",
      );
    }
    if (res.status === 401) {
      throw new Error(tipoAutenticacion === "github_app"
        ? "GitHub rechazó la credencial temporal de la App. Revisa la instalación y vuelve a vincularla en Ajustes."
        : "GitHub rechazó la credencial anterior. Vuelve a conectar la cuenta en Ajustes o cambia a la GitHub App.");
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error(tipoAutenticacion === "github_app"
        ? `La GitHub App no puede acceder a este repositorio o no tiene permiso ${permiso} de escritura. Añade el repo a la instalación y revisa sus permisos en GitHub.`
        : `La credencial anterior no tiene acceso de escritura a este repositorio para ${permiso}. Revisa su acceso en GitHub o cambia a la GitHub App.`);
    }
    throw new Error(`GitHub no pudo completar la acción (${res.status}).`);
  }
  return res.json();
}

export async function comprobarAccesoGithub(
  projectId: string,
  remoto: string,
  accion: AccionGithub,
  fuente = fuenteAutenticacionGithub(projectId, accion, remoto),
) {
  if (fuente.tipo === "ninguna") {
    throw new Error("No hay una credencial de GitHub disponible. Vincula la GitHub App o revisa las credenciales anteriores.");
  }
  if (accion === "push" && fuente.tipo === "clave_ssh") {
    return {
      repo: remoto.replace(/^https:\/\/github\.com\//, ""),
      push: null,
      autenticacion: fuente,
      verificacion: "no_verificada" as const,
      aviso: "La clave SSH está configurada, pero GitHub no permite confirmar escritura sin intentar la subida. Revisa que la clave tenga acceso de escritura.",
    };
  }

  const ruta = "/repos/" + remoto.replace(/^https:\/\/github\.com\//, "");
  const respuesta = accion === "pr" || accion === "merge"
    ? await githubApiPr(projectId, ruta, fuente, undefined, undefined, accion) as { full_name?: string; permissions?: { push?: boolean } }
    : (await githubApi(projectId, ruta, fuente)).data as { full_name?: string; permissions?: { push?: boolean } };
  const escritura = respuesta.permissions?.push === true;
  if (fuente.tipo !== "github_app" && !escritura) {
    const accionTexto = accion === "pr" ? "crear pull requests" : accion === "merge" ? "fusionar pull requests" : "subir cambios";
    throw new Error(`GitHub permite consultar ${respuesta.full_name ?? "el repositorio"}, pero la credencial anterior no tiene permiso para ${accionTexto}. Revisa los permisos de la cuenta en GitHub o cambia a la GitHub App.`);
  }
  return {
    repo: respuesta.full_name ?? remoto.replace(/^https:\/\/github\.com\//, ""),
    push: accion === "push" ? (fuente.tipo === "github_app" ? true : escritura) : escritura,
    autenticacion: fuente,
    verificacion: "confirmada" as const,
    aviso: null,
  };
}
proyectoConfig.post("/projects/:id/git/comprobar", async (c) => {
  const id = c.req.param("id");
  const body = await leerCuerpoJson<{ action?: unknown }>(c);
  const action = body?.action === undefined ? "push" : body.action;
  if (action !== "push" && action !== "pr" && action !== "merge") return c.json({ error: "invalid_body" }, 400);
  const repoLocal = await datosRepositorio(id);
  if (!repoLocal) return c.json({ error: "proyecto_ocupado" }, 409);
  const remoto = configGit(id).remote ?? repoLocal.remote;
  if (!remoto) return c.json({ error: "sin_remoto" }, 409);
  try {
    const respuesta = await comprobarAccesoGithub(id, remoto, action);
    return c.json({ ok: true, ...respuesta });
  } catch (e) {
    return c.json({ error: "github_access", detail: mensajeSeguro(e) }, 409);
  }
});
