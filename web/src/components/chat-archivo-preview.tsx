import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, urlImagenConversacion, urlPdfConversacion, urlVideoConversacion } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText } from "../lib/model";
import { PdfPreview } from "./pdf-preview";
import { describirTipoArchivo, type ReferenciaArchivo } from "./chat-contenido";

function reintentarArchivo(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && (!(error instanceof ApiError) || error.status >= 500);
}

export function ChatArchivoPreview({
  conversationId,
  referencia,
  onClose,
  onSelectPath,
}: {
  conversationId: string;
  referencia: ReferenciaArchivo;
  onClose: () => void;
  onSelectPath: (ruta: string) => void;
}) {
  const esPdf = /\.pdf$/i.test(referencia.ruta);
  const esImagen = /\.(?:png|jpe?g|webp|gif)$/i.test(referencia.ruta);
  const esVideo = /\.mp4$/i.test(referencia.ruta);
  const esHtml = /\.html?$/i.test(referencia.ruta);
  const [verCodigo, setVerCodigo] = useState(Boolean(referencia.linea));
  useEffect(() => setVerCodigo(Boolean(referencia.linea)), [referencia.ruta, referencia.linea]);
  const archivo = useQuery({
    queryKey: ["conversation-file", conversationId, referencia.ruta],
    queryFn: () => api.chatFile(conversationId, referencia.ruta),
    enabled: !esPdf && !esImagen && !esVideo,
    retry: reintentarArchivo,
  });
  const pdf = useQuery({
    queryKey: ["conversation-pdf", conversationId, referencia.ruta],
    queryFn: () => api.chatPdfInfo(conversationId, referencia.ruta),
    enabled: esPdf,
    retry: reintentarArchivo,
  });
  const pdfContenido = useQuery({
    queryKey: ["conversation-pdf-content", conversationId, referencia.ruta],
    queryFn: () => api.chatPdf(conversationId, referencia.ruta),
    enabled: esPdf && Boolean(pdf.data),
    retry: reintentarArchivo,
  });
  const imagen = useQuery({
    queryKey: ["conversation-image", conversationId, referencia.ruta],
    queryFn: () => api.chatImageInfo(conversationId, referencia.ruta),
    enabled: esImagen,
    retry: reintentarArchivo,
  });
  const video = useQuery({
    queryKey: ["conversation-video", conversationId, referencia.ruta],
    queryFn: () => api.chatVideoInfo(conversationId, referencia.ruta),
    enabled: esVideo,
    retry: reintentarArchivo,
  });
  const cuerpoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cuerpo = cuerpoRef.current;
    if (!cuerpo || !archivo.data || esPdf || esImagen || esVideo) return;
    if (!referencia.linea) {
      cuerpo.scrollTop = 0;
      return;
    }
    const objetivo = cuerpo.querySelector<HTMLElement>(`[data-linea="${referencia.linea}"]`);
    if (objetivo) cuerpo.scrollTop = Math.max(0, objetivo.offsetTop - cuerpo.offsetTop - cuerpo.clientHeight / 2);
  }, [archivo.data, referencia.linea, esPdf, esImagen, esVideo]);

  const lineas = archivo.data?.texto.split("\n") ?? [];
  const rutaActual = (esPdf ? pdf.data?.ruta : esImagen ? imagen.data?.ruta : esVideo ? video.data?.ruta : archivo.data?.ruta) ?? referencia.ruta;
  const nombre = (esPdf || esImagen || esVideo ? referencia.ruta : rutaActual).split(/[\\/]/).at(-1) || rutaActual;
  const tipoArchivo = describirTipoArchivo(rutaActual);
  const lineaExiste = Boolean(referencia.linea && referencia.linea > 0 && referencia.linea <= lineas.length);
  const archivoError = esPdf ? pdf.error : esImagen ? imagen.error : esVideo ? video.error : archivo.error;
  const coincidencias = archivoError instanceof ApiError && archivoError.code === "project_path_ambiguous"
    ? archivoError.matches ?? []
    : [];
  const mensajeErrorVideo = video.error instanceof ApiError
    && ["archivo_chat_no_encontrado", "project_path_not_found"].includes(video.error.code)
    ? "No encontramos este MP4 en las carpetas accesibles de la conversación. Comprueba que el agente lo haya guardado en el workspace antes de enlazarlo."
    : errorText(video.error);
  const puedeReintentar = !(archivoError instanceof ApiError) || archivoError.status >= 500;
  return (
    <aside className="tl-chat-archivo-panel" aria-label={`Vista del archivo ${rutaActual}`}>
      <header className="tl-chat-archivo-cabecera">
        <div className="tl-chat-archivo-titulo">
          <div className="tl-chat-archivo-nombre">
            <h2>{nombre}</h2>
            <span className="tl-chat-archivo-tipo" aria-label={tipoArchivo.tipo}>{tipoArchivo.etiqueta}</span>
          </div>
          <p title={rutaActual}>{rutaActual}{referencia.linea ? ` · línea ${referencia.linea}` : ""}</p>
        </div>
        <div className="tl-chat-archivo-acciones">
          {esHtml && <button type="button" className="tl-boton tl-boton-compacto" onClick={() => setVerCodigo(!verCodigo)}>{verCodigo ? "Vista previa" : "Código"}</button>}
          {esPdf && pdf.data && (
            <>
              <a
                className="tl-boton tl-boton-compacto"
                href={urlPdfConversacion(conversationId, referencia.ruta)}
                target="_blank"
                rel="noreferrer"
                title={`Abrir ${pdf.data.nombre} en otra pestaña`}
              >
                Abrir PDF
              </a>
              <a
                className="tl-boton tl-boton-compacto"
                href={urlPdfConversacion(conversationId, referencia.ruta, true)}
                download={pdf.data.nombre}
                title={`Descargar ${pdf.data.nombre}`}
              >
                Descargar PDF
              </a>
            </>
          )}
          {esImagen && imagen.data && (
            <a
              className="tl-boton tl-boton-compacto"
              href={urlImagenConversacion(conversationId, referencia.ruta, true)}
              download={imagen.data.nombre}
              title={`Descargar ${imagen.data.nombre}`}
            >
              Descargar imagen
            </a>
          )}
          {esVideo && video.data && (
            <>
              <a
                className="tl-boton tl-boton-compacto"
                href={urlVideoConversacion(conversationId, video.data.ruta)}
                target="_blank"
                rel="noreferrer"
                title={`Abrir ${video.data.nombre} en otra pestaña`}
              >
                Abrir video
              </a>
              <a
                className="tl-boton tl-boton-compacto"
                href={urlVideoConversacion(conversationId, video.data.ruta, true)}
                download={video.data.nombre}
                title={`Descargar ${video.data.nombre}`}
              >
                Descargar video
              </a>
            </>
          )}
          <button autoFocus type="button" className="tl-accion-icono" aria-label="Cerrar vista de archivo" title="Cerrar vista de archivo" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      {esPdf ? (
        <>
          {pdf.isPending && <p className="tl-chat-archivo-estado" role="status">Comprobando PDF…</p>}
          {pdf.data && pdfContenido.isPending && <p className="tl-chat-archivo-estado" role="status">Preparando vista previa…</p>}
          {(pdf.isError || pdfContenido.isError) && (
            <div className="tl-chat-archivo-estado" role="alert">
              <p>No se pudo abrir este PDF. {errorText(pdf.error ?? pdfContenido.error)}</p>
              {puedeReintentar && <button type="button" className="tl-boton tl-boton-compacto" onClick={() => { void pdf.refetch(); void pdfContenido.refetch(); }}>Reintentar</button>}
            </div>
          )}
          {pdf.data && pdfContenido.data && <PdfPreview archivo={pdfContenido.data} nombre={pdf.data.nombre} />}
        </>
      ) : esImagen ? (
        <>
          {imagen.isPending && <p className="tl-chat-archivo-estado" role="status">Comprobando imagen…</p>}
          {imagen.isError && (
            <div className="tl-chat-archivo-estado" role="alert">
              <p>No se pudo abrir esta imagen. {errorText(imagen.error)}</p>
              {puedeReintentar && <button type="button" className="tl-boton tl-boton-compacto" onClick={() => void imagen.refetch()}>Reintentar</button>}
            </div>
          )}
          {imagen.data && (
            <div className="tl-chat-archivo-imagen-marco">
              <img
                className="tl-chat-archivo-imagen"
                src={urlImagenConversacion(conversationId, referencia.ruta)}
                alt={imagen.data.nombre}
              />
            </div>
          )}
        </>
      ) : esVideo ? (
        <>
          {video.isPending && <p className="tl-chat-archivo-estado" role="status">Comprobando video…</p>}
          {video.isError && (
            <div className="tl-chat-archivo-estado" role="alert">
              <p>No se pudo abrir este video. {mensajeErrorVideo}</p>
              {coincidencias.length > 0 && (
                <ul className="tl-chat-archivo-coincidencias" aria-label="Videos con ese nombre">
                  {coincidencias.map((ruta) => (
                    <li key={ruta}>
                      <button type="button" className="tl-chat-archivo-ruta-opcion" onClick={() => onSelectPath(ruta)}>
                        <code>{ruta}</code>
                      </button>
                    </li>
                  ))}
                  {archivoError instanceof ApiError && archivoError.detail && <li>{archivoError.detail}</li>}
                </ul>
              )}
              {puedeReintentar && <button type="button" className="tl-boton tl-boton-compacto" onClick={() => void video.refetch()}>Reintentar</button>}
            </div>
          )}
          {video.data && (
            <div className="tl-chat-archivo-video-marco">
              <video
                className="tl-chat-archivo-video"
                src={urlVideoConversacion(conversationId, video.data.ruta)}
                controls
                playsInline
                preload="metadata"
                aria-label={video.data.nombre}
              />
            </div>
          )}
        </>
      ) : (
        <>
      {archivo.isPending && !archivo.data && <LoadingSkeleton tipo="contenido" cantidad={4} className="tl-carga-archivo" />}
      {archivo.isError && (
        <div className="tl-chat-archivo-estado" role="alert">
          <p>No se pudo leer este archivo. {errorText(archivo.error)}</p>
          {coincidencias.length > 0 && (
            <ul className="tl-chat-archivo-coincidencias" aria-label="Archivos con ese nombre">
              {coincidencias.map((ruta) => (
                <li key={ruta}>
                  <button type="button" className="tl-chat-archivo-ruta-opcion" onClick={() => onSelectPath(ruta)}>
                    <code>{ruta}</code>
                  </button>
                </li>
              ))}
              {archivo.error instanceof ApiError && archivo.error.detail && <li>{archivo.error.detail}</li>}
            </ul>
          )}
          {puedeReintentar && (
            <button type="button" className="tl-boton tl-boton-compacto" onClick={() => void archivo.refetch()}>Reintentar</button>
          )}
        </div>
      )}

      {archivo.data && (
        <>
          {archivo.data.ruta !== referencia.ruta && (
            <p className="tl-chat-archivo-nota">
              La ruta citada cambió. Se abrió la única coincidencia actual: <code>{archivo.data.ruta}</code>.
            </p>
          )}
          {referencia.linea && !lineaExiste && (
            <p className="tl-chat-archivo-nota">
              {archivo.data.truncado
                ? `La línea ${referencia.linea} queda fuera del fragmento leído.`
                : `La línea ${referencia.linea} no existe en esta versión del archivo.`}
            </p>
          )}
          {archivo.data.truncado && <p className="tl-chat-archivo-nota">Se muestra el comienzo del archivo; el contenido supera el límite de vista.</p>}
          {esHtml && !verCodigo && !archivo.data.truncado ? (
            <iframe
              key={rutaActual}
              title={`Vista previa de ${nombre}`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              style={{ width: "100%", flex: "1 1 auto", minHeight: 360, border: 0, background: "white" }}
              src={`/api/conversations/${encodeURIComponent(conversationId)}/archivo-html?ruta=${encodeURIComponent(rutaActual)}`}
            />
          ) : <div ref={cuerpoRef} className="tl-chat-archivo-cuerpo" role="region" aria-label={`Contenido de ${rutaActual}`} tabIndex={0}>
            <pre>{lineas.map((linea, indice) => {
              const numero = indice + 1;
              const activa = numero === referencia.linea;
              return (
                <span
                  key={numero}
                  className={`tl-chat-archivo-linea${activa ? " is-activa" : ""}`}
                  data-linea={numero}
                  title={activa ? `Línea citada: ${numero}` : undefined}
                >
                  <span className="tl-chat-archivo-numero" aria-hidden="true">{numero}</span>
                  <code>{linea || " "}</code>
                </span>
              );
            })}</pre>
          </div>}
        </>
      )}
        </>
      )}
    </aside>
  );
}
