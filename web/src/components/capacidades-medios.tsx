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
        <div><dt>Imágenes y vídeo</dt><dd>La generación no está conectada a este chat. Telo aún no envía trabajos a esas APIs ni guarda sus archivos.</dd></div>
      </dl>
      <p className="tl-medios-nota">Cambiar el modelo por sí solo no activa imágenes o vídeo. El catálogo de Telo tampoco declara todavía las modalidades de salida; por eso no presenta una compatibilidad del proveedor que no puede verificar.</p>
    </div>
  );
}
