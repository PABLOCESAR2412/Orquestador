import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type TaskDiff, type TaskDiffArchivo } from "../api";
import { errorText, sanearDetalle } from "../lib/model";
import { cuando, sinCredenciales } from "./tarea-formato";

const MAX_MENSAJE = 200;

const ESTADO_ARCHIVO: Record<TaskDiffArchivo["estado"], string> = {
  nuevo: "Nuevo",
  modificado: "Modificado",
  borrado: "Borrado",
  renombrado: "Renombrado",
};

type Props = {
  id: string;
  datos: TaskDiff | undefined;
  cargando: boolean;
  error: unknown;
  onRecargar: () => void;
};

// Revisión de los cambios de una tarea según spec exacto de Stitch.
export function RevisionCambios({ id, datos, cargando, error, onRecargar }: Props) {
  const qc = useQueryClient();
  const [mensaje, setMensaje] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const aprobar = useMutation({
    mutationFn: (body: { accion: "commit" | "push"; hash: string; mensaje?: string }) =>
      api.approveTask(id, body),
    onSuccess: (res) => {
      if (res.accion === "commit") {
        setAviso(`Commit guardado (${res.sha.slice(0, 7)}).`);
        setMensaje("");
      } else {
        setAviso(`Rama «${res.rama}» subida${res.remoto ? ` a ${sinCredenciales(res.remoto)}` : ""}.`);
      }
      void qc.invalidateQueries({ queryKey: ["task-diff", id] });
      void qc.invalidateQueries({ queryKey: ["task", id] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => {
      setAviso(null);
      if (err instanceof ApiError && err.code === "cambios_cambiaron") onRecargar();
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
                {enviando && aprobar.variables?.accion === "commit" ? "Guardando…" : "Aprobar commit"}
              </button>
              <span className="help-note">
                Crea el commit localmente en el working tree con el mensaje generado por el agente.
              </span>
            </div>

            <div className="action-item">
              <button
                type="button"
                className="btn-ghost"
                disabled={!puedePush}
                onClick={() => {
                  if (hash) aprobar.mutate({ accion: "push", hash });
                }}
              >
                {enviando && aprobar.variables?.accion === "push" ? "Subiendo…" : "Subir rama al remoto"}
              </button>
              <span className="help-note">
                Ejecuta git push origin {datos.rama || "rama"} hacia el servidor remoto configurado.
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
