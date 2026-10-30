import { Hono } from "hono";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import { projectRepoPath, leerCuerpoJson } from "./projects";
import {
  aprobarTarea,
  diffDeTarea,
  ErrorTarea,
  detectarConflictosPullRequest,
  mensajeSeguro,
  urlGithubPermitida,
} from "../workspace";
import { crearTarea } from "../tareas";
import { conProyectoRevisado } from "../ocupacion";
import { gitOk, gitOkSeguro, prepararRepoSeguro, tieneGitReal } from "../git";
import {
  comprobarAccesoGithub,
  configGit,
  fuenteAutenticacionGithub,
  githubApiPr,
} from "./proyecto-config";
import { redactar } from "../redaccion";

function mensajeCommitConvencional(titulo: string, prompt: string): string {
  const generico = /^(cambios revisados en telo|cambios de la tarea|commit)$/i;
  const texto = [titulo, prompt].find((valor) => valor.trim() && !generico.test(valor.trim()))?.trim() || "actualiza cambios del proyecto";
  const primeraLinea = texto.split(/[\r\n]/, 1)[0]!.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  const yaTipado = /^(feat|fix|docs|test|refactor|perf|chore|build|ci|style|revert)(\([^)]+\))?:\s*.+$/i.test(primeraLinea);
  if (yaTipado) return primeraLinea.slice(0, 120);
  const tipo = /\b(corrige|corregir|arregla|arreglar|bug|error|fallo|fix|conflicto|inconsistencia)\b/i.test(`${titulo} ${prompt}`)
    ? "fix"
    : /\b(documenta|documentación|docs?)\b/i.test(`${titulo} ${prompt}`)
      ? "docs"
      : /\b(prueba|test|specs?)\b/i.test(`${titulo} ${prompt}`)
        ? "test"
        : /\b(refactor|limpia|limpieza|simplifica)\b/i.test(`${titulo} ${prompt}`)
          ? "refactor"
          : /\b(performance|rendimiento|optimiza|optimización)\b/i.test(`${titulo} ${prompt}`)
            ? "perf"
            : /\b(agrega|añade|crea|implemente|implementa|incorpora|nueva función|nuevo)\b/i.test(`${titulo} ${prompt}`)
              ? "feat"
              : "chore";
  const subject = primeraLinea.charAt(0).toLocaleLowerCase("es") + primeraLinea.slice(1);
  return `${tipo}: ${subject}`.slice(0, 120);
}

type DiagnosticoConflictos = {
  codigo: "merge_conflicts";
  mensaje: string;
  pr_number: number;
  pr_url: string;
  rama_fuente: string;
  rama_base: string;
  repo_fuente: string | null;
  repo_base: string;
  archivos: string[];
  archivos_exactos: boolean;
  task_id: string | null;
  resoluble: boolean;
};

