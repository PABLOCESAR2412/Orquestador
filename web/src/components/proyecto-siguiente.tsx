import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { chatDelProyecto } from "../lib/chat-proyecto";
import { errorText } from "../lib/model";
import { PLANTILLAS_GAUNTLET, type PlantillaGauntlet } from "../lib/plantillas-gauntlet";
import { useShell } from "./shell-context";

const MAX_TAREA = 10_000;

export function ProyectoSiguientePaso({
  proyectoId,
  onCerrar,
}: {
  proyectoId: string;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();

  // Seleccionamos la plantilla universal por defecto para demostrar la metodología
  const [plantillaActiva, setPlantillaActiva] = useState<PlantillaGauntlet | null>(PLANTILLAS_GAUNTLET[0]);
  const [texto, setTexto] = useState(PLANTILLAS_GAUNTLET[0].prompt);
  const [tareaCreada, setTareaCreada] = useState(false);
  const tareaCreadaRef = useRef(false);

  const ir = useMutation({
    mutationFn: async (prompt: string | null) => {
      if (prompt && !tareaCreadaRef.current) {
        await api.createTask({ prompt, projectId: proyectoId });
        tareaCreadaRef.current = true;
        setTareaCreada(true);
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
      return chatDelProyecto(proyectoId);
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedConversationId(conv.id);
      void navigate({ to: "/chat" });
    },
  });

  const prompt = texto.trim();
  const conTarea = prompt.length > 0 && !tareaCreada;

  const seleccionarPlantilla = (p: PlantillaGauntlet | null) => {
    setPlantillaActiva(p);
    if (p) {
      setTexto(p.prompt);
    } else {
      setTexto("");
    }
  };

  return (
    <section className="panel tl-siguiente-panel" id="nextStepPanel" aria-labelledby="proyecto-siguiente-titulo">
      <div className="panel-header-row">
        <div className="tl-siguiente-cabecera-wrap">
          <div className="tl-siguiente-badge-wrap">
            <span className="tl-gauntlet-badge">METODOLOGÍA GAUNTLET</span>
            <span className="tl-siguiente-subbadge">2 Rondas · Constructor + Árbitro</span>
          </div>
          <h2 id="proyecto-siguiente-titulo" className="panel-title tl-siguiente-titulo">
            Siguiente paso: Primera tarea del proyecto
          </h2>
        </div>
        <button
          className="btn-ghost"
          type="button"
          style={{ padding: "4px 10px", fontSize: "13px" }}
          onClick={onCerrar}
        >
          Ahora no
        </button>
      </div>

      <p className="help-note tl-siguiente-nota">
        Elige una plantilla para que el agente trabaje en bucle iterativo (Constructor ⇄ Árbitro Adversarial) y
        supere un listón comprobable antes de dar por terminado el trabajo.
      </p>

      {/* Selector de Plantillas Gauntlet */}
      <div className="tl-plantillas-seccion">
        <div className="tl-plantillas-grid" role="radiogroup" aria-label="Plantillas de inicio Gauntlet">
          {PLANTILLAS_GAUNTLET.map((p) => {
            const activa = plantillaActiva?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={activa}
                className={`tl-plantilla-card${activa ? " is-activa" : ""}`}
                onClick={() => seleccionarPlantilla(p)}
              >
                <div className="tl-plantilla-top">
                  <span className="tl-plantilla-icono" aria-hidden="true">
                    {p.icono}
                  </span>
                  <span className="tl-plantilla-tipo">{p.badge}</span>
                </div>
                <div className="tl-plantilla-info">
                  <h3 className="tl-plantilla-titulo">{p.titulo}</h3>
                  <p className="tl-plantilla-desc">{p.subtitulo}</p>
                </div>
              </button>
            );
          })}

          <button
            type="button"
            role="radio"
            aria-checked={plantillaActiva === null}
            className={`tl-plantilla-card${plantillaActiva === null ? " is-activa" : ""}`}
            onClick={() => seleccionarPlantilla(null)}
          >
            <div className="tl-plantilla-top">
              <span className="tl-plantilla-icono" aria-hidden="true">
                ✏️
              </span>
              <span className="tl-plantilla-tipo">En blanco</span>
            </div>
            <div className="tl-plantilla-info">
              <h3 className="tl-plantilla-titulo">Personalizada</h3>
              <p className="tl-plantilla-desc">Escribe tu propio encargo libre sin plantilla</p>
            </div>
          </button>
        </div>
      </div>

      {/* Editor de Tarea */}
      <form
        className="form-group tl-siguiente-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!ir.isPending) ir.mutate(conTarea ? prompt : null);
        }}
      >
        <div className="tl-siguiente-editor-wrap">
          <div className="tl-siguiente-editor-header">
            <span className="tl-editor-etiqueta">
              {plantillaActiva ? `Plantilla activa: ${plantillaActiva.titulo}` : "Encargo libre"}
            </span>
            <span className="tl-editor-caracteres">
              {texto.length} / {MAX_TAREA} caracteres
            </span>
          </div>

          <textarea
            id="firstTaskInput"
            className="input-text tl-siguiente-textarea"
            maxLength={MAX_TAREA}
            rows={8}
            value={texto}
            disabled={tareaCreada || ir.isPending}
            placeholder="Describe aquí la tarea del agente o selecciona una plantilla arriba…"
            onChange={(e) => setTexto(e.target.value)}
          />

          <div className="tl-siguiente-ayuda">
            <span>
              💡 <strong>Tip:</strong> Puedes editar o completar el texto entre corchetes <code>[ ... ]</code>. El agente
              ejecutará las pruebas y la auditoría adversarial antes de entregar.
            </span>
          </div>
        </div>

        {ir.isError && (
          <div className="error-box" role="alert" style={{ marginTop: 8 }}>
            <span className="error-text">{errorText(ir.error)}</span>
          </div>
        )}

        <div className="tl-siguiente-acciones">
          <button type="submit" className="btn-primary" disabled={ir.isPending}>
            {ir.isPending
              ? "Creando tarea…"
              : conTarea
                ? "Crear primera tarea con Gauntlet y abrir chat"
                : "Abrir chat del proyecto"}
          </button>
          {conTarea && (
            <button
              type="button"
              className="btn-ghost"
              disabled={ir.isPending}
              onClick={() => ir.mutate(null)}
              title="Abrir el chat directamente sin encolar la tarea"
            >
              Abrir chat directo
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
