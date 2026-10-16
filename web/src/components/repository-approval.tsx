import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type FuenteAutenticacionGithub, type RepositoryAction } from "../api";
import { errorText } from "../lib/model";

// merge y push_main ya no se crean; quedan aquí solo para mostrar el historial de acciones antiguas.
const labels: Record<string, string> = {
  init: "Inicializar repositorio",
  commit: "Crear commit",
  push: "Commit y push",
  push_main: "Commit y push a principal",
  pr: "Crear pull request",
  merge: "Commit y merge local",
};
function resultadoLegible(valor: string): string {
  const sinCommits = valor.match(/No commits between\s+([^\s;]+)\s+and\s+([^\s;]+)/i);
  if (sinCommits) {
    return `GitHub no ve commits nuevos entre ${sinCommits[1]} y ${sinCommits[2]}. Comprueba que la rama de origen se haya subido y que sea la rama que contiene el cambio.`;
  }
  try {
    const r = JSON.parse(valor) as {
      mensaje?: string;
      sha?: string;
      url?: string;
    };
    return (
      r.mensaje ?? r.url ?? (r.sha ? `Commit ${r.sha.slice(0, 8)}` : valor)
    );
  } catch {
    return /^[a-z_]+$/.test(valor)
      ? errorText(new ApiError(409, valor))
      : valor;
  }
}
const estados: Record<string, string> = {
  pending: "Espera tu autorización",
  approved: "Completada",
  rejected: "Rechazada",
  failed: "No se completó",
  executing: "Ejecutando",
  superseded: "Reemplazada",
};
function autenticacionDe(accion: RepositoryAction): FuenteAutenticacionGithub | null {
  try {
    const payload = JSON.parse(accion.payload) as { autenticacion?: FuenteAutenticacionGithub };
    return payload.autenticacion ?? null;
  } catch {
    return null;
  }
}
function etiquetaAutenticacion(accion: RepositoryAction): string | null {
  if (accion.action !== "push" && accion.action !== "pr") return null;
  const autenticacion = autenticacionDe(accion);
  if (!autenticacion) return "Credencial: método no registrado";
  return `Credencial: ${autenticacion.etiqueta}${autenticacion.cuenta ? ` · @${autenticacion.cuenta}` : ""}`;
}
export function RepositoryApproval({
  accion,
  onChange,
  compacta = false,
  projectId,
}: {
  accion: RepositoryAction;
  onChange: (resultado?: unknown, aprobada?: boolean, error?: string) => void;
  compacta?: boolean;
  projectId?: string;
}) {
  const p = JSON.parse(accion.payload) as {
    diff?: string;
    descripcion?: string;
    remote?: string;
    rama?: string;
    base?: string;
    message?: string;
    title?: string;
    archivos?: string[];
    truncado?: boolean;
    autorGit?: string;
    autenticacion?: FuenteAutenticacionGithub;
  };
  const requiereGitHub = accion.action === "push" || accion.action === "pr";
  const credencialObsoleta = requiereGitHub && !p.autenticacion;
  const [confirmarAccesoNoVerificado, setConfirmarAccesoNoVerificado] = useState(false);
  const [avisoAcceso, setAvisoAcceso] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      if (!approve) return api.decideRepositoryAction(accion.id, false);
      if (requiereGitHub) {
        if (!projectId || !p.autenticacion) {
          throw new ApiError(409, "github_access", "Esta autorización no tiene una credencial registrada. Prepara una nueva para comprobar el acceso antes de aprobar.");
        }
        const acceso = await api.checkProjectGit(projectId, accion.action as "push" | "pr");
        const esperada = p.autenticacion;
        if (
          acceso.autenticacion.tipo !== esperada.tipo ||
          acceso.autenticacion.origen !== esperada.origen ||
          acceso.autenticacion.cuenta !== esperada.cuenta ||
          acceso.autenticacion.instalacion_id !== esperada.instalacion_id
        ) {
          throw new ApiError(409, "github_access", "La credencial seleccionada cambió desde que preparaste la autorización. Prepara otra para revisar qué cuenta hará la acción.");
        }
        if (acceso.verificacion === "no_verificada" && !confirmarAccesoNoVerificado) {
          return { requiereConfirmacion: true as const, aviso: acceso.aviso ?? "No se pudo confirmar el permiso de escritura antes de la acción." };
        }
      }
      return api.decideRepositoryAction(accion.id, true);
    },
    onSuccess: (resultado, approve) => {
      if ("requiereConfirmacion" in resultado && resultado.requiereConfirmacion) {
        setConfirmarAccesoNoVerificado(true);
        setAvisoAcceso(resultado.aviso);
        return;
      }
      setAvisoAcceso(null);
      onChange("result" in resultado ? resultado.result : undefined, approve);
    },
    onError: (error) => onChange(undefined, false, errorText(error)),
  });
  const titulo = labels[accion.action] ?? accion.action;
  const subida = accion.action === "push";
  const estado = estados[accion.state] ?? accion.state;
  const cuerpo = (
    <>
      {!compacta && (
        <header className="approval-heading">
          <h2>{titulo}</h2>
          <span className="approval-files" role="status">
            {estado}
          </span>
        </header>
      )}
      {(p.remote || p.rama) && (
        <p className="approval-meta">
          {p.remote && <span>{p.remote}</span>}
          {p.rama && (
            <span>
              Rama: {p.rama}
              {accion.action === "pr" ? ` → ${p.base}` : ""}
            </span>
          )}
        </p>
      )}
      {subida ? (
        <ol className="approval-steps" aria-label="Pasos autorizados">
          <li>Crear commit con los cambios revisados</li>
          <li>Subir a {p.rama ?? "la rama indicada"}</li>
        </ol>
      ) : (
        p.descripcion && <p>{p.descripcion}</p>
      )}
      {accion.action === "commit" && <p>Mensaje: {p.message}</p>}
      {(accion.action === "commit" || subida) && (
        <p className="approval-auth">Commit local · identidad de Git: {p.autorGit ?? "la configurada en el proyecto"}.{subida ? " La subida usa la credencial indicada abajo." : " GitHub no participa en este paso."}</p>
      )}
      {accion.action === "pr" && <p>Título: {p.title}</p>}
      {requiereGitHub && p.autenticacion && (
        <div className={`approval-auth${p.autenticacion.tipo === "credencial_anterior" ? " approval-auth-warning" : ""}`} role={p.autenticacion.tipo === "credencial_anterior" ? "alert" : "status"}>
          <strong>Credencial para esta acción: {p.autenticacion.etiqueta}</strong>
          {p.autenticacion.cuenta && <span>Cuenta: @{p.autenticacion.cuenta}</span>}
          {p.autenticacion.tipo === "credencial_anterior" && (
            <span>Esta acción usará la credencial anterior indicada. Confirma que reconoces esta cuenta antes de autorizar.</span>
          )}
        </div>
      )}
      {credencialObsoleta && accion.state === "pending" && (
        <p className="approval-auth approval-auth-warning" role="alert">
          Esta autorización es antigua y no indica qué credencial usar. Prepara una nueva para comprobar el acceso y mostrar la cuenta antes de aprobar.
        </p>
      )}
      {credencialObsoleta && accion.state !== "pending" && requiereGitHub && (
        <p className="approval-auth approval-auth-warning" role="status">
          Esta acción anterior no guardó el método de autenticación; Telo no puede confirmar qué credencial usó.
        </p>
      )}
      {p.diff && (
        <details className="approval-changes">
          <summary>Ver cambios · {p.archivos?.length ?? 0} archivos</summary>
          {p.truncado && (
            <p className="hint">
              Vista recortada. La autorización cubre todos los archivos
              enumerados.
            </p>
          )}
          {p.archivos && (
            <p className="approval-files">{p.archivos.join(", ")}</p>
          )}
          <pre className="approval-diff">{p.diff}</pre>
        </details>
      )}
      {accion.state === "pending" && (
        <div className="approval-buttons">
          <button
            type="button"
            className="primary"
            disabled={decide.isPending || credencialObsoleta}
            onClick={() => decide.mutate(true)}
          >
            {decide.isPending
              ? requiereGitHub ? "Comprobando acceso…" : "Ejecutando…"
              : subida
                ? "Autorizar commit y push"
                : confirmarAccesoNoVerificado
                  ? "Confirmar y autorizar"
                  : `Autorizar ${titulo.toLowerCase()}`}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={decide.isPending}
            onClick={() => decide.mutate(false)}
          >
            Rechazar
          </button>
        </div>
      )}
      {accion.result && (
        <p className="approval-files">{resultadoLegible(accion.result)}</p>
      )}
      {decide.isError && accion.state === "pending" && !(decide.error instanceof ApiError && decide.error.code === "action_already_decided") && (
        <p className="error" role="alert">
          {errorText(decide.error)}
        </p>
      )}
      {avisoAcceso && <p className="approval-auth approval-auth-warning" role="alert">{avisoAcceso}</p>}
    </>
  );
  return compacta ? (
    <details className="approval-history-row">
      <summary>
        <span>{titulo}</span>
        <span className="approval-files">{estado}</span>
      </summary>
      <div className="approval-history-body">{cuerpo}</div>
    </details>
  ) : (
    <section className="panel approval-panel" aria-label={titulo}>
      {cuerpo}
    </section>
  );
}

