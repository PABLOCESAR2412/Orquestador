import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";
import { useShell } from "./shell-context";

// Clonado opcional de un proyecto creado desde GitHub. El avance va al chat del proyecto: cada comando
// aparece como paso del agente, igual que cualquier otro turno. Mientras corre, el panel sigue el estado de ese chat.
export function ProyectoClonar({ proyecto, clonandoEn }: { proyecto: Project; clonandoEn?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedConversationId } = useShell();
  // Chat donde corre (o corrió) el clonado: el de esta visita o el que dejó el alta del proyecto.
  const [conversacion, setConversacion] = useState<string | null>(clonandoEn ?? null);
  const iniciar = useMutation({
    mutationFn: () => api.cloneProject(proyecto.id),
    onSuccess: (inicio) => setConversacion(inicio.conversacion_id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  // Mientras el chat está ocupado, la lista de chats se actualiza cada 3 s; cuando termina, el panel lo refleja.
  const chats = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
    refetchInterval: conversacion ? 3_000 : false,
  });
  const ocupada = !!conversacion && !!chats.data?.find((c) => c.id === conversacion)?.ocupada;
  const clonando = iniciar.isPending || ocupada;

  // Cuando el clonado llega a su fin, el proyecto queda marcado como clonado: se pide de nuevo para que la vista cambie.
  useEffect(() => {
    if (!clonando) return;
    const t = window.setInterval(() => void qc.invalidateQueries({ queryKey: ["project", proyecto.id] }), 3_000);
    return () => window.clearInterval(t);
  }, [clonando, proyecto.id, qc]);

  const abrirChat = () => {
    if (!conversacion) return;
    setSelectedConversationId(conversacion);
    void navigate({ to: "/chat" });
  };

  const terminadoSinExito = !!conversacion && !clonando && !iniciar.isError;

  return (
    <section className="panel" aria-labelledby="proyecto-clonar-titulo">
      <h2 id="proyecto-clonar-titulo" className="panel-title">
        Clonar el repositorio
      </h2>
      <p className="help-note">
        Todavía no hay código en esta carpeta. El origen es <span className="mono-inline">{proyecto.origen_url}</span>.
        Clonarlo es opcional: el proceso queda en el chat del proyecto.
      </p>
      <ol className="clonar-pasos">
        <li>Si el repositorio es público, basta con pulsar Clonar ahora.</li>
        <li>
          Si es privado, copia la clave de la sección Clave de GitHub, más abajo, y agrégala en GitHub: Settings → Deploy keys
          → Add deploy key. Para clonar basta con solo lectura.
        </li>
        <li>Pulsa Clonar ahora y sigue cada comando en el chat del proyecto.</li>
      </ol>

      {clonando && (
        <p className="help-note" role="status">
          Clonando… cada comando aparece en el chat del proyecto.
        </p>
      )}
      {terminadoSinExito && (
        <p className="help-note" role="status">
          El último intento no dejó el código en la carpeta. Abre el chat para ver el motivo.
        </p>
      )}
      {iniciar.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(iniciar.error)}</span>
        </div>
      )}

      <div className="clonar-acciones">
        <button type="button" className="btn-primary" disabled={clonando} onClick={() => iniciar.mutate()}>
          {clonando ? "Clonando…" : "Clonar ahora"}
        </button>
        {conversacion && (
          <button type="button" className="btn-ghost" onClick={abrirChat}>
            Ver el chat
          </button>
        )}
      </div>
    </section>
  );
}