export const repositoryActions = new Hono();
repositoryActions.get("/conversations/:id/acciones", (c) =>
  c.json(
    db
      .query(
        `SELECT a.id,a.action,a.payload,a.state,a.result,a.task_id,
          CASE WHEN json_type(a.payload,'$.messageId') IS NOT NULL THEN json_extract(a.payload,'$.messageId') ELSE
            (SELECT m.id FROM messages m WHERE m.conversation_id=a.conversation_id
             AND m.role='user' AND m.created_at<=a.created_at
             ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) END AS message_id
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
    messageId?: string | null;
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
  if (b.messageId !== undefined && b.messageId !== null && (typeof b.messageId !== "string" || !b.conversationId ||
    !db.query("SELECT 1 FROM messages WHERE id=? AND conversation_id=? AND role='user'").get(b.messageId, b.conversationId)))
    return c.json({ error: "invalid_body" }, 400);
  const tarea = b.taskId
    ? db
        .query<
          { id: string; status: string; conversation_id: string | null; title: string; prompt: string; model: string; effort: string | null; source_branch: string | null; source_base_branch: string | null; source_pr_number: number | null },
          [string, string]
        >("SELECT id,status,conversation_id,title,prompt,model,effort,source_branch,source_base_branch,source_pr_number FROM tasks WHERE id=? AND project_id=?")
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
    const messageId = b.messageId !== undefined ? b.messageId : (b.conversationId
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
    let shaRevision: string | null = null;
    if (b.action === "merge") {
      shaRevision = tarea ? db.query<{ commit_sha: string }, [string]>(
        "SELECT commit_sha FROM task_approvals WHERE task_id=? AND accion='push' AND commit_sha IS NOT NULL ORDER BY rowid DESC LIMIT 1",
      ).get(tarea.id)?.commit_sha ?? null : null;
      if (!shaRevision) {
        const remoto = remotoDestino ? urlGithubPermitida(remotoDestino) : null;
        if (!remoto) throw new Error("Falta un remoto permitido.");
        const pull = await githubApiPr(projectId,
          "/repos/" + remoto.replace("https://github.com/", "") + `/pulls/${b.pr_number ?? numeroPrUrlNumerico}`,
          autenticacion, undefined, undefined, "merge") as { head?: { sha?: string } };
        shaRevision = pull.head?.sha ?? null;
      }
      if (!shaRevision || !/^[a-f0-9]{40,64}$/i.test(shaRevision))
        throw new Error("No se pudo identificar el commit del Pull Request. Vuelve a preparar la autorización.");
    }
    const payload = {
      autenticacion,
      autorGit: cfg.author_name,
      messageId,
      hash: diff?.hash ?? null,
      diff: diff?.diff ?? "",
      rama: diff?.rama ?? null,
      commit: diff?.commit ?? null,
      sha_revision: shaRevision,
      archivos: diff?.archivos.map((a) => a.ruta) ?? [],
      truncado: diff?.truncado ?? false,
      remote: remotoDestino,
      base: cfg.base_branch,
      message: redactar(b.message || (b.action === "merge" ? "Fusionar Pull Request" : tarea ? mensajeCommitConvencional(tarea.title, tarea.prompt) : "chore: actualiza cambios del proyecto")),
      title: redactar(b.title || (b.action === "merge" ? `Fusionar Pull Request #${b.pr_number ?? numeroPrUrlNumerico ?? ""} en ${cfg.base_branch}` : "Cambios revisados en Telo")),
      pr_number: b.pr_number ?? numeroPrUrlNumerico,
      pr_url: b.pr_url ?? (tarea?.source_pr_number && remotoDestino ? `${remotoDestino}/pull/${tarea.source_pr_number}` : null),
      source_pr_number: tarea?.source_pr_number ?? null,
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
          : previo.pr_number === payload.pr_number && previo.remote === payload.remote && previo.sha_revision === payload.sha_revision;
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
  const b = await leerCuerpoJson<{ approve: boolean; destino?: string }>(c);
  if (!b || typeof b.approve !== "boolean") return c.json({ error: "invalid_body" }, 400);
  // Destino de una subida: "base" empuja directo a la rama base del proyecto; "rama" sube la rama
  // de la tarea y prepara el PR. Si no viene, se conserva el comportamiento anterior.
  if (b.destino !== undefined && b.destino !== "base" && b.destino !== "rama")
    return c.json({ error: "invalid_destino" }, 400);
  const destinoEmpuje = b.destino === "base" || b.destino === "rama" ? b.destino : null;
  const row = db
    .query<
      {
        id: string;
        project_id: string;
        task_id: string | null;
        action: string;
        payload: string;
        state: string;
        result: string | null;
        conversation_id: string | null;
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
      let destinoRama = p.rama || undefined;
      if (row.action === "push" && destinoEmpuje === "base") {
        // El destino permitido sale de lo revisado (payload.base); si la configuración cambió
        // desde la preparación, se exige una autorización nueva.
        const base = configGit(row.project_id).base_branch;
        if (p.base && p.base !== base)
          throw new Error("La configuración del repositorio cambió. Solicita otra autorización.");
        destinoRama = base;
      }
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
      if (typeof p.sha_revision !== "string" || !/^[a-f0-9]{40,64}$/i.test(p.sha_revision))
        throw new ErrorTarea("pr_revision_requerida", 409, "Esta autorización no identifica el commit revisado. Solicita una autorización nueva.");
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
      const rutaPull = "/repos/" + remoto.replace("https://github.com/", "") + `/pulls/${numeroPull}`;
      const pull = await githubApiPr(
        row.project_id,
        rutaPull,
        p.autenticacion,
        undefined,
        undefined,
        "merge",
      ) as {
        html_url?: string;
        mergeable?: boolean | null;
        mergeable_state?: string;
        head?: { ref?: string; sha?: string; repo?: { full_name?: string | null } | null };
        base?: { ref?: string; repo?: { full_name?: string | null } | null };
      };
      // El merge queda ligado al SHA revisado: la punta del PR debe seguir siendo el commit
      // cuya subida se aprobó para la tarea. Un push posterior (o un amend) invalida la
      // autorización y exige revisión nueva, y el PUT lo declara con el campo sha.
      const puntaAprobada = p.sha_revision;
      if (pull.head?.sha !== puntaAprobada)
        throw new ErrorTarea(
          "pr_cambiado",
          409,
          "La punta del Pull Request cambió desde que la aprobaste. Solicita la autorización otra vez.",
        );
      if (pull.mergeable === false && pull.mergeable_state === "dirty") {
        const ramaFuente = pull.head?.ref ?? "";
        const ramaBase = pull.base?.ref ?? p.base ?? cfg.base_branch;
        const repoBase = pull.base?.repo?.full_name ?? remoto.replace("https://github.com/", "");
        const repoFuente = pull.head?.repo?.full_name ?? null;
        const fuente = row.task_id
          ? db.query<{ id: string }, [string, string]>("SELECT id FROM tasks WHERE id=? AND project_id=?").get(row.task_id, row.project_id)
          : db.query<{ id: string }, [string, string]>("SELECT id FROM tasks WHERE project_id=? AND rama=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(row.project_id, ramaFuente);
        let archivos: string[] = [];
        let archivosExactos = false;
        if (fuente?.id && ramaFuente && ramaBase) {
          try {
            archivos = await detectarConflictosPullRequest(fuente.id, remoto, ramaBase, ramaFuente);
            archivosExactos = archivos.length > 0;
          } catch {
            // El listado de archivos del PR sirve como guía si el clon local ya no está disponible.
          }
        }
        if (!archivos.length) {
          const modificados = await githubApiPr(
            row.project_id,
            `${rutaPull}/files?per_page=100`,
            p.autenticacion,
            undefined,
            undefined,
            "merge",
          ) as { filename?: string }[];
          archivos = Array.isArray(modificados)
            ? modificados.map((archivo) => archivo.filename).filter((ruta): ruta is string => typeof ruta === "string").slice(0, 30)
            : [];
        }
        const resoluble = Boolean(
          fuente?.id && row.conversation_id && ramaFuente &&
          ramaFuente !== ramaBase &&
          repoFuente && repoFuente.toLowerCase() === repoBase.toLowerCase(),
        );
        const diagnostico: DiagnosticoConflictos = {
          codigo: "merge_conflicts",
          mensaje: `GitHub detectó conflictos entre ${ramaFuente} y ${ramaBase}.`,
          pr_number: numeroPull,
          pr_url: pull.html_url ?? p.pr_url ?? `${remoto}/pull/${numeroPull}`,
          rama_fuente: ramaFuente,
          rama_base: ramaBase,
          repo_fuente: repoFuente,
          repo_base: repoBase,
          archivos,
          archivos_exactos: archivosExactos,
          task_id: fuente?.id ?? null,
          resoluble,
        };
        throw new ErrorTarea("merge_conflicts", 409, JSON.stringify(diagnostico));
      }
      result = await githubApiPr(
        row.project_id,
        "/repos/" + remoto.replace("https://github.com/", "") + `/pulls/${numeroPull}/merge`,
        p.autenticacion,
        {
          commit_title: p.title || `Merge pull request #${numeroPull} desde Telo`,
          merge_method: "squash",
          sha: puntaAprobada,
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
          { plan: string | null; conversation_id: string | null; status: string; source_pr_number: number | null },
          [string]
        >("SELECT plan,conversation_id,status,source_pr_number FROM tasks WHERE id=?")
        .get(row.task_id);
      // Sin plan guardado, la cadena solo continúa si el usuario eligió "rama y PR" en la subida.
      const puedeCadena = t?.plan || (row.action === "push" && destinoEmpuje === "rama");
      if (t && t.conversation_id && t.status === "done" && puedeCadena) {
        const acciones = t.plan ? JSON.parse(t.plan).requiere_aprobacion as string[] : [];
        const siguiente =
          row.action === "commit"
            ? acciones.includes("push")
              ? "push"
              : null
            : row.action === "push"
              ? destinoEmpuje === "base" || t.source_pr_number !== null
                ? null
                : acciones.includes("pr") || destinoEmpuje === "rama"
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
              messageId: p.messageId ?? null,
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
    // La tarjeta lee ese campo: un ErrorTarea trae su propia explicación en `detail`, así que se
    // guarda con ella (la web prefiere `mensaje` cuando el resultado es objeto JSON).
    const detalle =
      e instanceof ErrorTarea && e.detail
        ? JSON.stringify({ codigo: e.code, mensaje: e.detail })
        : mensajeSeguro(e);
    db.query("UPDATE repository_actions SET state='failed',result=? WHERE id=?").run(
      detalle,
      row.id,
    );
    // Un rechazo remoto del push ya quedó guardado como acción fallida. Es un
    // resultado de negocio, no un fallo del endpoint ni un Bad Gateway.
    return e instanceof ErrorTarea
      ? e.code === "push_fallido"
        ? c.json({ ok: false, state: "failed", error: e.code, detail: e.detail })
        : c.json({ error: e.code, detail: e.detail }, e.status)
      : c.json({ error: "git_action", detail: detalle }, 409);
  }
});

repositoryActions.post("/acciones/:id/resolver-conflictos", async (c) => {
  const accion = db.query<{
    id: string;
    project_id: string;
    conversation_id: string | null;
    task_id: string | null;
    action: string;
    payload: string;
    state: string;
    result: string | null;
  }, [string]>("SELECT * FROM repository_actions WHERE id=?").get(c.req.param("id"));
  if (!accion) return c.json({ error: "action_not_found" }, 404);
  if (accion.action !== "merge" || accion.state !== "failed" || !accion.result)
    return c.json({ error: "conflict_resolution_unavailable" }, 409);
  let diagnostico: DiagnosticoConflictos | null = null;
  try {
    const externo = JSON.parse(accion.result) as { codigo?: string; mensaje?: string };
    if (externo.codigo !== "merge_conflicts" || !externo.mensaje) return c.json({ error: "conflict_resolution_unavailable" }, 409);
    diagnostico = JSON.parse(externo.mensaje) as DiagnosticoConflictos;
  } catch {
    return c.json({ error: "conflict_resolution_unavailable" }, 409);
  }
  if (!diagnostico.resoluble || !diagnostico.task_id || !accion.conversation_id)
    return c.json({ error: "conflict_resolution_unavailable", detail: "Esta rama del PR no pertenece al mismo repositorio o ya no hay una tarea de Telo para prepararla." }, 409);
  const payload = JSON.parse(accion.payload) as Record<string, unknown>;
  const repairTaskId = typeof payload.repair_task_id === "string" ? payload.repair_task_id : null;
  const repairTask = repairTaskId
    ? db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id=?").get(repairTaskId)
    : null;
  if (repairTask && !["failed", "cancelled"].includes(repairTask.status))
    return c.json({ task_id: repairTaskId!, reutilizada: true }, 200);
  const origen = db.query<{ id: string; title: string; model: string; effort: string | null }, [string, string]>(
    "SELECT id,title,model,effort FROM tasks WHERE id=? AND project_id=?",
  ).get(diagnostico.task_id, accion.project_id);
  const conversacion = db.query<{ model: string | null }, [string, string]>("SELECT model FROM conversations WHERE id=? AND project_id=?").get(accion.conversation_id, accion.project_id);
  if (!origen || !conversacion) return c.json({ error: "conflict_resolution_unavailable" }, 409);
  const archivos = diagnostico.archivos.length
    ? diagnostico.archivos.map((archivo) => `- ${archivo}`).join("\n")
    : "- Inspecciona los archivos con conflictos en la fusión local";
  const claseLista = diagnostico.archivos_exactos ? "conflictos confirmados" : "archivos modificados por el PR; confirma cuáles tienen conflicto";
  const prompt = [
    `Resuelve los conflictos de integración del Pull Request #${diagnostico.pr_number}.`,
    `El workspace ya está preparado sobre la rama fuente ${diagnostico.rama_fuente} e intenta integrar la rama base ${diagnostico.rama_base}.`,
    `Archivos (${claseLista}):\n${archivos}`,
    "Conserva el comportamiento de ambas ramas, resuelve todos los marcadores de conflicto, revisa el diff completo y ejecuta las pruebas pertinentes.",
    "No hagas commit ni push: Telo pedirá aprobación después de mostrar los cambios.",
  ].join("\n\n");
  const repairMessageId = typeof payload.messageId === "string"
    ? db.query<{ id: string }, [string, string]>("SELECT id FROM messages WHERE id=? AND conversation_id=? AND role='user'")
      .get(payload.messageId, accion.conversation_id)?.id ?? null
    : null;
  const actividadHasta = repairMessageId
    ? db.query<{ seq: number }, [string, string]>(
        "SELECT COALESCE(MAX(seq),0) AS seq FROM chat_actividad WHERE conversation_id=? AND turno_id=?",
      ).get(accion.conversation_id, repairMessageId)?.seq ?? 0
    : 0;
  const taskId = crearTarea({
    prompt,
    model: origen.model || conversacion.model || "",
    effort: origen.effort,
    projectId: accion.project_id,
    titulo: `Resolver conflictos PR #${diagnostico.pr_number}`,
    conversationId: accion.conversation_id,
    messageId: repairMessageId,
    sourceBranch: diagnostico.rama_fuente,
    sourceBaseBranch: diagnostico.rama_base,
    sourcePrNumber: diagnostico.pr_number,
  });
  payload.repair_task_id = taskId;
  payload.repair_message_id = repairMessageId;
  payload.repair_activity_from_seq = actividadHasta;
  db.query("UPDATE repository_actions SET payload=? WHERE id=?").run(JSON.stringify(payload), accion.id);
  return c.json({ task_id: taskId, reutilizada: false }, 202);
});

repositoryActions.post("/acciones/:id/verificar-conflictos", async (c) => {
  const accion = db.query<{
    id: string;
    project_id: string;
    conversation_id: string | null;
    action: string;
    payload: string;
    state: string;
    result: string | null;
  }, [string]>("SELECT * FROM repository_actions WHERE id=?").get(c.req.param("id"));
  if (!accion) return c.json({ error: "action_not_found" }, 404);
  if (accion.action !== "merge" || accion.state !== "failed" || !accion.result || !accion.conversation_id)
    return c.json({ error: "conflict_resolution_unavailable" }, 409);

  let diagnostico: DiagnosticoConflictos;
  let payload: { repair_task_id?: string; remote?: string; autenticacion?: ReturnType<typeof fuenteAutenticacionGithub> };
  try {
    const error = JSON.parse(accion.result) as { codigo?: string; mensaje?: string };
    if (error.codigo !== "merge_conflicts" || !error.mensaje) return c.json({ error: "conflict_resolution_unavailable" }, 409);
    diagnostico = JSON.parse(error.mensaje) as DiagnosticoConflictos;
    payload = JSON.parse(accion.payload);
  } catch {
    return c.json({ error: "conflict_resolution_unavailable" }, 409);
  }
  const repairTaskId = payload.repair_task_id;
  if (!repairTaskId || !diagnostico.resoluble)
    return c.json({ error: "conflict_resolution_unavailable" }, 409);
  const tarea = db.query<{
    status: string;
    conversation_id: string | null;
    source_branch: string | null;
    source_base_branch: string | null;
    source_pr_number: number | null;
  }, [string, string]>(
    "SELECT status,conversation_id,source_branch,source_base_branch,source_pr_number FROM tasks WHERE id=? AND project_id=?",
  ).get(repairTaskId, accion.project_id);
  if (!tarea || tarea.conversation_id !== accion.conversation_id ||
      tarea.source_branch !== diagnostico.rama_fuente || tarea.source_base_branch !== diagnostico.rama_base ||
      tarea.source_pr_number !== diagnostico.pr_number)
    return c.json({ verificado: false, estado: "tarea_no_coincide", mensaje: "La tarea ya no coincide con la rama y el Pull Request diagnosticados. Vuelve a revisar la tarea." });
  if (tarea.status !== "done")
    return c.json({ verificado: false, estado: tarea.status, mensaje: `La tarea de resolución está ${tarea.status === "failed" ? "fallida" : tarea.status === "cancelled" ? "cancelada" : "en curso"}.` });

  const pushAccion = db.query<{ payload: string }, [string]>(
    "SELECT payload FROM repository_actions WHERE task_id=? AND action='push' AND state='approved' ORDER BY created_at DESC,rowid DESC LIMIT 1",
  ).get(repairTaskId);
  if (!pushAccion)
    return c.json({ verificado: false, estado: "push_pendiente", mensaje: "La resolución terminó. Revisa y aprueba el commit y la subida al mismo PR antes de verificar GitHub." });

  try {
    const diff = await diffDeTarea(repairTaskId);
    if (diff.estado !== "con_cambios" || !diff.commit || !diff.hash ||
        diff.rama !== diagnostico.rama_fuente || diff.remoto_url !== payload.remote ||
        diff.aprobaciones.commit?.estado !== "aprobada" || diff.aprobaciones.commit.sha !== diff.commit ||
        diff.aprobaciones.commit.hash !== diff.hash || !diff.aprobaciones.push ||
        diff.aprobaciones.push.sha !== diff.commit || diff.aprobaciones.push.rama !== diagnostico.rama_fuente ||
        diff.aprobaciones.push.remoto !== diff.remoto_url)
      return c.json({ verificado: false, estado: "cambios_no_subidos", mensaje: "El commit o la subida aprobados ya no coinciden con el diff actual. Revisa los cambios y vuelve a autorizarlos." });

    const datosPush = JSON.parse(pushAccion.payload) as { source_pr_number?: number; rama?: string; remote?: string };
    if (datosPush.source_pr_number !== diagnostico.pr_number || datosPush.rama !== diagnostico.rama_fuente || datosPush.remote !== payload.remote)
      return c.json({ verificado: false, estado: "push_no_coincide", mensaje: "La subida aprobada no apunta a la rama del Pull Request diagnosticado." });

    await validarAutenticacionYAcceso(accion.project_id, payload, "merge");
    const remoto = urlGithubPermitida(payload.remote ?? "");
    if (!remoto) return c.json({ verificado: false, estado: "remoto_invalido", mensaje: "El remoto guardado ya no es válido para GitHub." });
    const numero = diagnostico.pr_number;
    const ruta = "/repos/" + remoto.replace("https://github.com/", "") + `/pulls/${numero}`;
    const pull = await githubApiPr(accion.project_id, ruta, payload.autenticacion!, undefined, undefined, "merge") as {
      state?: string;
      draft?: boolean;
      html_url?: string;
      mergeable?: boolean | null;
      mergeable_state?: string;
      head?: { ref?: string; sha?: string; repo?: { full_name?: string | null } | null };
      base?: { ref?: string; repo?: { full_name?: string | null } | null };
    };
    if (pull.state !== "open" || pull.draft || pull.head?.ref !== diagnostico.rama_fuente ||
        pull.base?.ref !== diagnostico.rama_base || pull.head?.sha !== diff.commit ||
        pull.head?.repo?.full_name?.toLowerCase() !== diagnostico.repo_fuente?.toLowerCase() ||
        pull.base?.repo?.full_name?.toLowerCase() !== diagnostico.repo_base.toLowerCase())
      return c.json({ verificado: false, estado: "pr_cambio", mensaje: "El PR ya no está abierto o su rama, base o commit cambiaron. Actualiza el diagnóstico antes de continuar." });
    if (pull.mergeable === null || pull.mergeable_state === "unknown")
      return c.json({ verificado: false, estado: "github_calculando", mensaje: "GitHub todavía está calculando si el PR se puede fusionar. Intenta verificarlo de nuevo en unos segundos." });
    if (pull.mergeable !== true || pull.mergeable_state !== "clean")
      return c.json({ verificado: false, estado: pull.mergeable_state ?? "no_integrable", mensaje: `GitHub aún no confirma que el PR esté listo para fusionarse (${pull.mergeable_state ?? "estado desconocido"}).` });
    return c.json({
      verificado: true,
      estado: "listo",
      mensaje: `GitHub confirmó que el PR #${numero} está limpio y que su commit coincide con ${diff.commit.slice(0, 8)}.`,
      pr_url: pull.html_url ?? diagnostico.pr_url,
      pr_number: numero,
    });
  } catch (error) {
    return c.json({ verificado: false, estado: "error_verificacion", mensaje: mensajeSeguro(error) }, 409);
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
