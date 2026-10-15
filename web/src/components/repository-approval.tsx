import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type RepositoryAction } from "../api";
import { errorText } from "../lib/model";

const labels: Record<string, string> = {
  init: "Inicializar repositorio",
  commit: "Crear commit",
  push: "Subir rama",
  push_main: "Commit y push a main",
  pr: "Crear pull request",
  merge: "Hacer merge a rama principal",
};
export function RepositoryApproval({
  accion,
  onChange,
}: {
  accion: RepositoryAction;
  onChange: () => void;
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
    mutationFn: (approve: boolean) => api.decideRepositoryAction(accion.id, approve),
    onSuccess: onChange,
  });
  return (
    <section className="panel approval-panel" aria-label={labels[accion.action] ?? accion.action}>
      <h2>{labels[accion.action] ?? accion.action}</h2>
      {p.descripcion && <p>{p.descripcion}</p>}
      {p.remote && <p className="approval-files">{p.remote}</p>}
      {p.rama && (
        <p>
          Rama: {p.rama}
          {accion.action === "pr" ? ` → ${p.base}` : ""}
        </p>
      )}
      {accion.action === "commit" && <p>Mensaje: {p.message}</p>}
      {accion.action === "pr" && <p>Título: {p.title}</p>}
      {p.diff && (
        <details>
          <summary>Ver cambios que autorizas</summary>
          {p.truncado && (
            <p className="hint">
              La vista del diff está recortada. La autorización cubre todos los archivos enumerados.
            </p>
          )}
          {p.archivos && (
            <ul>
              {p.archivos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <pre className="approval-diff">{p.diff}</pre>
        </details>
      )}
      {accion.state === "pending" && !decide.isError ? (
        <>
          <p>Esta acción espera tu autorización.</p>
          <div className="approval-buttons">
            <button
              type="button"
              className="primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate(true)}
            >
              Autorizar {labels[accion.action]?.toLowerCase()}
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
        </>
      ) : (
        <p role="status">
          {decide.isError
            ? "No se completó; solicita otra autorización después de corregir el problema."
            : ({
                approved: "Autorizada y completada",
                rejected: "Rechazada",
                failed: "No se completó",
                executing: "Ejecutando",
                superseded: "Reemplazada por una nueva petición del chat",
              }[accion.state] ?? accion.state)}
        </p>
      )}
      {accion.result && <p className="approval-files">{accion.result}</p>}
      {decide.isError && (
        <p className="error" role="alert">
          {errorText(decide.error)}
        </p>
      )}
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
    void qc.invalidateQueries({ queryKey: ["repository-actions", conversationId] });
    void qc.invalidateQueries({ queryKey: ["task-diff", taskId] });
  };
  const pedir = useMutation({
    mutationFn: (action: string) =>
      api.requestRepositoryAction(projectId!, { action, conversationId, taskId }),
    onSuccess: refrescar,
  });

  const listaAcciones = acciones.data ?? [];
  const accionPendiente = listaAcciones.find((a) => a.state === "pending" || a.state === "executing");
  const accionMostrar = accionPendiente ?? listaAcciones.at(-1);
  const anteriores = listaAcciones.filter((a) => a.id !== accionMostrar?.id);

  const diff = diffQuery.data;
  const tieneCommit = Boolean(diff?.aprobaciones?.commit || diff?.commit);
  const tienePush = Boolean(diff?.aprobaciones?.push);
  const tieneCambios = (diff?.archivos?.length ?? 0) > 0;
  const hayAccionEnCurso = Boolean(accionPendiente) || pedir.isPending;

  return (
    <>
      {accionMostrar && (
        <RepositoryApproval key={accionMostrar.id} accion={accionMostrar} onChange={refrescar} />
      )}

      {anteriores.length > 0 && (
        <details className="tl-historico-acciones" style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.85 }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>
            Historial de acciones de Git ({anteriores.length})
          </summary>
          <div style={{ marginTop: "0.5rem" }}>
            {anteriores.map((a) => (
              <RepositoryApproval key={a.id} accion={a} onChange={refrescar} />
            ))}
          </div>
        </details>
      )}

      {projectId && terminada && taskId && (
        <div className="approval-buttons" aria-label="Acciones del repositorio" style={{ marginTop: "0.75rem" }}>
          {tieneCambios || !tieneCommit ? (
            <>
              <button
                type="button"
                className="primary"
                disabled={hayAccionEnCurso}
                onClick={() => pedir.mutate(diff?.remoto ? "push_main" : "merge")}
                title={
                  diff?.remoto
                    ? "Crear el commit y subir los cambios directamente a la rama principal (main) en GitHub"
                    : "Crear el commit y fusionarlo directamente en la rama principal local"
                }
              >
                {pedir.isPending
                  ? "Preparando…"
                  : diff?.remoto
                  ? "Hacer commit y push a main"
                  : "Hacer merge a rama principal"}
              </button>
              {diff?.remoto && (
                <button
                  type="button"
                  className="ghost"
                  disabled={hayAccionEnCurso}
                  onClick={() => pedir.mutate("push")}
                  title="Subir a una rama secundaria para abrir un Pull Request en GitHub"
                >
                  Subir a rama secundaria (PR)
                </button>
              )}
              <button
                type="button"
                className="ghost"
                disabled={hayAccionEnCurso}
                onClick={() => pedir.mutate("commit")}
                title="Solo crear el commit local en la rama de la tarea"
              >
                Solo crear commit
              </button>
            </>
          ) : !tienePush ? (
            <>
              {diff?.remoto && (
                <button
                  type="button"
                  className="primary"
                  disabled={hayAccionEnCurso}
                  onClick={() => pedir.mutate("push_main")}
                  title="Subir el commit directamente a la rama principal (main) en GitHub"
                >
                  {pedir.isPending ? "Preparando…" : "Subir a main"}
                </button>
              )}
              <button
                type="button"
                className={diff?.remoto ? "ghost" : "primary"}
                disabled={hayAccionEnCurso}
                onClick={() => pedir.mutate("merge")}
                title="Fusionar los cambios directamente en la rama principal local"
              >
                Hacer merge a rama principal
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                disabled={hayAccionEnCurso}
                onClick={() => pedir.mutate("pr")}
                title="Crear un Pull Request en GitHub"
              >
                {pedir.isPending ? "Preparando…" : "Crear pull request"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={hayAccionEnCurso}
                onClick={() => pedir.mutate("merge")}
                title="Fusionar los cambios directamente en la rama principal local"
              >
                Hacer merge directo
              </button>
            </>
          )}
        </div>
      )}

      {pedir.isError && (
        <p role="alert" className="error" style={{ marginTop: "0.5rem" }}>
          {errorText(pedir.error)}
        </p>
      )}
    </>
  );
}
