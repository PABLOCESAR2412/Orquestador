import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";

const MAX_INSTRUCCIONES = 8_000;

export function ProyectoInstrucciones({ proyecto }: { proyecto: Project }) {
  const qc = useQueryClient();
  const original = proyecto.instrucciones ?? "";
  const [texto, setTexto] = useState(original);
  const [guardado, setGuardado] = useState(false);
  const [fuentes, setFuentes] = useState<string[] | null>(null);

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
    <section className="panel" aria-labelledby="proyecto-instrucciones-titulo">
      <div className="panel-header-row">
        <h2 id="proyecto-instrucciones-titulo" className="panel-title">
          Instrucciones
        </h2>
        <span className="help-note" style={{ fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono)" }}>
          {texto.length.toLocaleString("es")} / {MAX_INSTRUCCIONES.toLocaleString("es")} caracteres
        </span>
      </div>

      <form
        className="form-group"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (cambiado && !guardar.isPending) guardar.mutate();
        }}
      >
        <textarea
          id="proyecto-instrucciones"
          className="textarea"
          rows={5}
          maxLength={MAX_INSTRUCCIONES}
          value={texto}
          onChange={(e) => {
            setGuardado(false);
            setTexto(e.target.value);
          }}
          placeholder="Ej.: El backend usa TypeScript con Bun. Corre bun test antes de hacer commit."
        />

        {guardar.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">{errorText(guardar.error)}</span>
          </div>
        )}
        {sugerir.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">{errorText(sugerir.error)}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <button
            type="button"
            className="btn-ghost"
            disabled={sugerir.isPending || guardar.isPending}
            onClick={() => sugerir.mutate()}
          >
            {sugerir.isPending ? "Leyendo el repo…" : "Llenar desde el repo"}
          </button>
          <button type="submit" className="btn-primary" disabled={!cambiado || guardar.isPending}>
            {guardar.isPending ? "Guardando…" : "Guardar instrucciones"}
          </button>
        </div>

        {guardado && !cambiado && (
          <p className="help-note" role="status">
            Instrucciones guardadas.
          </p>
        )}
        {fuentes && fuentes.length > 0 && !guardado && (
          <p className="help-note" role="status">
            Añadido desde {fuentes.join(", ")}. Revisa el texto y guarda.
          </p>
        )}
      </form>
    </section>
  );
}
