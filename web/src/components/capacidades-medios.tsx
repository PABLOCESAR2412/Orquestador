import { useRef, type RefObject } from "react";
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
        <div><dt>Imágenes</dt><dd>El agente usa el modelo seleccionado y herramientas locales como SVG, HTML o Canvas. El resultado depende de las herramientas disponibles.</dd></div>
        <div><dt>Vídeo</dt><dd>Puede crear animaciones HTML con HyperFrames si Node.js 22+, Chromium y FFmpeg están disponibles. El diagnóstico del render es distinto de la consulta de cuota del modelo. Pide directamente proporción, duración, ritmo y plataforma.</dd></div>
        <div><dt>Voz</dt><dd>Para narración, conecta VoiceStudio u otro TTS local por MCP en Ajustes → Conexiones. El agente puede añadir el audio al MP4 si FFmpeg está instalado.</dd></div>
      </dl>
      <p className="tl-medios-nota">Este flujo no llama generadores externos de pago. Para reducir costes del modelo, elige una opción marcada como gratis en el selector. Las herramientas locales no cobran por petición, aunque usan el almacenamiento y el procesamiento de tu equipo o servidor. Si no hay un generador local compatible, el agente explicará el límite en vez de sustituirlo por una API facturable.</p>
    </div>
  );
}
