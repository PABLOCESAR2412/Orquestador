import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type Task } from "../api";
import { errorText } from "../lib/model";

export function PlanRevision({ tarea }: { tarea: Task }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const decision = useMutation({
    mutationFn: (decision: "approve" | "revise") =>
      api.decidePlan(tarea.id, { decision, plan_hash: tarea.plan_hash!, feedback }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["task", tarea.id] });
      void qc.invalidateQueries({ queryKey: ["conversation-tasks"] });
    },
  });
  if (
    tarea.status !== "waiting_approval" ||
    !tarea.plan ||
    !tarea.plan_hash
  )
    return null;
  const p = tarea.plan;
  return (
    <section className="panel approval-panel" aria-label="Aprobar plan">
      <h2>Revisa el plan</h2>
      <Link to="/tareas/$id" params={{ id: tarea.id }}>
        Ver cambios e historial de la tarea
      </Link>
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
      <label className="approval-feedback">
        Aclaraciones o cambios al plan
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={8000}
          rows={2}
          placeholder="Responde las preguntas o indica qué cambiar"
        />
      </label>
      <div className="approval-buttons">
        <button
          type="button"
          className="primary"
          disabled={decision.isPending}
          onClick={() => decision.mutate("approve")}
        >
          {decision.isPending ? "Aprobando…" : "Aprobar plan"}
        </button>
        {feedback.trim() && (
          <button
            type="button"
            className="ghost"
            disabled={decision.isPending}
            onClick={() => decision.mutate("revise")}
            title="Solicitar al analizador que elabore un nuevo plan con estas aclaraciones"
          >
            Re-analizar plan
          </button>
        )}
        <button
          type="button"
          className="ghost"
          disabled={decision.isPending}
          onClick={() => {
            void api.cancelTask(tarea.id).then(() => qc.invalidateQueries());
          }}
        >
          Cancelar tarea
        </button>
      </div>
      {decision.isError && (
        <p className="error" role="alert">
          {errorText(decision.error)}
        </p>
      )}
    </section>
  );
}
