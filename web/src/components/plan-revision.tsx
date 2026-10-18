import { Link } from "@tanstack/react-router";
import type { Task } from "../api";

export function PlanRevision({ tarea }: { tarea: Task }) {
  if (tarea.status !== "waiting_approval" || !tarea.plan || !tarea.plan_hash)
    return null;
  const p = tarea.plan;
  return (
    <section className="panel approval-panel" aria-label="Aprobar plan">
      <header className="approval-heading">
        <h2>Revisa el plan</h2>
        <Link className="approval-task-link" to="/tareas/$id" params={{ id: tarea.id }}>
          Ver tarea e historial
        </Link>
      </header>
      <p>{p.objetivo}</p>
      <ol>
        {p.pasos.map((s) => (
          <li key={s.id}>
            {s.descripcion}
            {s.archivos.length > 0 && (
              <small className="approval-files">{s.archivos.join(", ")}</small>
            )}
          </li>
        ))}
      </ol>
      <details>
        <summary>Criterios y riesgos</summary>
        <ul>
          {p.criterios_de_aceptacion.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
        {p.riesgos.map((v, i) => (
          <p key={i}>{v}</p>
        ))}
      </details>
      {p.requiere_aprobacion.length > 0 && (
        <p className="hint">
          Después de preparar los cambios, se pedirá otra autorización para:{" "}
          {p.requiere_aprobacion.join(", ")}.
        </p>
      )}
      {p.preguntas.map((q, i) => (
        <p key={i} className="hint">
          {q}
        </p>
      ))}
      {tarea.error && <p role="alert">{tarea.error}</p>}
      <div className="tl-plan-aviso-composer">
        <span>Responde a las preguntas o indica qué cambiar en el compositor de abajo antes de aprobar.</span>
      </div>
    </section>
  );
}
