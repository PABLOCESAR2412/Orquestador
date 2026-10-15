import { Hono } from "hono";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import { projectRepoPath, leerCuerpoJson } from "./projects";
import {
  aprobarTarea,
  diffDeTarea,
  ErrorTarea,
  mensajeSeguro,
  urlGithubPermitida,
} from "../workspace";
import { conProyectoRevisado } from "../ocupacion";
import { gitOk, gitOkSeguro, prepararRepoSeguro, tieneGitReal } from "../git";
import { configGit, githubApi } from "./proyecto-config";
import { redactar } from "../redaccion";

export const repositoryActions = new Hono();
repositoryActions.get("/conversations/:id/acciones", (c) =>
  c.json(
    db
      .query(
        "SELECT id,action,payload,state,result,task_id FROM repository_actions WHERE conversation_id=? ORDER BY created_at,rowid",
      )
      .all(c.req.param("id")),
  ),
);
repositoryActions.post("/projects/:id/acciones", async (c) => {
  const projectId = c.req.param("id"),
    cwd = projectRepoPath(projectId);
  if (!cwd) return c.json({ error: "project_not_found" }, 404);
  const b = await leerCuerpoJson<{
    action: string;
    conversationId?: string;
    taskId?: string;
    message?: string;
    title?: string;
  }>(c);
  if (!b || !["init", "commit", "push", "pr"].includes(b.action))
    return c.json({ error: "invalid_accion" }, 400);
  if (
    (b.conversationId !== undefined &&
      (typeof b.conversationId !== "string" || !b.conversationId)) ||
    (b.taskId !== undefined && (typeof b.taskId !== "string" || !b.taskId))
  )
    return c.json({ error: "invalid_body" }, 400);
  if (
    b.conversationId &&
    !db
      .query("SELECT 1 FROM conversations WHERE id=? AND project_id=?")
      .get(b.conversationId, projectId)
  )
    return c.json({ error: "conversation_not_found" }, 404);
  const tarea = b.taskId
    ? db
        .query<
          { id: string; status: string; conversation_id: string | null },
          [string, string]
        >("SELECT id,status,conversation_id FROM tasks WHERE id=? AND project_id=?")
        .get(b.taskId, projectId)
    : null;
  if (b.action !== "init" && !tarea) return c.json({ error: "task_without_repo" }, 409);
  if (tarea && b.conversationId && tarea.conversation_id !== b.conversationId)
    return c.json({ error: "invalid_accion" }, 400);
  if (
    (b.message !== undefined && (typeof b.message !== "string" || b.message.length > 200)) ||
    (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 200))
  )
    return c.json({ error: "invalid_body" }, 400);
  try {
    const diff = b.action === "init" ? null : await diffDeTarea(tarea!.id);
    const cfg = configGit(projectId);
    const payload = {
      hash: diff?.hash ?? null,
      diff: diff?.diff ?? "",
      rama: diff?.rama ?? null,
      commit: diff?.commit ?? null,
      archivos: diff?.archivos.map((a) => a.ruta) ?? [],
      truncado: diff?.truncado ?? false,
      remote: diff ? diff.remoto_url : cfg.remote,
      base: cfg.base_branch,
      message: redactar(b.message || "Cambios revisados en Telo"),
      title: redactar(b.title || "Cambios revisados en Telo"),
      descripcion:
        b.action === "init"
          ? "Inicializar Git y crear un primer commit vacío para habilitar los espacios de trabajo. No añade tus archivos."
          : null,
    };
    const id = crypto.randomUUID();
    const existente = db
      .query<
        { id: string },
        [string, string, string]
      >("SELECT id FROM repository_actions WHERE task_id=? AND action=? AND payload=? AND state='pending' LIMIT 1")
      .get(tarea?.id ?? "", b.action, JSON.stringify(payload));
    if (existente)
      return c.json(
        {
          id: existente.id,
          action: b.action,
          payload: JSON.stringify(payload),
          state: "pending",
          task_id: tarea?.id ?? null,
        },
        200,
      );
    db.query(
      "INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      projectId,
      b.conversationId ?? null,
      tarea?.id ?? null,
      b.action,
      JSON.stringify(payload),
    );
    return c.json(
      {
        id,
        action: b.action,
        payload: JSON.stringify(payload),
        state: "pending",
        task_id: tarea?.id ?? null,
      },
      201,
    );
  } catch (e) {
    return c.json({ error: "git_action", detail: mensajeSeguro(e) }, 409);
  }
});

