import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { EVENT_LABEL, formatWhen, sanearDetalle } from "../lib/model";

// Historial de una tarea. Solo se pide cuando el usuario lo abre, y se actualiza mientras está abierto.
export function HistorialTarea({ id, abiertoInicial = false, titulo = "Historial" }: { id: string; abiertoInicial?: boolean; titulo?: string }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  useEffect(() => { if (abiertoInicial) setAbierto(true); }, [abiertoInicial]);
  const eventos = useQuery({
    queryKey: ["task-events", id],
    queryFn: () => api.listTaskEvents(id),
    enabled: abierto,
    refetchInterval: abierto ? 4_000 : false,
  });

  return (
    <details className="task-historial" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>{titulo}</summary>
      {eventos.isLoading && !eventos.data && <LoadingSkeleton tipo="lineas" cantidad={3} />}
      {eventos.isError && (
        <>
          <p className="error" role="alert">
            No se pudo cargar el historial.
          </p>
          <div>
            <button type="button" className="ghost task-mini-btn" onClick={() => void eventos.refetch()}>
              Reintentar
            </button>
          </div>
        </>
      )}
      {eventos.data && eventos.data.length > 0 && (
        <ol className="task-historial-lista">
          {eventos.data.map((ev) => (
            <li key={ev.id}>
              <time className="task-historial-hora">{formatWhen(ev.created_at)}</time>
              <span className="task-historial-evento">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
              {ev.detail && <span className="task-historial-detalle">{sanearDetalle(ev.detail, 300)}</span>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
