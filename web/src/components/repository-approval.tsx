import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type RepositoryAction } from "../api";
import { errorText } from "../lib/model";

const labels: Record<string, string> = {
  init: "Inicializar repositorio",
  commit: "Crear commit",
  push: "Subir rama",
  pr: "Crear pull request",
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
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["repository-actions", conversationId] });
    void qc.invalidateQueries({ queryKey: ["task-diff", taskId] });
  };
  const pedir = useMutation({
    mutationFn: (action: string) =>
      api.requestRepositoryAction(projectId!, { action, conversationId, taskId }),
    onSuccess: refrescar,
  });
  return (
    <>
      {acciones.data?.map((a) => (
        <RepositoryApproval key={a.id} accion={a} onChange={refrescar} />
      ))}
      {projectId && terminada && taskId && (
        <div className="approval-buttons" aria-label="Acciones del repositorio">
          {["commit", "push", "pr"].map((a) => (
            <button
              type="button"
              key={a}
              className="ghost"
              disabled={pedir.isPending}
              onClick={() => pedir.mutate(a)}
            >
              {labels[a]}
            </button>
          ))}
        </div>
      )}
      {pedir.isError && (
        <p role="alert" className="error">
          {errorText(pedir.error)}
        </p>
      )}
    </>
  );
}
