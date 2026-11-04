import { useState } from "react";
import type { TaskPlan, TaskReport } from "../api";

const ETIQUETA_APROBACION: Record<TaskPlan["requiere_aprobacion"][number], string> = {
  commit: "Guardar commit",
  push: "Subir la rama",
  pr: "Abrir pull request",
};

const ESTADO_REPORTE: Record<TaskReport["estado"], string> = {
  completado: "Completado",
  fallo: "Con fallos",
  desviacion: "Se desvió del plan",
};

const RESULTADO_PRUEBA: Record<string, string> = {
  ok: "Correcta",
  fallo: "Falló",
  no_aplica: "No aplica",
};

// Plan del analizador. Si espera aprobación, ofrece las notas y los botones para aprobarlo o rechazarlo.
export function PlanTarea({
  plan,
  aguardaAprobacion,
  ocupado,
  error,
  onAprobar,
  onRechazar,
}: {
  plan: TaskPlan;
  aguardaAprobacion: boolean;
  ocupado: boolean;
  error: string | null;
  onAprobar: (notas: string) => void;
  onRechazar: (motivo: string) => void;
}) {
  const [notas, setNotas] = useState("");

  return (
    <section className="panel tarea-seccion" aria-labelledby="plan-titulo">
      <div className="card-top">
        <h2 id="plan-titulo">Plan</h2>
        {aguardaAprobacion && <span className="badge badge-neutral">Espera tu decisión</span>}
      </div>

      <div className="tarea-bloque">
        <span className="tarea-etiqueta">Objetivo</span>
        <div className="tarea-texto">{plan.objetivo}</div>
      </div>

      <div className="tarea-bloque">
        <span className="tarea-etiqueta">Pasos</span>
        <ol className="tarea-lista">
          {plan.pasos.map((paso, indice) => (
            <li key={`${paso.id}-${indice}`}>
              {paso.descripcion}
              {paso.archivos.length > 0 && <span className="tarea-codigo"> · {paso.archivos.join(", ")}</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="tarea-bloque">
        <span className="tarea-etiqueta">Criterios de aceptación</span>
        <ul className="tarea-lista">
          {plan.criterios_de_aceptacion.map((criterio, indice) => (
            <li key={indice}>{criterio}</li>
          ))}
        </ul>
      </div>

      {plan.requiere_aprobacion.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Acciones que necesitan tu aprobación</span>
          <div className="tarea-chips">
            {plan.requiere_aprobacion.map((accion) => (
              <span key={accion} className="badge badge-neutral">
                {ETIQUETA_APROBACION[accion]}
              </span>
            ))}
          </div>
        </div>
      )}

      {!!plan.secretos_requeridos?.length && (
        <p>Aprobar este plan permitirá al obrero usar estas credenciales: <strong>{plan.secretos_requeridos.join(", ")}</strong>.</p>
      )}

      {plan.preguntas.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Preguntas sin responder</span>
          <ul className="tarea-lista">
            {plan.preguntas.map((pregunta, indice) => (
              <li key={indice}>{pregunta}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.supuestos.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Supuestos</span>
          <ul className="tarea-lista">
            {plan.supuestos.map((supuesto, indice) => (
              <li key={indice}>{supuesto}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.riesgos.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Riesgos</span>
          <ul className="tarea-lista">
            {plan.riesgos.map((riesgo, indice) => (
              <li key={indice}>{riesgo}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.notas && !aguardaAprobacion && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Notas que diste al aprobar</span>
          <div className="tarea-texto">{plan.notas}</div>
        </div>
      )}

      {aguardaAprobacion && (
        <div className="tarea-bloque">
          <label className="tarea-etiqueta" htmlFor="plan-notas">
            Notas o respuestas para el obrero (opcional). Si rechazas el plan, dinos por qué.
          </label>
          <textarea
            id="plan-notas"
            className="tarea-textarea"
            rows={3}
            maxLength={2000}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Responde las preguntas o agrega una indicación"
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="tr-acciones-fila">
            <button type="button" className="primary task-mini-btn" disabled={ocupado} onClick={() => onAprobar(notas.trim())}>
              {ocupado ? "Enviando…" : plan.secretos_requeridos?.length ? "Aprobar con secretos" : "Aprobar plan"}
            </button>
            <button type="button" className="ghost task-mini-btn" disabled={ocupado} onClick={() => onRechazar(notas.trim())}>
              Rechazar plan
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Reporte del obrero: qué cambió, qué probó y qué queda pendiente.
export function ReporteTarea({ reporte }: { reporte: TaskReport }) {
  return (
    <section className="panel tarea-seccion" aria-labelledby="reporte-titulo">
      <div className="card-top">
        <h2 id="reporte-titulo">Reporte</h2>
        <span className="badge badge-neutral">{ESTADO_REPORTE[reporte.estado]}</span>
      </div>

      <div className="tarea-bloque">
        <span className="tarea-etiqueta">Resumen</span>
        <div className="tarea-texto">{reporte.resumen}</div>
      </div>

      {reporte.cambios.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Cambios</span>
          <ul className="tarea-lista">
            {reporte.cambios.map((cambio, indice) => (
              <li key={indice}>
                <span className="tarea-codigo">{cambio.archivo}</span> · {cambio.tipo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reporte.pruebas.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Pruebas</span>
          <ul className="tarea-lista">
            {reporte.pruebas.map((prueba, indice) => (
              <li key={indice}>
                <span className="tarea-codigo">{prueba.comando}</span> · {RESULTADO_PRUEBA[prueba.resultado] ?? prueba.resultado}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reporte.pendientes.length > 0 && (
        <div className="tarea-bloque">
          <span className="tarea-etiqueta">Pendientes</span>
          <ul className="tarea-lista">
            {reporte.pendientes.map((pendiente, indice) => (
              <li key={indice}>{pendiente}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
