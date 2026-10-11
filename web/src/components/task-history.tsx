import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { EVENT_LABEL, formatWhen } from "../lib/model";

// Historial de una tarea. Solo se pide cuando el usuario lo abre, y se actualiza mientras está abierto.
export function HistorialTarea({ id }: { id: string }) {
  const [abierto, setAbierto] = useState(false);
  const eventos = useQuery({
    queryKey: ["task-events", id],
    queryFn: () => api.listTaskEvents(id),
    enabled: abierto,
    refetchInterval: abierto ? 4_000 : false,
  });

  return (
    <details className="task-historial" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>Historial</summary>
      {eventos.isLoading && <p className="muted-note">Cargando…</p>}
      {eventos.isError && <p className="error" role="alert">No se pudo cargar el historial.</p>}
      {eventos.data && eventos.data.length > 0 && (
        <ol className="task-historial-lista">
          {eventos.data.map((ev) => (
            <li key={ev.id}>
              <time className="task-historial-hora">{formatWhen(ev.created_at)}</time>
              <span className="task-historial-evento">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
              {ev.detail && <span className="task-historial-detalle">{ev.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
