import { useRef, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useDialogo } from "./controls";

export function CapacidadesMedios({
  modelo,
  nombreModelo,
  onCerrar,
  disparador,
}: {
  modelo: string | null;
  nombreModelo: string | null;
  onCerrar: () => void;
  disparador?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const medios = useQuery({ queryKey: ["capacidades-medios"], queryFn: api.capacidadesMedios, staleTime: 60_000 });
  const cerrar = () => {
    disparador?.current?.focus();
    onCerrar();
  };
  useDialogo(ref, cerrar);

  return (
    <div className="usage-popover tl-medios-popover" role="dialog" aria-label="Capacidades multimedia" ref={ref}>
      <div className="usage-title-row">
        <span className="usage-title">Capacidades del chat</span>
        <button type="button" className="ghost task-mini-btn" aria-label="Cerrar capacidades multimedia" onClick={cerrar}>Cerrar</button>
      </div>
      <p className="tl-medios-modelo">Modelo seleccionado: <strong>{nombreModelo ?? modelo ?? "Predeterminado del servidor"}</strong></p>
      <dl className="tl-medios-lista">
        <div><dt>Gráficos</dt><dd>Diagramas Mermaid, barras, líneas, pastel, dona y estadísticas.</dd></div>
        <div><dt>Documentos</dt><dd>Word, Excel, HTML, texto y Markdown; la vista puede imprimirse o guardarse como PDF.</dd></div>
        <div><dt>Imágenes</dt><dd>Google Nano Banana 2.1: PNG en 1K, 2K o 4K. {medios.data?.apiGoogleConfigurada ? "API configurada." : "API key de Google sin configurar."}</dd></div>
        <div><dt>Vídeo</dt><dd>Google Veo 3.1 Lite: 720p/1080p; Veo Fast: 4K. Puedes pedir relación vertical, horizontal y duración de 4, 6 u 8 segundos.</dd></div>
      </dl>
      <p className="tl-medios-nota">Se activa al pedir una imagen o video en lenguaje natural. La generación usa Google API aunque el chat use otro modelo; estos modelos no tienen nivel gratuito. Telo muestra el costo estimado y espera tu autorización antes de generar. <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Ver precios oficiales</a>.{!medios.data?.apiGoogleConfigurada && <> Configura la API key en <a href="/ajustes?pestana=proveedores">Ajustes → Proveedores IA</a>.</>}</p>
    </div>
  );
}
