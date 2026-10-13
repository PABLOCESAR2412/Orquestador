import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";

// Clonado pendiente de un proyecto creado desde GitHub. La clave del proyecto se pega en el repo
// (deploy key) y, con ella, Telo clona el código en la carpeta del proyecto.
export function ProyectoClonar({ proyecto }: { proyecto: Project }) {
  const qc = useQueryClient();
  const clonar = useMutation({
    mutationFn: () => api.cloneProject(proyecto.id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["project", proyecto.id] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <section className="panel" aria-labelledby="proyecto-clonar-titulo">
      <h2 id="proyecto-clonar-titulo" className="panel-title">
        Clonar el repositorio
      </h2>
      <p className="help-note">
        Todavía no hay código en esta carpeta. El origen es <span className="mono-inline">{proyecto.origen_url}</span>.
      </p>
      <ol className="clonar-pasos">
        <li>Copia la clave pública de la sección Clave de GitHub, más abajo.</li>
        <li>
          En GitHub, abre el repositorio y ve a Settings → Deploy keys → Add deploy key. Pega la clave. Para clonar basta
          con solo lectura; marca escritura solo si quieres que Telo suba ramas.
        </li>
        <li>Vuelve aquí y pulsa Clonar ahora.</li>
      </ol>
      {clonar.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(clonar.error)}</span>
        </div>
      )}
      <div>
        <button type="button" className="btn-primary" disabled={clonar.isPending} onClick={() => clonar.mutate()}>
          {clonar.isPending ? "Clonando…" : "Clonar ahora"}
        </button>
      </div>
    </section>
  );
}
