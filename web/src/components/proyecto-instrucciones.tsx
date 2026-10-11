import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";

const MAX_INSTRUCCIONES = 8_000;

// Instrucciones del proyecto: el texto que reciben los agentes al correr en él.
export function ProyectoInstrucciones({ proyecto }: { proyecto: Project }) {
  const qc = useQueryClient();
  const original = proyecto.instrucciones ?? "";
  const [texto, setTexto] = useState(original);
  const [guardado, setGuardado] = useState(false);

  // Cuando el servidor devuelve otro texto (después de guardar), el campo lo sigue.
  // Si hay cambios sin guardar, el texto del usuario se conserva.
  const ultimoOriginal = useRef(original);
  useEffect(() => {
    setTexto((actual) => (actual === ultimoOriginal.current ? original : actual));
    ultimoOriginal.current = original;
  }, [original]);

  const guardar = useMutation({
    mutationFn: () => api.updateProject(proyecto.id, { instrucciones: texto }),
    onSuccess: () => {
      setGuardado(true);
      void qc.invalidateQueries({ queryKey: ["project", proyecto.id] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const cambiado = texto !== original;

  return (
    <section className="panel tarea-seccion" aria-labelledby="proyecto-instrucciones-titulo">
      <h2 id="proyecto-instrucciones-titulo">Instrucciones</h2>
      <p className="muted-note">Estas instrucciones reciben los agentes del proyecto.</p>

      <form
        className="tarea-formulario"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (cambiado && !guardar.isPending) guardar.mutate();
        }}
      >
        <div className="campo">
          <label className="field-label" htmlFor="proyecto-instrucciones">
            Texto
          </label>
          <textarea
            id="proyecto-instrucciones"
            className="tarea-textarea"
            rows={6}
            maxLength={MAX_INSTRUCCIONES}
            value={texto}
            onChange={(e) => {
              setGuardado(false);
              setTexto(e.target.value);
            }}
            placeholder="Por ejemplo: usa TypeScript, corre las pruebas antes de terminar."
            aria-describedby="proyecto-instrucciones-contador"
          />
          <span id="proyecto-instrucciones-contador" className="muted-note" aria-live="polite">
            {texto.length.toLocaleString("es")} / {MAX_INSTRUCCIONES.toLocaleString("es")} caracteres
          </span>
        </div>

        {guardar.isError && (
          <p className="error" role="alert">
            {errorText(guardar.error)}
          </p>
        )}

        <div className="savebar">
          {guardado && !cambiado && (
            <span className="muted-note" role="status">
              Instrucciones guardadas.
            </span>
          )}
          <button type="submit" className="primary" disabled={!cambiado || guardar.isPending}>
            {guardar.isPending ? "Guardando…" : "Guardar instrucciones"}
          </button>
        </div>
      </form>
    </section>
  );
}
