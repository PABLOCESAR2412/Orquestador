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
import {
  comprobarAccesoGithub,
  configGit,
  fuenteAutenticacionGithub,
  githubApiPr,
} from "./proyecto-config";
import { redactar } from "../redaccion";

export const repositoryActions = new Hono();
repositoryActions.get("/conversations/:id/acciones", (c) =>
  c.json(
    db
      .query(
        `SELECT a.id,a.action,a.payload,a.state,a.result,a.task_id,
          COALESCE(json_extract(a.payload,'$.messageId'),
            (SELECT m.id FROM messages m WHERE m.conversation_id=a.conversation_id
             AND m.role='user' AND m.created_at<=a.created_at
             ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1)) AS message_id
         FROM repository_actions a WHERE a.conversation_id=? ORDER BY a.created_at,a.rowid`,
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
    messageId?: string;
    message?: string;
    title?: string;
    pr_number?: number;
    pr_url?: string;
  }>(c);
  if (!b || !["init", "commit", "push", "pr", "merge"].includes(b.action))
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
  if (b.messageId !== undefined && (typeof b.messageId !== "string" || !b.conversationId ||
    !db.query("SELECT 1 FROM messages WHERE id=? AND conversation_id=? AND role='user'").get(b.messageId, b.conversationId)))
    return c.json({ error: "invalid_body" }, 400);
  const tarea = b.taskId
    ? db
        .query<
          { id: string; status: string; conversation_id: string | null },
          [string, string]
        >("SELECT id,status,conversation_id FROM tasks WHERE id=? AND project_id=?")
        .get(b.taskId, projectId)
    : null;
  if (b.action !== "init" && b.action !== "merge" && !tarea) return c.json({ error: "task_without_repo" }, 409);
  if (b.action === "merge" && !tarea && !b.conversationId)
    return c.json({ error: "task_without_repo" }, 409);
  if (b.action === "merge" && b.taskId && !tarea)
    return c.json({ error: "task_without_repo" }, 409);
  if (tarea && b.conversationId && tarea.conversation_id !== b.conversationId)
    return c.json({ error: "invalid_accion" }, 400);
  if (
    (b.message !== undefined && (typeof b.message !== "string" || b.message.length > 200)) ||
    (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 200)) ||
    (b.pr_number !== undefined && (!Number.isSafeInteger(b.pr_number) || b.pr_number < 1)) ||
    (b.pr_url !== undefined && (typeof b.pr_url !== "string" || b.pr_url.length > 500))
  )
    return c.json({ error: "invalid_body" }, 400);
  const numeroPrUrl = b.pr_url ? /\/pull\/(\d+)(?:[/?#]|$)/i.exec(b.pr_url)?.[1] : null;
  const numeroPrUrlNumerico = numeroPrUrl ? Number(numeroPrUrl) : null;
  if (b.action === "merge" && !b.pr_number && (!numeroPrUrlNumerico || !Number.isSafeInteger(numeroPrUrlNumerico)))
    return c.json({ error: "invalid_body" }, 400);
  try {
    const messageId = b.messageId ?? (b.conversationId
      ? db.query<{ id: string }, [string]>("SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(b.conversationId)?.id ?? null
      : null);
    const diff = (b.action === "init" || b.action === "merge") ? null : await diffDeTarea(tarea!.id);
    if ((b.action === "commit" || b.action === "push") && diff && diff.archivos.length === 0) {
      db.query("UPDATE repository_actions SET state='superseded' WHERE task_id=? AND action IN ('commit','push') AND state='pending'").run(tarea!.id);
      return c.json({ error: "sin_cambios", detail: "No hay archivos modificados para crear un commit." }, 409);
    }
    if (b.action === "push" && !diff?.remoto)
      return c.json({ error: "sin_remoto" }, 409);
    if (b.action === "pr" && diff) {
      const commitVigente = Boolean(
        diff.aprobaciones.commit &&
        diff.aprobaciones.commit.hash === diff.hash &&
        diff.aprobaciones.commit.sha === diff.commit,
      );
      if (!commitVigente) {
        return c.json({
          error: "pr_commit_requerido",
          detail: "Primero crea y aprueba el commit de esta versión de los cambios.",
        }, 409);
      }
      const pushVigente = Boolean(
        diff.aprobaciones.push &&
        diff.aprobaciones.push.sha === diff.commit &&
        diff.aprobaciones.push.rama === diff.rama &&
        diff.aprobaciones.push.remoto === diff.remoto_url,
      );
      if (!pushVigente) {
        return c.json({
          error: "pr_push_requerido",
          detail: "Primero sube a GitHub el commit aprobado de esta rama.",
        }, 409);
      }
    }
    const cfg = configGit(projectId);
    const remotoDePr = b.pr_url ? urlGithubPermitida(b.pr_url.replace(/\/pull\/\d+.*$/, "")) : null;
    const remotoDestino = diff?.remoto_url ?? remotoDePr ?? cfg.remote ?? null;
    const autenticacion = b.action === "push" || b.action === "pr" || b.action === "merge"
      ? fuenteAutenticacionGithub(projectId, b.action, remotoDestino)
      : {
          tipo: "ninguna" as const,
          origen: "ninguna" as const,
          etiqueta: "No usa credenciales de GitHub",
          cuenta: null,
          instalacion_id: null,
        };
    if ((b.action === "push" || b.action === "pr" || b.action === "merge") && autenticacion.tipo === "ninguna") {
      return c.json({
        error: "credenciales_git_faltantes",
        detail: "Vincula la GitHub App o revisa las credenciales anteriores antes de preparar esta autorización.",
      }, 409);
    }
    const payload = {
      autenticacion,
      autorGit: cfg.author_name,
      messageId,
      hash: diff?.hash ?? null,
      diff: diff?.diff ?? "",
      rama: diff?.rama ?? null,
      commit: diff?.commit ?? null,
      archivos: diff?.archivos.map((a) => a.ruta) ?? [],
      truncado: diff?.truncado ?? false,
      remote: remotoDestino,
      base: cfg.base_branch,
      message: redactar(b.message || (b.action === "merge" ? "Fusionar Pull Request" : "Cambios revisados en Telo")),
      title: redactar(b.title || (b.action === "merge" ? `Fusionar Pull Request #${b.pr_number ?? numeroPrUrlNumerico ?? ""} en ${cfg.base_branch}` : "Cambios revisados en Telo")),
      pr_number: b.pr_number ?? numeroPrUrlNumerico,
      pr_url: b.pr_url ?? null,
      descripcion:
        b.action === "init"
          ? "Inicializar Git y crear un primer commit vacío para habilitar los espacios de trabajo. No añade tus archivos."
          : b.action === "merge"
            ? `Fusionar el Pull Request #${b.pr_number ?? numeroPrUrlNumerico ?? ""} en la rama base (${cfg.base_branch}) directamente desde Telo.`
            : null,
    };
    if (b.action === "pr" || b.action === "merge") {
      const previas = db
        .query<{ id: string; action: string; payload: string; state: string; result: string | null; task_id: string | null }, [string]>(
          b.action === "pr"
            ? "SELECT id,action,payload,state,result,task_id FROM repository_actions WHERE task_id=? AND action='pr' AND state IN ('pending','executing','approved') ORDER BY created_at DESC,rowid DESC"
            : "SELECT id,action,payload,state,result,task_id FROM repository_actions WHERE conversation_id=? AND action='merge' AND state IN ('pending','executing','approved') ORDER BY created_at DESC,rowid DESC",
        )
        .all(b.action === "pr" ? tarea!.id : b.conversationId!);
      const existente = previas.find((anterior) => {
        const previo = JSON.parse(anterior.payload) as typeof payload;
        return b.action === "pr"
          ? previo.commit === payload.commit && previo.rama === payload.rama && previo.base === payload.base && previo.remote === payload.remote
          : previo.pr_number === payload.pr_number && previo.remote === payload.remote;
      });
      if (existente) {
        const payloadExistente = JSON.parse(existente.payload) as typeof payload;
        if (payloadExistente.messageId !== payload.messageId) {
          payloadExistente.messageId = payload.messageId;
          existente.payload = JSON.stringify(payloadExistente);
          db.query("UPDATE repository_actions SET payload=? WHERE id=?").run(existente.payload, existente.id);
        }
        return c.json(
          {
            id: existente.id,
            action: existente.action,
            payload: existente.payload,
            state: existente.state,
            result: existente.result ? JSON.parse(existente.result) : null,
            task_id: existente.task_id,
            message_id: payloadExistente.messageId,
          },
          200,
        );
      }
    }

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
          message_id: payload.messageId,
        },
        200,
      );

    // Marca como superseded cualquier acción previa pendiente de la misma tarea o conversación
    if (tarea?.id || b.conversationId) {
      db.query(
        "UPDATE repository_actions SET state='superseded' WHERE (task_id=? OR (conversation_id=? AND conversation_id IS NOT NULL)) AND state='pending'",
      ).run(tarea?.id ?? "", b.conversationId ?? "");
    }

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
        message_id: payload.messageId,
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
  // Repetir la misma decisión nunca repite la operación Git.
  if ((b.approve && row.state === "approved") || (!b.approve && row.state === "rejected"))
    return c.json({ ok: true });
  if (b.approve && row.state === "executing") return c.json({ ok: true }, 202);
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
          if (head) {
            return {
              mensaje: "El repositorio ya está inicializado y cuenta con commits previos. Está listo para usarse.",
            };
          }
        } else {
          await gitOk(["init", "-b", "main"], { cwd });
        }
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
      if (actual.hash !== p.hash || actual.commit !== p.commit || actual.remoto_url !== p.remote)
        throw new Error(
          "Los cambios o el remoto cambiaron desde que los revisaste. Solicita otra autorización.",
        );
      if (row.action === "push") {
        await validarAutenticacionYAcceso(row.project_id, p, "push");
      }
      const destinoRama = p.rama || undefined;
      result = await aprobarTarea(row.task_id!, {
        accion: row.action === "commit" ? "commit" : "push",
        hash: p.hash,
        mensaje: p.message,
        destinoRama,
        commitEsperado: p.commit,
        autenticacion: row.action === "push" ? p.autenticacion : undefined,
      });
    } else if (row.action === "pr") {
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
      await validarAutenticacionYAcceso(row.project_id, p, "pr");
      result = await githubApiPr(
        row.project_id,
        "/repos/" + remoto.replace("https://github.com/", "") + "/pulls",
        p.autenticacion,
        {
          title: p.title,
          head: p.rama,
          base: p.base,
          body: "Cambios revisados y aprobados en Telo.",
        },
      );
    } else if (row.action === "merge") {
      const cfg = configGit(row.project_id);
      const remoto = urlGithubPermitida(p.remote || cfg.remote || "");
      if (!remoto) throw new Error("Falta un remoto permitido.");
      if (p.remote && p.remote !== remoto)
        throw new Error("La configuración del repositorio cambió. Solicita otra aprobación.");
      await validarAutenticacionYAcceso(row.project_id, p, "merge");
      const pullNumber = p.pr_number ?? (p.pr_url ? /\/pull\/(\d+)(?:[/?#]|$)/i.exec(p.pr_url)?.[1] : null);
      const numeroPull = Number(pullNumber);
      if (!Number.isSafeInteger(numeroPull) || numeroPull < 1)
        throw new Error("No se encontró un número válido del Pull Request para hacer merge.");
      result = await githubApiPr(
        row.project_id,
        "/repos/" + remoto.replace("https://github.com/", "") + `/pulls/${numeroPull}/merge`,
        p.autenticacion,
        {
          commit_title: p.title || `Merge pull request #${numeroPull} desde Telo`,
          merge_method: "squash",
        },
        "PUT",
        "merge",
      );
    } else {
      // Una acción antigua pendiente de antes no se ejecuta.
      throw new Error("Esta acción ya no está disponible. Solicita una autorización nueva.");
    }
    const seguro = JSON.stringify(
      row.action === "pr"
        ? { url: (result as { html_url: string }).html_url, number: (result as { number: number }).number }
        : row.action === "merge"
          ? { merged: (result as { merged?: boolean }).merged ?? true, message: (result as { message?: string }).message ?? "Pull Request fusionado con éxito" }
          : result,
    );
    db.query("UPDATE repository_actions SET state='approved', result=? WHERE id=?").run(
      seguro,
      row.id,
    );
    // Cada acción conserva su propia autorización; completar una solo prepara la siguiente.
    if (row.task_id && (row.action === "commit" || row.action === "push" || row.action === "pr")) {
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
            : row.action === "push"
              ? acciones.includes("pr")
                ? "pr"
                : null
              : row.action === "pr"
                ? "merge"
                : null;
        if (siguiente) {
          const prRes = row.action === "pr" ? (result as { html_url: string; number: number }) : null;
          await repositoryActions.request(`http://telo/projects/${row.project_id}/acciones`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: siguiente,
              conversationId: t.conversation_id,
              taskId: row.task_id,
              messageId: p.messageId ?? undefined,
              pr_number: prRes?.number,
              pr_url: prRes?.html_url,
              title: `Merge pull request #${prRes?.number ?? ""} en ${p.base}`,
            }),
          });
        }
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

async function validarAutenticacionYAcceso(
  projectId: string,
  payload: { autenticacion?: ReturnType<typeof fuenteAutenticacionGithub>; remote?: string },
  accion: "push" | "pr" | "merge",
): Promise<void> {
  const esperada = payload.autenticacion;
  if (!esperada || esperada.tipo === "ninguna") {
    throw new Error("Esta autorización no registró qué credencial usar. Prepara una nueva para revisar el acceso antes de aprobar.");
  }
  const actual = fuenteAutenticacionGithub(projectId, accion, payload.remote);
  if (
    actual.origen !== esperada.origen ||
    actual.cuenta !== esperada.cuenta ||
    actual.instalacion_id !== esperada.instalacion_id
  ) {
    throw new Error("La credencial de GitHub cambió desde que revisaste la autorización. Prepara otra para confirmar qué cuenta hará la acción.");
  }
  if (!payload.remote) throw new Error("Falta el repositorio remoto de esta autorización.");
  await comprobarAccesoGithub(projectId, payload.remote, accion);
}
