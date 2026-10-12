import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { errorText } from "../lib/model";
import { useShell } from "./shell-context";

// Misma longitud máxima que el servidor para el texto de una tarea.
const MAX_TAREA = 10_000;

// Paso siguiente después de crear un proyecto: una tarea opcional (por ejemplo, traer un repositorio)
// y luego el chat del proyecto. Sin tarea, solo abre el chat.
export function ProyectoSiguientePaso({ proyectoId, onCerrar }: { proyectoId: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const [texto, setTexto] = useState("");
  const [tareaCreada, setTareaCreada] = useState(false);
  // Si la tarea ya se creó y el chat falló, al reintentar no se vuelve a crear la tarea.
  const tareaCreadaRef = useRef(false);

  const ir = useMutation({
    mutationFn: async (prompt: string | null) => {
      if (prompt && !tareaCreadaRef.current) {
        await api.createTask({ prompt, projectId: proyectoId });
        tareaCreadaRef.current = true;
        setTareaCreada(true);
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
      return api.createConversation(proyectoId);
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedConversationId(conv.id);
      void navigate({ to: "/chat" });
    },
  });

  const prompt = texto.trim();
  const conTarea = prompt.length > 0 && !tareaCreada;

  return (
    <section className="panel tarea-seccion" aria-labelledby="proyecto-siguiente-titulo">
      <h2 id="proyecto-siguiente-titulo">Siguiente paso</h2>
      <p className="muted-note">
        El proyecto ya tiene su carpeta. Si quieres, deja una tarea para el agente, por ejemplo traer un repositorio, y
        Telo te lleva al chat del proyecto.
      </p>

      <form
        className="tarea-formulario"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!ir.isPending) ir.mutate(conTarea ? prompt : null);
        }}
      >
        <div className="campo">
          <label className="field-label" htmlFor="proyecto-siguiente-tarea">
            Tarea para el agente (opcional)
          </label>
          <textarea
            id="proyecto-siguiente-tarea"
            className="tarea-textarea"
            rows={3}
            maxLength={MAX_TAREA}
            value={texto}
            disabled={tareaCreada || ir.isPending}
            placeholder="Ejemplo: clona https://github.com/usuario/repo en esta carpeta y resume su README."
            onChange={(e) => setTexto(e.target.value)}
            aria-describedby="proyecto-siguiente-ayuda"
          />
          <p id="proyecto-siguiente-ayuda" className="muted-note">
            {tareaCreada
              ? "La tarea ya está en la cola. Falta abrir el chat del proyecto."
              : "Sin tarea, solo se abre el chat del proyecto."}
          </p>
        </div>

        {ir.isError && (
          <p className="error" role="alert">
            {errorText(ir.error)}
          </p>
        )}

        <div className="savebar">
          <button type="button" className="ghost" disabled={ir.isPending} onClick={onCerrar}>
            Ahora no
          </button>
          <button type="submit" className="primary" disabled={ir.isPending}>
            {ir.isPending
              ? "Abriendo…"
              : conTarea
                ? "Crear tarea y abrir chat"
                : "Abrir chat del proyecto"}
          </button>
        </div>
      </form>
    </section>
  );
}
