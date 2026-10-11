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

// Revisión de los cambios de una tarea con copia Git: archivos, diff y aprobaciones.
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
      // Si el diff cambió desde que se revisó, se vuelve a cargar para que el usuario lo vea.
      if (err instanceof ApiError && err.code === "cambios_cambiaron") onRecargar();
    },
  });

  const enviando = aprobar.isPending;

  if (cargando && !datos) {
    return (
      <section className="panel tarea-seccion" aria-labelledby="revision-titulo">
        <h2 id="revision-titulo">Revisión de cambios</h2>
        <p className="muted-note">Cargando los cambios…</p>
      </section>
    );
  }

  if (!datos) {
    return (
      <section className="panel tarea-seccion" aria-labelledby="revision-titulo">
        <h2 id="revision-titulo">Revisión de cambios</h2>
        <p className="error" role="alert">
          {errorText(error)}
        </p>
        <div>
          <button type="button" className="ghost" onClick={onRecargar}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const archivos = datos.archivos;
  const sensibles = archivos.filter((a) => a.sensible);
  const adiciones = archivos.reduce((suma, a) => suma + a.adiciones, 0);
  const eliminaciones = archivos.reduce((suma, a) => suma + a.eliminaciones, 0);
  const commit = datos.aprobaciones.commit;
  const push = datos.aprobaciones.push;
  // El commit aprobado corresponde al HEAD actual cuando su sha coincide con el del clon.
  const commitHecho = commit?.estado === "aprobada" && commit.sha === datos.commit;
  const pushHecho = Boolean(push && commit && push.sha === commit.sha);
  const hash = datos.hash;

  const puedeCommit =
    datos.estado === "con_cambios" && Boolean(hash) && sensibles.length === 0 && !commitHecho && !enviando;
  const puedePush = commitHecho && datos.remoto && Boolean(hash) && !pushHecho && !enviando;

  const textoCommit = !commit
    ? "Sin aprobar"
    : commit.estado === "aprobada"
      ? `Aprobado (${commit.sha.slice(0, 7)})${commit.mensaje ? ` · ${commit.mensaje}` : ""} · ${cuando(commit.decidida_en)}`
      : "Pendiente de aprobación";

  const textoPush = !push
    ? "No subida"
    : `Subida a ${sinCredenciales(push.remoto)} (${push.sha.slice(0, 7)}) · ${cuando(push.decidida_en)}`;

  const errorApro = aprobar.isError ? aprobar.error : null;
  const detalleErrorApro =
    errorApro instanceof ApiError && errorApro.detail ? sanearDetalle(errorApro.detail, 600) : null;

  return (
    <section className="panel tarea-seccion" aria-labelledby="revision-titulo">
      <div className="card-top">
        <h2 id="revision-titulo">Revisión de cambios</h2>
        {datos.rama && <span className="badge badge-neutral tarea-rama">{datos.rama}</span>}
      </div>

      {datos.estado === "sin_cambios" && (
        <p className="muted-note">Esta tarea no cambió archivos. No hay nada que guardar.</p>
      )}

      {datos.estado === "con_cambios" && (
        <>
          <p className="muted-note">
            {archivos.length} {archivos.length === 1 ? "archivo" : "archivos"} · +{adiciones} −{eliminaciones}
            {hash && <> · Diff revisado: {hash.slice(0, 7)}</>}
          </p>

          <ul className="rev-archivos" aria-label="Archivos cambiados">
            {archivos.map((a) => (
              <li key={`${a.estado}-${a.ruta}`} className={`rev-archivo${a.sensible ? " is-sensible" : ""}`}>
                <div className="rev-archivo-info">
                  <span className="rev-archivo-ruta">{a.ruta}</span>
                  <span className="rev-archivo-meta">
                    {ESTADO_ARCHIVO[a.estado]}
                    {a.binario ? " · Binario" : ` · +${a.adiciones} −${a.eliminaciones}`}
                  </span>
                </div>
                {a.sensible && <span className="badge badge-error">Parece un secreto</span>}
              </li>
            ))}
          </ul>

          {sensibles.length > 0 && (
            <p className="error" role="alert">
              Hay archivos que parecen secretos. Quítalos de la tarea antes de guardar el commit.
            </p>
          )}

          {datos.truncado && (
            <p className="muted-note">
              El diff es muy grande: se muestran los primeros 400 KB. El hash revisado cubre el diff completo.
            </p>
          )}

          <DiffUnificado texto={datos.diff} />

          <dl className="rev-aprobaciones">
            <div>
              <dt>Commit</dt>
              <dd>{textoCommit}</dd>
            </div>
            <div>
              <dt>Remoto</dt>
              <dd>{datos.remoto ? textoPush : "El proyecto no tiene remoto"}</dd>
            </div>
          </dl>

          <form
            className="rev-commit"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (puedeCommit && hash) {
                aprobar.mutate({ accion: "commit", hash, mensaje: mensaje.trim() || undefined });
              }
            }}
          >
            <div className="rev-campo">
              <label className="field-label" htmlFor={`commit-mensaje-${id}`}>
                Mensaje del commit (opcional)
              </label>
              <input
                id={`commit-mensaje-${id}`}
                className="text-input tarea-campo-ancho"
                maxLength={MAX_MENSAJE}
                placeholder={`Cambios de la tarea ${id.slice(0, 8)}`}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                autoComplete="off"
              />
              <span className="muted-note" aria-live="polite">
                {mensaje.length} / {MAX_MENSAJE}
              </span>
            </div>

            <div className="rev-acciones">
              <button type="submit" className="primary" disabled={!puedeCommit}>
                {enviando && aprobar.variables?.accion === "commit" ? "Guardando commit…" : "Aprobar commit"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!puedePush}
                onClick={() => {
                  if (hash) aprobar.mutate({ accion: "push", hash });
                }}
              >
                {enviando && aprobar.variables?.accion === "push" ? "Subiendo…" : "Subir rama al remoto"}
              </button>
            </div>

            {sensibles.length === 0 && !commitHecho && (
              <p className="muted-note">
                Se aprueba lo que ves aquí. Si los cambios cambian antes de aprobar, Telo lo avisa.
              </p>
            )}
            {commitHecho && <p className="muted-note">Este commit ya está guardado.</p>}
            {commitHecho && !datos.remoto && <p className="muted-note">El proyecto no tiene remoto al que subir la rama.</p>}
            {commitHecho && datos.remoto && pushHecho && <p className="muted-note">La rama ya está subida.</p>}
            {!commitHecho && (
              <p className="muted-note">Primero aprueba el commit para poder subir la rama.</p>
            )}
          </form>

          {aviso && (
            <p className="muted-note" role="status">
              {aviso}
            </p>
          )}
          {errorApro && (
            <div role="alert" className="rev-error">
              <p className="error">{errorText(errorApro)}</p>
              {detalleErrorApro && <pre className="rev-error-detalle">{detalleErrorApro}</pre>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Líneas que se pintan al abrir el diff. El resto se pide con un botón: un diff grande son miles de nodos.
const LINEAS_DIFF_INICIALES = 400;

// Diff unificado. Las líneas nuevas y quitadas llevan color y el prefijo visible (no solo color).
// Sin innerHTML: el contenido del diff se muestra como texto.
function DiffUnificado({ texto }: { texto: string }) {
  const [mostrarTodo, setMostrarTodo] = useState(false);
  if (!texto) return null;
  const lineas = texto.split("\n");
  const visibles = mostrarTodo ? lineas.length : Math.min(lineas.length, LINEAS_DIFF_INICIALES);
  const ocultas = lineas.length - visibles;
  let enCabecera = false;
  const clases = lineas.map((linea) => {
    if (linea.startsWith("diff ")) {
      enCabecera = true;
      return "is-cabecera";
    }
    if (linea.startsWith("@@")) {
      enCabecera = false;
      return "is-hunk";
    }
    if (enCabecera) return "is-cabecera";
    if (linea.startsWith("+")) return "is-add";
    if (linea.startsWith("-")) return "is-del";
    return "";
  });

  return (
    <details className="diff-caja" open>
      <summary>Diff de los cambios</summary>
      <div className="diff-cuerpo" role="region" aria-label="Diff de los cambios" tabIndex={0}>
        {lineas.slice(0, visibles).map((linea, i) => (
          <div key={i} className={`diff-linea ${clases[i]}`.trim()}>
            {linea || " "}
          </div>
        ))}
        {ocultas > 0 && (
          <div className="lineas-mas">
            <button type="button" className="ghost task-mini-btn" onClick={() => setMostrarTodo(true)}>
              Mostrar las {ocultas.toLocaleString("es")} líneas restantes
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
