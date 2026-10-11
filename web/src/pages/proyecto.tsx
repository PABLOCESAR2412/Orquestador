import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { useShell } from "../components/shell-context";
import { ProyectoResumen } from "../components/proyecto-resumen";
import { ProyectoInstrucciones } from "../components/proyecto-instrucciones";
import { ProyectoArchivos } from "../components/proyecto-archivos";
import { ProyectoSecretos } from "../components/proyecto-secretos";
import "../styles-trabajo.css";

// Vista general de un proyecto: resumen, instrucciones, archivos y secretos.
export function ProjectDetailPage() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const navigate = useNavigate();
  const { toggleDrawer } = useShell();

  const detalle = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
    enabled: id !== "",
  });

  const datos = detalle.data;
  const proyecto = datos?.project;

  return (
    <main className="page tr-pagina">
      <header className="page-head tr-cabecera">
        <div className="page-title-row">
          <button type="button" className="ghost menu-btn" aria-label="Abrir menú" onClick={toggleDrawer}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <div className="tr-cabecera-texto">
            <Link to="/proyectos" className="foot-link tr-volver">
              Volver a proyectos
            </Link>
            <h1>{proyecto?.name ?? "Proyecto"}</h1>
            {proyecto && <p className="page-desc">Carpeta: {proyecto.carpeta}</p>}
          </div>
        </div>

        {proyecto && (
          <button
            type="button"
            className="primary"
            onClick={() =>
              void navigate({
                to: "/tareas",
                // La pantalla de tareas abre el formulario con este proyecto elegido.
                state: (prev) => ({ ...prev, proyectoId: proyecto.id }),
              })
            }
          >
            Tarea nueva en este proyecto
          </button>
        )}
      </header>

      {detalle.isPending && <p className="muted-note">Cargando el proyecto…</p>}

      {detalle.isError && (
        <section className="panel">
          <p className="error" role="alert">
            {errorText(detalle.error)}
          </p>
          <div className="tr-acciones-fila">
            <button type="button" className="ghost task-mini-btn" onClick={() => void detalle.refetch()}>
              Reintentar
            </button>
            <Link to="/proyectos" className="ghost task-mini-btn tr-enlace-boton">
              Ver todos los proyectos
            </Link>
          </div>
        </section>
      )}

      {datos && proyecto && (
        <>
          <ProyectoResumen detalle={datos} />
          <ProyectoInstrucciones proyecto={proyecto} />
          <ProyectoArchivos id={proyecto.id} />
          <ProyectoSecretos id={proyecto.id} />
        </>
      )}
    </main>
  );
}
