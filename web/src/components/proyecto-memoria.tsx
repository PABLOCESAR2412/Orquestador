import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProjectDetail } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

// Igual que MAX_MEMORIA del servidor: el agente y la persona escriben con el mismo límite.
const MAX_MEMORIA_CARACTERES = 4_000;

// Memoria del proyecto: la leen los agentes al empezar cada tarea. Se puede borrar o corregir a mano.
export function ProyectoMemoria({ id, memoria }: { id: string; memoria: ProjectDetail["memoria"] }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["project", id] });

  const borrar = useMutation({
    mutationFn: () => api.clearProjectMemory(id),
    onSuccess: refrescar,
  });

  const guardar = useMutation({
    mutationFn: (texto: string) => api.saveProjectMemory(id, texto),
    onSuccess: () => {
      setEditando(false);
      refrescar();
    },
  });

  const aprobarPropuesta = useMutation({
    mutationFn: () => api.approveProjectMemoryProposal(id),
    onSuccess: refrescar,
  });

  const descartarPropuesta = useMutation({
    mutationFn: () => api.discardProjectMemoryProposal(id),
    onSuccess: refrescar,
  });

  const empezarEdicion = () => {
    setBorrador(memoria.texto ?? "");
    guardar.reset();
    setEditando(true);
  };

  const sinCambios = borrador.trim() === (memoria.texto ?? "").trim();
  const error = borrar.error ?? guardar.error ?? aprobarPropuesta.error ?? descartarPropuesta.error;

  return (
    <section className="panel" aria-labelledby="proyecto-memoria-titulo">
      <div className="panel-header-row">
        <h2 id="proyecto-memoria-titulo" className="panel-title">
          Memoria
        </h2>
        {!editando && (
          <div className="proyecto-memoria-acciones">
            <button type="button" className="btn-ghost" onClick={empezarEdicion}>
              {memoria.texto ? "Editar" : "Escribir"}
            </button>
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
        )}
      </div>

      <p className="help-note">
        Conocimiento persistente que los agentes aprendieron durante la ejecución de tareas previas. Puedes corregirlo a mano.
      </p>

      {memoria.propuesta && (
        <div className="approval-auth approval-auth-warning" style={{ marginTop: "12px", marginBottom: "16px" }} role="alert">
          <strong>Propuesta de memoria pendiente de revisión</strong>
          <p style={{ margin: "6px 0", fontSize: "13px" }}>
            Un agente sugirió esta actualización de memoria (sin evaluación previa de Jev):
          </p>
          <pre className="mono-block" style={{ maxHeight: "160px", margin: "8px 0" }}>
            {memoria.propuesta}
          </pre>
          {memoria.propuesta_en && (
            <span style={{ fontSize: "11px", color: "var(--ink-2)" }}>
              Propuesta {cuando(memoria.propuesta_en)}
            </span>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              type="button"
              className="btn-primary"
              disabled={aprobarPropuesta.isPending || descartarPropuesta.isPending}
              onClick={() => aprobarPropuesta.mutate()}
            >
              {aprobarPropuesta.isPending ? "Aprobando…" : "Aprobar memoria"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={aprobarPropuesta.isPending || descartarPropuesta.isPending}
              onClick={() => descartarPropuesta.mutate()}
            >
              {descartarPropuesta.isPending ? "Descartando…" : "Descartar propuesta"}
            </button>
          </div>
        </div>
      )}

      {editando ? (
        <form
          className="proyecto-memoria-form"
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate(borrador.trim());
          }}
        >
          <label className="tl-campo">
            <span className="tl-campo-etiqueta">Memoria del proyecto</span>
            <textarea
              className="proyecto-memoria-texto"
              rows={10}
              maxLength={MAX_MEMORIA_CARACTERES}
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              aria-describedby={`memoria-ayuda-${id}`}
              disabled={guardar.isPending}
            />
            <span id={`memoria-ayuda-${id}`} className="tl-campo-ayuda">
              {borrador.length} de {MAX_MEMORIA_CARACTERES} caracteres. Guardar vacío borra la memoria.
            </span>
          </label>
          <div className="proyecto-memoria-acciones">
            <button type="submit" className="btn-primary" disabled={guardar.isPending || sinCambios}>
              {guardar.isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditando(false)}
              disabled={guardar.isPending}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : memoria.texto ? (
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
          Todavía no hay memoria. Se llena al terminar la primera tarea del proyecto, o puedes escribirla tú.
        </p>
      )}

      {error && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(error)}</span>
        </div>
      )}
    </section>
  );
}
