import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { errorText } from "../lib/model";
import { useShell } from "./shell-context";

const MAX_TAREA = 10_000;

export function ProyectoSiguientePaso({ proyectoId, onCerrar }: { proyectoId: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  const [texto, setTexto] = useState("");
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
    <section className="panel" id="nextStepPanel" aria-labelledby="proyecto-siguiente-titulo">
      <div className="panel-header-row">
        <h2 id="proyecto-siguiente-titulo" className="panel-title">
          Siguiente paso
        </h2>
        <button
          className="btn-ghost"
          type="button"
          style={{ padding: "4px 8px", fontSize: "13px" }}
          onClick={onCerrar}
        >
          Ahora no
        </button>
      </div>
      <p className="help-note">
        Escribe la primera tarea que quieres que el agente resuelva en este proyecto o abre el chat directo.
      </p>

      <form
        className="form-group"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!ir.isPending) ir.mutate(conTarea ? prompt : null);
        }}
      >
        <input
          id="firstTaskInput"
          className="input-text"
          maxLength={MAX_TAREA}
          value={texto}
          disabled={tareaCreada || ir.isPending}
          placeholder="Ej. Configurar socket IPC y verificar build con cargo"
          onChange={(e) => setTexto(e.target.value)}
        />

        {ir.isError && (
          <div className="error-box" role="alert" style={{ marginTop: 8 }}>
            <span className="error-text">{errorText(ir.error)}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
          <button type="submit" className="btn-primary" disabled={ir.isPending}>
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
