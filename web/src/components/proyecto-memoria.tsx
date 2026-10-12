import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProjectDetail } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

// Memoria del proyecto: lo que los agentes aprendieron de sus tareas. Telo la actualiza sola al
// terminar cada tarea. Son notas del agente, no órdenes; el dueño puede revisarlas o borrarlas.
export function ProyectoMemoria({ id, memoria }: { id: string; memoria: ProjectDetail["memoria"] }) {
  const qc = useQueryClient();
  const borrar = useMutation({
    mutationFn: () => api.clearProjectMemory(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["project", id] }),
  });

  return (
    <section className="panel tarea-seccion" aria-labelledby="proyecto-memoria-titulo">
      <h2 id="proyecto-memoria-titulo">Memoria</h2>
      <p className="muted-note">
        Lo que los agentes aprendieron de este proyecto: cómo se prueba y dónde está cada parte. Telo la actualiza sola al
        terminar cada tarea. Son notas del agente, no órdenes.
      </p>

      {memoria.texto ? (
        <>
          <pre className="memoria-texto" tabIndex={0} aria-label="Memoria del proyecto">
            {memoria.texto}
          </pre>
          {memoria.actualizada_en && <p className="muted-note">Actualizada: {cuando(memoria.actualizada_en)}</p>}
        </>
      ) : (
        <p className="muted-note">Todavía no hay memoria. Se llena al terminar la primera tarea del proyecto.</p>
      )}

      {borrar.isError && (
        <p className="error" role="alert">
          {errorText(borrar.error)}
        </p>
      )}

      {memoria.texto && (
        <div className="savebar">
          <button type="button" className="ghost" disabled={borrar.isPending} onClick={() => borrar.mutate()}>
            {borrar.isPending ? "Borrando…" : "Borrar memoria"}
          </button>
        </div>
      )}
    </section>
  );
}
