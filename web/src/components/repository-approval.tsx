import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type RepositoryAction } from "../api";
import { errorText } from "../lib/model";

const labels: Record<string, string> = {
  init: "Inicializar repositorio",
  commit: "Crear commit",
  push: "Commit y push",
  push_main: "Commit y push a principal",
  pr: "Crear pull request",
  merge: "Commit y merge local",
};
function resultadoLegible(valor: string): string {
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
export function RepositoryApproval({
  accion,
  onChange,
  compacta = false,
}: {
  accion: RepositoryAction;
  onChange: () => void;
  compacta?: boolean;
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
  };
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api.decideRepositoryAction(accion.id, approve),
    onSettled: onChange,
  });
  const titulo = labels[accion.action] ?? accion.action;
  const subida = accion.action === "push" || accion.action === "push_main";
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
      {accion.action === "pr" && <p>Título: {p.title}</p>}
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
            disabled={decide.isPending}
            onClick={() => decide.mutate(true)}
          >
            {decide.isPending
              ? "Ejecutando…"
              : subida
                ? "Autorizar commit y push"
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
      {decide.isError && (
        <p className="error" role="alert">
          {errorText(decide.error)}
        </p>
      )}
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
  const anteriores = lista.filter((a) => a.id !== pendiente?.id);
  const ultima = lista.at(-1);
  const fallida =
    ultima?.state === "failed" && ultima.task_id === taskId ? ultima : null;
  const diff = diffQuery.data;
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
  const puedeCrearPr = pushVigente && ramaSubida === diff?.rama && !prCreado;
  const tieneCambios = Boolean(diff?.archivos.length);
  const ocupado = Boolean(pendiente) || pedir.isPending || diffQuery.isPending;
  return (
    <>
      {pendiente && (
        <RepositoryApproval
          key={pendiente.id}
          accion={pendiente}
          onChange={refrescar}
        />
      )}
      {fallida && !pendiente && (
        <div className="approval-failure">
          <p role="alert">
            {fallida.result
              ? resultadoLegible(fallida.result)
              : "No se pudo completar la acción."}
          </p>
          <button
            type="button"
            className="ghost"
            disabled={pedir.isPending}
            onClick={() => pedir.mutate(fallida.action)}
          >
            Preparar nueva autorización
          </button>
        </div>
      )}
      {anteriores.length > 0 && (
        <details className="approval-history">
          <summary>
            Historial de Git{" "}
            <span className="approval-files">{anteriores.length} acciones</span>
          </summary>
          {[...anteriores].reverse().map((a) => (
            <RepositoryApproval
              key={a.id}
              accion={a}
              onChange={refrescar}
              compacta
            />
          ))}
        </details>
      )}
      {projectId && terminada && taskId && diff && !pendiente && (
        <div className="approval-buttons" aria-label="Acciones del repositorio">
          {tieneCambios && !pushVigente && (
            <>
              <button
                type="button"
                className="primary"
                disabled={ocupado}
                onClick={() =>
                  pedir.mutate(diff.remoto ? "push_main" : "merge")
                }
              >
                {pedir.isPending
                  ? "Preparando…"
                  : diff.remoto
                    ? "Commit y push a principal"
                    : "Commit y merge local"}
              </button>
              {diff.remoto && (
                <button
                  type="button"
                  className="ghost"
                  disabled={ocupado}
                  onClick={() => pedir.mutate("push")}
                >
                  Subir rama para PR
                </button>
              )}
            </>
          )}
          {puedeCrearPr && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => pedir.mutate("pr")}
            >
              Crear pull request
            </button>
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
          {tieneCambios && commitVigente && (
            <button
              type="button"
              className="ghost"
              disabled={ocupado}
              onClick={() => pedir.mutate("merge")}
            >
              Fusionar en proyecto local
            </button>
          )}
          {!tieneCambios && (
            <span className="approval-files">Sin cambios pendientes.</span>
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