export function AccionesAnteriores({ acciones }: { acciones: RepositoryAction[] }) {
  return (
    <details className="tl-git-intentos">
      <summary>{acciones.length === 1 ? "Ver 1 intento anterior" : `Ver ${acciones.length} intentos anteriores`}</summary>
      <ul>
        {acciones.map((accion) => (
          <li key={accion.id}>
            <span>
              {labels[accion.action] ?? accion.action} · {estados[accion.state] ?? accion.state}
              {etiquetaAutenticacion(accion) && <small className="approval-history-auth">{etiquetaAutenticacion(accion)}</small>}
            </span>
            {accion.result && <span>{resultadoLegible(accion.result)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AccionRepositorioMensaje({ accion, conversationId, projectId, taskId }: {
  accion: RepositoryAction;
  conversationId: string;
  projectId: string;
  taskId?: string;
}) {
  const qc = useQueryClient();
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["repository-actions", conversationId] });
    void qc.invalidateQueries({ queryKey: ["task-diff", accion.task_id] });
  };
  const pedir = useMutation({
    mutationFn: () => api.requestRepositoryAction(projectId, {
      action: accion.action, conversationId, taskId: accion.task_id!,
      messageId: accion.message_id ?? undefined,
    }),
    onSettled: refrescar,
  });
  const payload = JSON.parse(accion.payload) as { autenticacion?: FuenteAutenticacionGithub };
  const actualizarAutorizacion = (accion.state === "failed" || accion.state === "pending") &&
    (accion.action === "push" || accion.action === "pr") && !payload.autenticacion;
  return (
    <article className="tl-msg tl-msg-agente tl-msg-git" aria-label="Acción de Git">
      <RepositoryApproval accion={accion} projectId={projectId} onChange={refrescar} />
      {actualizarAutorizacion && accion.task_id === taskId && (
        <button type="button" className="ghost" disabled={pedir.isPending} onClick={() => pedir.mutate()}>
          {pedir.isPending ? "Comprobando…" : "Preparar autorización nueva"}
        </button>
      )}
      {pedir.isError && <p className="error" role="alert">{errorText(pedir.error)}</p>}
    </article>
  );
}

export function AccionesRepositorioChat({
  conversationId,
  projectId,
  taskId,
  terminada,
}: {
  conversationId: string;
  projectId: string | null;
  taskId?: string;
  terminada: boolean;
}) {
  const qc = useQueryClient();
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [verCambios, setVerCambios] = useState(false);
  const acciones = useQuery({
    queryKey: ["repository-actions", conversationId],
    queryFn: () => api.repositoryActions(conversationId),
    refetchInterval: 3000,
  });
  const diffQuery = useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.taskDiff(taskId!),
    enabled: Boolean(taskId && terminada),
    refetchInterval: 4000,
    retry: false,
  });
  const refrescar = () => {
    void qc.invalidateQueries({
      queryKey: ["repository-actions", conversationId],
    });
    void qc.invalidateQueries({ queryKey: ["task-diff", taskId] });
  };
  const pedir = useMutation({
    mutationFn: (action: string) =>
      api.requestRepositoryAction(projectId!, {
        action,
        conversationId,
        taskId,
      }),
    onSuccess: refrescar,
  });
  const lista = acciones.data ?? [];
  const pendiente = lista.find(
    (a) => a.state === "pending" || a.state === "executing",
  );
  const accionesDeTarea = taskId
    ? [...new Map(lista.filter((accion) => accion.task_id === taskId).map((accion) => [accion.action, accion])).values()]
    : [];
  const diff = diffQuery.data?.estado === "en_curso" ? undefined : diffQuery.data;
  const archivos = diff?.archivos ?? [];
  const adiciones = archivos.reduce((total, archivo) => total + archivo.adiciones, 0);
  const eliminaciones = archivos.reduce((total, archivo) => total + archivo.eliminaciones, 0);
  const commitVigente = Boolean(
    diff?.aprobaciones.commit?.estado === "aprobada" &&
    diff.aprobaciones.commit.hash === diff.hash &&
    diff.aprobaciones.commit.sha === diff.commit,
  );
  const pushVigente = Boolean(
    commitVigente && diff?.aprobaciones.push?.sha === diff?.commit,
  );
  const ramaSubida = diff?.aprobaciones.push?.rama ?? diff?.rama;
  const prCreado = lista.find(
    (a) =>
      a.action === "pr" &&
      a.state === "approved" &&
      JSON.parse(a.payload).commit === diff?.commit,
  );
  const prUrl = prCreado?.result
    ? (JSON.parse(prCreado.result) as { url?: string }).url
    : null;
  const prSinCommits = lista.some((accion) => {
    if (
      accion.task_id !== taskId ||
      accion.action !== "pr" ||
      accion.state !== "failed" ||
      !diff?.commit ||
      !/no commits between/i.test(accion.result ?? "")
    ) return false;
    try {
      return (JSON.parse(accion.payload) as { commit?: string }).commit === diff.commit;
    } catch {
      return false;
    }
  });
  const puedeCrearPr = pushVigente && ramaSubida === diff?.rama && !prCreado && !prSinCommits;
  const tieneCambios = Boolean(diff?.archivos.length);
  const ocupado = Boolean(pendiente) || pedir.isPending || diffQuery.isPending;
  return (
    <>
      {terminada && diff && tieneCambios && (
        <section className="tl-resumen-cambios" aria-label="Cambios realizados por la tarea">
          <header className="tl-resumen-cambios-cabecera">
            <span className="tl-resumen-cambios-icono" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M8 15h8M12 11v8" />
              </svg>
            </span>
            <span className="tl-resumen-cambios-totales">
              <strong>{archivos.length} {archivos.length === 1 ? "archivo modificado" : "archivos modificados"}</strong>
              <span><b className="tl-cambio-adicion">+{adiciones}</b><b className="tl-cambio-eliminacion">−{eliminaciones}</b></span>
            </span>
            <button
              type="button"
              className="tl-resumen-cambios-ver"
              aria-expanded={verCambios}
              aria-controls={`tl-resumen-diff-${taskId}`}
              onClick={() => setVerCambios((visible) => !visible)}
            >
              {verCambios ? "Ocultar cambios" : "Ver cambios"}
            </button>
          </header>
          <ul className="tl-resumen-cambios-archivos">
            {(mostrarTodos ? archivos : archivos.slice(0, 3)).map((archivo) => (
              <li key={archivo.ruta}>
                <span className="tl-resumen-cambios-ruta" title={archivo.ruta}>{archivo.ruta}</span>
                <span className="tl-resumen-cambios-lineas">
                  <b className="tl-cambio-adicion">+{archivo.adiciones}</b>
                  <b className="tl-cambio-eliminacion">−{archivo.eliminaciones}</b>
                </span>
              </li>
            ))}
          </ul>
          {archivos.length > 3 && (
            <button
              type="button"
              className="tl-resumen-cambios-mas"
              aria-expanded={mostrarTodos}
              onClick={() => setMostrarTodos((mostrar) => !mostrar)}
            >
              {mostrarTodos ? "Mostrar menos" : `Mostrar ${archivos.length - 3} archivos más`}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          {verCambios && (
            <div className="tl-resumen-diff" id={`tl-resumen-diff-${taskId}`}>
              {diff.truncado && <p className="tl-resumen-diff-vacio">El diff está recortado; la lista de archivos sí está completa.</p>}
              {diff.diff ? (
                <pre className="approval-diff">{diff.diff}</pre>
              ) : (
                <p className="tl-resumen-diff-vacio">No hay un diff de texto disponible para estos archivos.</p>
              )}
            </div>
          )}
        </section>
      )}
      {projectId && taskId && accionesDeTarea.map((accion) => (
        <AccionRepositorioMensaje
          key={accion.id}
          accion={accion}
          conversationId={conversationId}
          projectId={projectId}
          taskId={taskId}
        />
      ))}
      {projectId && terminada && taskId && diff && !pendiente && (
        <div className="approval-buttons" aria-label="Acciones del repositorio">
          {tieneCambios && !pushVigente && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => pedir.mutate(diff.remoto ? "push" : "commit")}
            >
              {pedir.isPending
                ? "Preparando…"
                : diff.remoto
                  ? "Commit y subir rama para PR"
                  : "Crear commit"}
            </button>
          )}
          {puedeCrearPr && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => pedir.mutate("pr")}
            >
              Crear PR desde {ramaSubida}
            </button>
          )}
          {prSinCommits && (
            <p className="approval-auth approval-auth-warning" role="alert">
              GitHub no ve commits nuevos en {ramaSubida}. Revisa la tarea que contiene el commit; no prepares otra autorización desde esta rama.
            </p>
          )}
          {prUrl && /^https:\/\/github\.com\//.test(prUrl) && (
            <a href={prUrl} target="_blank" rel="noreferrer">
              Ver pull request
            </a>
          )}
          {pushVigente && ramaSubida !== diff?.rama && (
            <span className="approval-files" role="status">
              Cambios subidos a {ramaSubida}.
            </span>
          )}
        </div>
      )}
      {(pedir.isError || diffQuery.isError) && (
        <p role="alert" className="error">
          {errorText(pedir.error ?? diffQuery.error)}
        </p>
      )}
    </>
  );
}