repositoryActions.post("/acciones/:id/decidir", async (c) => {
  const b = await leerCuerpoJson<{ approve: boolean }>(c);
  if (!b || typeof b.approve !== "boolean") return c.json({ error: "invalid_body" }, 400);
  const row = db
    .query<
      {
        id: string;
        project_id: string;
        task_id: string | null;
        action: string;
        payload: string;
        state: string;
      },
      [string]
    >("SELECT * FROM repository_actions WHERE id=?")
    .get(c.req.param("id"));
  if (!row) return c.json({ error: "action_not_found" }, 404);
  if (row.state !== "pending") return c.json({ error: "action_already_decided" }, 409);
  if (!b.approve) {
    db.query("UPDATE repository_actions SET state='rejected' WHERE id=?").run(row.id);
    return c.json({ ok: true });
  }
  // Compare-and-swap: dos dispositivos no pueden ejecutar la misma aprobación.
  if (
    !db
      .query("UPDATE repository_actions SET state='executing' WHERE id=? AND state='pending'")
      .run(row.id).changes
  )
    return c.json({ error: "action_already_decided" }, 409);
  try {
    const p = JSON.parse(row.payload);
    let result: unknown;
    if (row.action === "init") {
      const cwd = projectRepoPath(row.project_id);
      if (!cwd) throw new Error("El proyecto ya no está disponible.");
      result = await conProyectoRevisado(row.project_id, async () => {
        const dirGit = join(cwd, ".git");
        let estadoGit;
        try {
          estadoGit = lstatSync(dirGit);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (estadoGit && (!estadoGit.isDirectory() || !tieneGitReal(cwd)))
          throw new Error("La carpeta .git no es un repositorio seguro. Revisa el proyecto.");
        if (tieneGitReal(cwd)) {
          await prepararRepoSeguro(cwd);
          const head = await gitOkSeguro(["rev-parse", "--verify", "HEAD"], { cwd }).catch(
            () => null,
          );
          if (head) throw new Error("El proyecto ya tiene Git y un commit inicial.");
        } else await gitOk(["init", "-b", "main"], { cwd });
        const cfg = configGit(row.project_id);
        await gitOkSeguro(
          [
            "-c",
            `user.name=${cfg.author_name}`,
            "-c",
            `user.email=${cfg.author_email}`,
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "--only",
            "-m",
            "Inicializar proyecto",
          ],
          { cwd },
        );
        return {
          mensaje: "Repositorio inicializado con un commit vacío. Tus archivos quedan sin añadir.",
        };
      });
      if (!result) throw new Error("El proyecto está ocupado. Reintenta cuando termine.");
    } else if (row.action === "commit" || row.action === "push") {
      const actual = await diffDeTarea(row.task_id!);
      if (actual.hash !== p.hash || actual.remoto_url !== p.remote)
        throw new Error(
          "Los cambios o el remoto cambiaron desde que los revisaste. Solicita otra autorización.",
        );
      result = await aprobarTarea(row.task_id!, {
        accion: row.action,
        hash: p.hash,
        mensaje: p.message,
      });
    } else {
      const diff = await diffDeTarea(row.task_id!);
      if (
        diff.hash !== p.hash ||
        diff.commit !== p.commit ||
        !diff.aprobaciones.push ||
        diff.aprobaciones.push.sha !== p.commit ||
        diff.aprobaciones.commit?.hash !== diff.hash
      )
        throw new Error(
          "El diff cambió o los cambios todavía no tienen commit y subida aprobados. Revísalos otra vez.",
        );
      const remoto = urlGithubPermitida(diff.aprobaciones.push.remoto);
      if (!remoto) throw new Error("Falta un remoto permitido.");
      const cfg = configGit(row.project_id);
      if (p.base !== cfg.base_branch || p.remote !== remoto)
        throw new Error("La configuración del repositorio cambió. Solicita otra aprobación.");
      result = await githubApi(
        row.project_id,
        "/repos/" + remoto.replace("https://github.com/", "") + "/pulls",
        {
          title: p.title,
          head: p.rama,
          base: p.base,
          body: "Cambios revisados y aprobados en Telo.",
        },
      );
    }
    const seguro = JSON.stringify(
      row.action === "pr" ? { url: (result as { html_url: string }).html_url } : result,
    );
    db.query("UPDATE repository_actions SET state='approved', result=? WHERE id=?").run(
      seguro,
      row.id,
    );
    // Cada acción conserva su propia autorización; completar una solo prepara la siguiente.
    if (row.task_id && (row.action === "commit" || row.action === "push")) {
      const t = db
        .query<
          { plan: string | null; conversation_id: string | null; status: string },
          [string]
        >("SELECT plan,conversation_id,status FROM tasks WHERE id=?")
        .get(row.task_id);
      if (t?.plan && t.conversation_id && t.status === "done") {
        const acciones = JSON.parse(t.plan).requiere_aprobacion as string[];
        const siguiente =
          row.action === "commit"
            ? acciones.includes("push")
              ? "push"
              : null
            : acciones.includes("pr")
              ? "pr"
              : null;
        if (siguiente)
          await repositoryActions.request(`http://telo/projects/${row.project_id}/acciones`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: siguiente,
              conversationId: t.conversation_id,
              taskId: row.task_id,
            }),
          });
      }
    }
    return c.json({ ok: true, result: JSON.parse(seguro) });
  } catch (e) {
    const detail = mensajeSeguro(e);
    db.query("UPDATE repository_actions SET state='failed',result=? WHERE id=?").run(
      detail,
      row.id,
    );
    return e instanceof ErrorTarea
      ? c.json({ error: e.code, detail: e.detail }, e.status)
      : c.json({ error: "git_action", detail }, 409);
  }
});
