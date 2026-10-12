import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProjectDetail } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

// Memoria del proyecto: Stitch mono-block y botón ghost en header.
export function ProyectoMemoria({ id, memoria }: { id: string; memoria: ProjectDetail["memoria"] }) {
  const qc = useQueryClient();
  const borrar = useMutation({
    mutationFn: () => api.clearProjectMemory(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["project", id] }),
  });

  return (
    <section className="panel" aria-labelledby="proyecto-memoria-titulo">
      <div className="panel-header-row">
        <h2 id="proyecto-memoria-titulo" className="panel-title">
          Memoria
        </h2>
        {memoria.texto && (
          <button
            type="button"
            className="btn-ghost"
            disabled={borrar.isPending}
            onClick={() => borrar.mutate()}
          >
            {borrar.isPending ? "Borrando…" : "Borrar memoria"}
          </button>
        )}
      </div>

      <p className="help-note">
        Conocimiento persistente que los agentes aprendieron durante la ejecución de tareas previas.
      </p>

      {memoria.texto ? (
        <>
          <pre className="mono-block" tabIndex={0} aria-label="Memoria del proyecto">
            {memoria.texto}
          </pre>
          {memoria.actualizada_en && (
            <p className="help-note">Actualizada: {cuando(memoria.actualizada_en)}</p>
          )}
        </>
      ) : (
        <p className="help-note">
          Todavía no hay memoria. Se llena al terminar la primera tarea del proyecto.
        </p>
      )}

      {borrar.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(borrar.error)}</span>
        </div>
      )}
    </section>
  );
}
