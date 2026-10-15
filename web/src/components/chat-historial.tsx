import { useRef } from "react";
import { formatWhen } from "../lib/model";
import { useDialogo } from "./controls";

export type PromptEnviado = { id: string; texto: string; cuando: string };

type Props = {
  prompts: PromptEnviado[];
  onElegir: (id: string) => void;
  onCerrar: () => void;
};

// Prompts que el usuario envió en este chat, del más reciente al más antiguo.
// Al elegir uno, el hilo salta a ese mensaje.
export function HistorialPrompts({ prompts, onElegir, onCerrar }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogo(dialogRef, onCerrar);

  return (
    <>
      <div className="scrim" onClick={onCerrar} />
      <div className="picker tl-historial" role="dialog" aria-modal="true" aria-label="Historial de prompts" ref={dialogRef}>
        <div className="picker-head tl-historial-cabecera">
          <span className="picker-titulo">Prompts enviados</span>
          <span className="picker-conteo">
            {prompts.length === 1 ? "1 prompt" : `${prompts.length} prompts`}
          </span>
        </div>
        <div className="picker-list">
          {prompts.length === 0 && <p className="picker-cargando">Aún no has enviado prompts en este chat.</p>}
          {prompts.map((p) => (
            <button key={p.id} type="button" className="picker-item" title={p.texto} onClick={() => onElegir(p.id)}>
              <span className="picker-main">
                <span className="picker-name">{p.texto}</span>
                <span className="picker-id">{formatWhen(p.cuando)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
