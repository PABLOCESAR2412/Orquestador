import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { errorText } from "../lib/model";
import { describirTipoArchivo, type ReferenciaArchivo } from "./chat-contenido";

export function ChatArchivoPreview({
  projectId,
  referencia,
  onClose,
  onSelectPath,
}: {
  projectId: string;
  referencia: ReferenciaArchivo;
  onClose: () => void;
  onSelectPath: (ruta: string) => void;
}) {
  const archivo = useQuery({
    queryKey: ["project-file", projectId, referencia.ruta],
    queryFn: () => api.readProjectFile(projectId, referencia.ruta),
  });
  const cuerpoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cuerpo = cuerpoRef.current;
    if (!cuerpo || !archivo.data) return;
    if (!referencia.linea) {
      cuerpo.scrollTop = 0;
      return;
    }
    const objetivo = cuerpo.querySelector<HTMLElement>(`[data-linea="${referencia.linea}"]`);
    if (objetivo) cuerpo.scrollTop = Math.max(0, objetivo.offsetTop - cuerpo.offsetTop - cuerpo.clientHeight / 2);
  }, [archivo.data, referencia.linea]);

  const lineas = archivo.data?.texto.split("\n") ?? [];
  const rutaActual = archivo.data?.ruta ?? referencia.ruta;
  const nombre = rutaActual.split(/[\\/]/).at(-1) || rutaActual;
  const tipoArchivo = describirTipoArchivo(rutaActual);
  const lineaExiste = Boolean(referencia.linea && referencia.linea > 0 && referencia.linea <= lineas.length);
  const coincidencias = archivo.error instanceof ApiError && archivo.error.code === "project_path_ambiguous"
    ? archivo.error.matches ?? []
    : [];
  const puedeReintentar = !(archivo.error instanceof ApiError) || archivo.error.status >= 500;

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
        <button autoFocus type="button" className="tl-accion-icono" aria-label="Cerrar vista de archivo" title="Cerrar vista de archivo" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      {archivo.isPending && <p className="tl-chat-archivo-estado" role="status">Cargando archivo…</p>}
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
          <div ref={cuerpoRef} className="tl-chat-archivo-cuerpo" role="region" aria-label={`Contenido de ${rutaActual}`} tabIndex={0}>
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
          </div>
        </>
      )}
    </aside>
  );
}
