import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type RepositoryAction, type TaskDiff, type TaskDiffArchivo } from "../api";
import { errorText, sanearDetalle } from "../lib/model";
import { cuando } from "./tarea-formato";
import { RepositoryApproval } from "./repository-approval";

const MAX_MENSAJE = 200;

const ESTADO_ARCHIVO: Record<TaskDiffArchivo["estado"], string> = {
  nuevo: "Nuevo",
  modificado: "Modificado",
  borrado: "Borrado",
  renombrado: "Renombrado",
};

type Props = {
  id: string;
  projectId: string | null;
  datos: TaskDiff | undefined;
  cargando: boolean;
  error: unknown;
  onRecargar: () => void;
};

// Revisión de los cambios de una tarea según spec exacto de Stitch.
export function RevisionCambios({ id, projectId, datos, cargando, error, onRecargar }: Props) {
  const qc = useQueryClient();
  const [mensaje, setMensaje] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [autorizacionPush, setAutorizacionPush] = useState<RepositoryAction | null>(null);
  const [autorizacionPr, setAutorizacionPr] = useState<RepositoryAction | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  const aprobar = useMutation({
    mutationFn: (body: { accion: "commit"; hash: string; mensaje?: string }) =>
      api.approveTask(id, body),
    onSuccess: (res) => {
      setAviso(`Commit guardado (${res.sha.slice(0, 7)}).`);
      setMensaje("");
      void qc.invalidateQueries({ queryKey: ["task-diff", id] });
      void qc.invalidateQueries({ queryKey: ["task", id] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => {
      setAviso(null);
      if (err instanceof ApiError && err.code === "cambios_cambiaron") onRecargar();
    },
  });
  const pedirPush = useMutation({
    mutationFn: () => api.requestRepositoryAction(projectId!, { action: "push", taskId: id }),
    onSuccess: setAutorizacionPush,
  });
  const pedirPr = useMutation({
    mutationFn: () => api.requestRepositoryAction(projectId!, { action: "pr", taskId: id }),
    onSuccess: (accion) => {
      setAutorizacionPr(accion);
      setPrUrl(null);
    },
  });

  const enviando = aprobar.isPending;

  if (cargando && !datos) {
    return (
      <section className="panel" aria-labelledby="revision-titulo">
        <h2 id="revision-titulo" className="panel-title">
          Revisión de cambios
        </h2>
        <p className="help-note">Cargando los cambios…</p>
      </section>
    );
  }

  if (datos?.estado === "en_curso") {
    return (
      <section className="panel" aria-labelledby="revision-titulo">
        <h2 id="revision-titulo" className="panel-title">
          Revisión de cambios
        </h2>
        <p className="help-note">La tarea está ejecutándose. Los cambios estarán disponibles cuando termine.</p>
      </section>
    );
  }

  if (!datos) {
    return (
      <section className="panel" aria-labelledby="revision-titulo">
        <h2 id="revision-titulo" className="panel-title">
          Revisión de cambios
        </h2>
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(error)}</span>
          <button type="button" className="btn-ghost" onClick={onRecargar}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const archivos = datos.archivos;
  const sensibles = archivos.filter((a) => a.sensible);
  const commit = datos.aprobaciones.commit;
  const push = datos.aprobaciones.push;
  const commitHecho = commit?.estado === "aprobada" && commit.sha === datos.commit;
  const pushHecho = Boolean(push && commit && push.sha === commit.sha);
  const hash = datos.hash;

  const puedeCommit =
    datos.estado === "con_cambios" && Boolean(hash) && sensibles.length === 0 && !commitHecho && !enviando;
  const puedePush = commitHecho && datos.remoto && Boolean(hash) && !pushHecho && !enviando;

  const errorApro = aprobar.isError ? aprobar.error : null;
  const detalleErrorApro =
    errorApro instanceof ApiError && errorApro.detail ? sanearDetalle(errorApro.detail, 600) : null;

  return (
    <section className="panel" aria-labelledby="revision-titulo">
      <h2 id="revision-titulo" className="panel-title">
        Revisión de cambios
      </h2>

      {/* Lista de definición con Rama y Commit base */}
      <dl className="dl-meta">
        <dt>Rama</dt>
        <dd>{datos.rama || "feat/tarea-branch"}</dd>
        <dt>Commit base</dt>
        <dd>{datos.commit ? `${datos.commit.slice(0, 7)}` : "main"}</dd>
      </dl>

      {datos.estado === "sin_cambios" && (
        <p className="help-note">Esta tarea no cambió archivos. No hay nada que guardar.</p>
      )}

      {datos.estado === "con_cambios" && (
        <>
          {sensibles.length > 0 && (
            <div className="error-box" role="alert">
              <span className="error-text">
                Hay archivos que parecen secretos. Quítalos antes de aprobar.
              </span>
            </div>
          )}

          {/* Diff unificado en contenedor Stitch */}
          <DiffUnificado texto={datos.diff} />

          <p className="help-note">Identidad de Git para el commit: {datos.identidad_git ?? "la configurada en el proyecto"}.</p>

          {/* Formulario y acciones en orden estricto Stitch */}
          <form
            className="action-row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (puedeCommit && hash) {
                aprobar.mutate({ accion: "commit", hash, mensaje: mensaje.trim() || undefined });
              }
            }}
          >
            {!commitHecho && (
              <div className="form-group">
                <label className="form-label" htmlFor={`commit-mensaje-${id}`}>
                  Mensaje del commit (opcional)
                </label>
                <input
                  id={`commit-mensaje-${id}`}
                  className="input-text"
                  maxLength={MAX_MENSAJE}
                  placeholder={`Cambios de la tarea ${id.slice(0, 8)}`}
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            <div className="action-item">
              <button type="submit" className="btn-primary" disabled={!puedeCommit}>
                {enviando ? "Guardando…" : "Aprobar commit local"}
              </button>
              <span className="help-note">
                Crea el commit localmente en el working tree con el mensaje generado por el agente.
              </span>
            </div>

            <div className="action-item">
              <button
                type="button"
                className="btn-ghost"
                disabled={!puedePush || !projectId || pedirPush.isPending || !!autorizacionPush}
                onClick={() => {
                  pedirPush.mutate();
                }}
              >
                {pedirPush.isPending ? "Preparando autorización…" : "Preparar autorización de subida"}
              </button>
              <span className="help-note">
                La tarjeta siguiente muestra la credencial y comprueba el acceso antes de autorizar git push origin {datos.rama || "rama"}.
              </span>
            </div>

            {aviso && <p className="help-note">{aviso}</p>}
            {errorApro && (
              <div className="error-box" role="alert">
                <span className="error-text">{errorText(errorApro)}</span>
                {detalleErrorApro && <pre className="mono-block">{detalleErrorApro}</pre>}
              </div>
            )}
          </form>
          {pedirPush.isError && <p className="error" role="alert">{errorText(pedirPush.error)}</p>}
          {autorizacionPush && projectId && (
            <RepositoryApproval
              accion={autorizacionPush}
              projectId={projectId}
              onChange={(_resultado, aprobada, error) => {
                setAutorizacionPush(null);
                setAviso(error
                  ? `No se completó la subida. ${error}`
                  : aprobada === false ? "La autorización de subida fue rechazada." : null);
                void qc.invalidateQueries({ queryKey: ["task-diff", id] });
                void qc.invalidateQueries({ queryKey: ["task", id] });
                void qc.invalidateQueries({ queryKey: ["tasks"] });
              }}
            />
          )}
          {pushHecho && (
            <p className="approval-auth" role="status">
              Rama subida con: {push?.autenticacion?.etiqueta ?? "método no registrado en esta acción anterior"}
              {push?.autenticacion?.cuenta ? ` · @${push.autenticacion.cuenta}` : ""}.
            </p>
          )}
          {pushHecho && !prUrl && !["pending", "executing"].includes(autorizacionPr?.state ?? "") && (
            <div className="action-item">
              <button
                type="button"
                className="btn-primary"
                disabled={!projectId || pedirPr.isPending}
                onClick={() => pedirPr.mutate()}
              >
                {pedirPr.isPending
                  ? "Preparando autorización…"
                  : autorizacionPr?.state === "failed" || autorizacionPr?.state === "rejected"
                    ? "Preparar nueva autorización de PR"
                    : "Preparar autorización de PR"}
              </button>
              <span className="help-note">
                Abre un pull request desde la rama revisada {push?.rama ?? datos.rama} hacia la rama base del repositorio.
              </span>
            </div>
          )}
          {pedirPr.isError && <p className="error" role="alert">{errorText(pedirPr.error)}</p>}
          {autorizacionPr && projectId && (
            <RepositoryApproval
              accion={autorizacionPr}
              projectId={projectId}
              onChange={(resultado, aprobada, error) => {
                if (error) {
                  setAutorizacionPr(null);
                  setPrUrl(null);
                  setAviso(`No se pudo crear el pull request. ${error}`);
                  return;
                }
                const datosResultado = resultado && typeof resultado === "object"
                  ? resultado as { url?: unknown }
                  : null;
                const url = typeof datosResultado?.url === "string" && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(datosResultado.url)
                  ? datosResultado.url
                  : null;
                setAutorizacionPr((actual) => actual
                  ? { ...actual, state: aprobada ? "approved" : "rejected", result: url ? JSON.stringify({ url }) : actual.result }
                  : actual);
                setPrUrl(aprobada ? url : null);
                setAviso(aprobada === false ? "La autorización del pull request fue rechazada." : null);
                void qc.invalidateQueries({ queryKey: ["task-diff", id] });
                void qc.invalidateQueries({ queryKey: ["task", id] });
                void qc.invalidateQueries({ queryKey: ["tasks"] });
              }}
            />
          )}
          {prUrl && (
            <p className="approval-auth" role="status">
              Pull request creado: <a href={prUrl} target="_blank" rel="noreferrer">Ver pull request</a>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Diff unificado con líneas added, removed, context
function DiffUnificado({ texto }: { texto: string }) {
  if (!texto) return null;
  const lineas = texto.split("\n");

  return (
    <div className="diff-container" tabIndex={0} aria-label="Diff unificado">
      {lineas.map((linea, i) => {
        let tipo = "context";
        if (linea.startsWith("+") && !linea.startsWith("+++")) tipo = "added";
        else if (linea.startsWith("-") && !linea.startsWith("---")) tipo = "removed";
        return (
          <div key={i} className={`diff-line ${tipo}`}>
            {linea || " "}
          </div>
        );
      })}
    </div>
  );
}
