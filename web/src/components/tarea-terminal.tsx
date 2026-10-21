import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText } from "../lib/model";
import { quitarAnsi } from "./tarea-formato";

type Props = {
  id: string;
  // Líneas que llegaron por el canal en vivo desde la última carga de la salida.
  vivas: string[];
  enCurso: boolean;
  // Se llama cuando la salida se carga: las líneas en vivo ya están dentro de ella.
  onCargada: () => void;
};

// Líneas finales que se pintan. Una salida de 512 KB en un solo bloque vuelve lenta la pantalla al llegar cada línea en vivo.
const LINEAS_TERMINAL = 300;

// Terminal crudo del agente. Solo pide la salida cuando el usuario lo abre.
export function TerminalCrudo({ id, vivas, enCurso, onCargada }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [mostrarTodo, setMostrarTodo] = useState(false);
  const salida = useQuery({
    queryKey: ["task-output", id],
    queryFn: () => api.taskOutput(id),
    enabled: abierto,
  });

  useEffect(() => {
    // Solo cuando llega una carga nueva.
    if (salida.dataUpdatedAt) onCargada();
  }, [salida.dataUpdatedAt]);

  const texto = useMemo(() => {
    const base = salida.data ? quitarAnsi(salida.data.texto).replace(/\n+$/, "") : "";
    const extra = vivas.map((linea) => quitarAnsi(linea));
    return [base, ...extra].filter((parte) => parte !== "").join("\n");
  }, [salida.data, vivas]);

  const lineas = useMemo(() => texto.split("\n"), [texto]);
  const ocultas = mostrarTodo ? 0 : Math.max(0, lineas.length - LINEAS_TERMINAL);
  const visible = ocultas > 0 ? lineas.slice(ocultas).join("\n") : texto;

  return (
    <details className="tarea-terminal" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>Terminal del agente</summary>

      {abierto && salida.isPending && !salida.data && <LoadingSkeleton tipo="contenido" cantidad={3} />}
      {abierto && salida.isError && (
        <p className="error" role="alert">
          {errorText(salida.error)}
        </p>
      )}
      {abierto && salida.data?.truncado && (
        <p className="muted-note">Se muestran solo las últimas 512 KB de la salida.</p>
      )}
      {abierto && salida.data && (
        <>
          {enCurso && <p className="muted-note">Las líneas nuevas llegan en vivo.</p>}
          {ocultas > 0 && (
            <div className="lineas-mas">
              <button type="button" className="ghost task-mini-btn" onClick={() => setMostrarTodo(true)}>
                Mostrar las {ocultas.toLocaleString("es")} líneas anteriores
              </button>
            </div>
          )}
          <pre className="tarea-terminal-texto" tabIndex={0} aria-label="Salida del agente">
            {visible || "Todavía no hay salida."}
          </pre>
        </>
      )}
    </details>
  );
}
