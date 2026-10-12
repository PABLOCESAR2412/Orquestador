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
  // Archivos de los que salió la última sugerencia, para decirlo en pantalla.
  const [fuentes, setFuentes] = useState<string[] | null>(null);

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

  // Toma AGENTS.md, CLAUDE.md o README.md del repo y lo añade al final del campo. No guarda nada:
  // el dueño revisa el texto y lo guarda él, porque un repo ajeno no debe dar órdenes sin revisión.
  const sugerir = useMutation({
    mutationFn: () => api.suggestProjectInstructions(proyecto.id),
    onSuccess: ({ texto: sugerido, fuentes: origen }) => {
      setGuardado(false);
      setFuentes(origen);
      setTexto((actual) => {
        const previo = actual.trim();
        return (previo ? `${previo}\n\n${sugerido}` : sugerido).slice(0, MAX_INSTRUCCIONES);
      });
    },
    onError: () => setFuentes(null),
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
        {sugerir.isError && (
          <p className="error" role="alert">
            {errorText(sugerir.error)}
          </p>
        )}

        <div className="savebar">
          {guardado && !cambiado && (
            <span className="muted-note" role="status">
              Instrucciones guardadas.
            </span>
          )}
          {fuentes && fuentes.length > 0 && !guardado && (
            <span className="muted-note" role="status">
              Añadido desde {fuentes.join(", ")}. Revísalo y guarda.
            </span>
          )}
          <button
            type="button"
            className="ghost"
            disabled={sugerir.isPending || guardar.isPending}
            onClick={() => sugerir.mutate()}
          >
            {sugerir.isPending ? "Leyendo el repo…" : "Llenar desde el repo"}
          </button>
          <button type="submit" className="primary" disabled={!cambiado || guardar.isPending}>
            {guardar.isPending ? "Guardando…" : "Guardar instrucciones"}
          </button>
        </div>
      </form>
    </section>
  );
}
