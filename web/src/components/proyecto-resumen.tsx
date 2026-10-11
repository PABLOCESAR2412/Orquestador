import { Link } from "@tanstack/react-router";
import type { ProjectDetail } from "../api";
import { STATUS_LABEL } from "../lib/model";
import { cuando, formatBytes } from "./tarea-formato";

// Resumen del proyecto: Git, chats, tareas y tamaño.
export function ProyectoResumen({ detalle }: { detalle: ProjectDetail }) {
  const { git, tareas, chats, tamano_bytes: tamano, ultima_tarea: ultima } = detalle;

  return (
    <section className="panel tarea-seccion" aria-labelledby="proyecto-resumen-titulo">
      <h2 id="proyecto-resumen-titulo">Resumen</h2>

      {!git && <p className="muted-note">Esta carpeta no es un repositorio Git.</p>}

      <div className="status-meta-list">
        {git && (
          <>
            <div className="status-meta-row">
              <span className="status-meta-label">Rama</span>
              <span className="status-meta-value tarea-codigo">{git.rama}</span>
            </div>
            <div className="status-meta-row">
              <span className="status-meta-label">Commits</span>
              <span className="status-meta-value">{git.commits.toLocaleString("es")}</span>
            </div>
            <div className="status-meta-row">
              <span className="status-meta-label">Último commit</span>
              <span className="status-meta-value proyecto-texto-largo">
                {git.ultimo_commit
                  ? `${git.ultimo_commit.sha.slice(0, 7)} · ${git.ultimo_commit.asunto} · ${cuando(git.ultimo_commit.fecha)}`
                  : "Sin commits"}
              </span>
            </div>
            <div className="status-meta-row">
              <span className="status-meta-label">Cambios sin guardar</span>
              <span className="status-meta-value">{git.sucio ? "Sí" : "No"}</span>
            </div>
          </>
        )}
        <div className="status-meta-row">
          <span className="status-meta-label">Chats</span>
          <span className="status-meta-value">{chats.toLocaleString("es")}</span>
        </div>
        <div className="status-meta-row">
          <span className="status-meta-label">Tareas</span>
          <span className="status-meta-value">
            {tareas.total} en total · {tareas.en_curso} en curso · {tareas.hechas} listas · {tareas.fallidas} con error
          </span>
        </div>
        {ultima && (
          <div className="status-meta-row">
            <span className="status-meta-label">Última tarea</span>
            <span className="status-meta-value proyecto-texto-largo">
              <Link to="/tareas/$id" params={{ id: ultima.id }} className="foot-link">
                {ultima.title}
              </Link>{" "}
              · {STATUS_LABEL[ultima.status]}
            </span>
          </div>
        )}
        <div className="status-meta-row">
          <span className="status-meta-label">Tamaño</span>
          <span className="status-meta-value">{formatBytes(tamano)}</span>
        </div>
      </div>
    </section>
  );
}
