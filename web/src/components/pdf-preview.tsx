import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../vendor/pdfjs/pdf.mjs";

type Props = { archivo: Blob; nombre: string };

export function PdfPreview({ archivo, nombre }: Props) {
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [pagina, setPagina] = useState(1);
  const [ancho, setAncho] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const observer = new ResizeObserver(([entrada]) => setAncho(entrada?.contentRect.width ?? 0));
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelado = false;
    let tarea: Awaited<ReturnType<typeof import("../vendor/pdfjs/pdf.mjs").getDocument>> | null = null;
    setDocumento(null);
    setPagina(1);
    setError(null);
    void (async () => {
      try {
        const pdfjs = await import("../vendor/pdfjs/pdf.mjs");
        if (cancelado) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).toString();
        const datos = new Uint8Array(await archivo.arrayBuffer());
        if (cancelado) return;
        tarea = pdfjs.getDocument({ data: datos });
        const cargado = await tarea.promise;
        if (cancelado) return;
        setDocumento(cargado);
      } catch {
        if (!cancelado) setError("PDF.js no pudo leer este documento. Descárgalo para abrirlo con otra aplicación.");
      }
    })();
    return () => {
      cancelado = true;
      if (tarea) void tarea.destroy();
    };
  }, [archivo]);

  useEffect(() => {
    if (!documento || ancho <= 0) return;
    let cancelado = false;
    let renderizado: { promise: Promise<void>; cancel(): void } | null = null;
    void documento.getPage(pagina).then((paginaPdf) => {
      const canvas = canvasRef.current;
      const contexto = canvas?.getContext("2d");
      if (!canvas || !contexto || cancelado) return;
      const original = paginaPdf.getViewport({ scale: 1 });
      const escala = Math.min(2, Math.max(0.5, (ancho - 32) / original.width));
      const viewport = paginaPdf.getViewport({ scale: escala });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderizado = paginaPdf.render({ canvasContext: contexto, viewport, canvas, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      return renderizado.promise;
    }).catch((fallo: unknown) => {
      if (!cancelado && !(fallo instanceof Error && fallo.name === "RenderingCancelledException")) {
        setError("No se pudo representar esta página del PDF.");
      }
    });
    return () => {
      cancelado = true;
      renderizado?.cancel();
    };
  }, [documento, pagina, ancho]);

  return (
    <section className="tl-chat-pdf-visor" aria-label={`Vista previa de ${nombre}`}>
      {documento && (
        <nav className="tl-chat-pdf-barra" aria-label="Navegación del PDF">
          <button type="button" className="tl-boton tl-boton-compacto" disabled={pagina <= 1} onClick={() => setPagina((actual) => Math.max(1, actual - 1))}>
            Página anterior
          </button>
          <span aria-live="polite">Página {pagina} de {documento.numPages}</span>
          <button type="button" className="tl-boton tl-boton-compacto" disabled={pagina >= documento.numPages} onClick={() => setPagina((actual) => Math.min(documento.numPages, actual + 1))}>
            Página siguiente
          </button>
        </nav>
      )}
      {error ? (
        <p className="tl-chat-archivo-estado" role="alert">{error}</p>
      ) : !documento ? (
        <p className="tl-chat-archivo-estado" role="status">Preparando vista previa…</p>
      ) : (
        <div ref={contenedorRef} className="tl-chat-pdf-contenido">
          <canvas
            ref={canvasRef}
            className="tl-chat-pdf-pagina"
            role="img"
            aria-label={`Página ${pagina} de ${documento.numPages} del PDF`}
          />
        </div>
      )}
    </section>
  );
}
