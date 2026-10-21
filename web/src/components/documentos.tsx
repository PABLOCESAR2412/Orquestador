import { useRef, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Documento, type FormatoDocumento } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText } from "../lib/model";
import { useDialogo } from "./controls";

// Formatos que el usuario puede elegir al guardar un mensaje como documento.
export const FORMATOS_OPCIONES: { id: FormatoDocumento; etiqueta: string }[] = [
  { id: "docx", etiqueta: "Word (.docx)" },
  { id: "xlsx", etiqueta: "Excel (.xlsx)" },
  { id: "html", etiqueta: "HTML (.html)" },
  { id: "txt", etiqueta: "Bloc de notas (.txt)" },
  { id: "md", etiqueta: "Markdown (.md)" },
];

const ETIQUETA_CORTA: Record<FormatoDocumento, string> = {
  docx: "Word",
  xlsx: "Excel",
  html: "HTML",
  txt: "Texto",
  md: "Markdown",
};

const tamano = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 102.4) / 10} KB` : `${Math.round(bytes / 104857.6) / 10} MB`;

export const urlVistaDocumento = (id: string) => `/api/documentos/${id}/vista`;
export const urlDescargaDocumento = (id: string) => `/api/documentos/${id}/archivo`;

const ETIQUETA_TAG: Record<FormatoDocumento, string> = {
  docx: "DOCX",
  xlsx: "XLSX",
  html: "HTML",
  txt: "TXT",
  md: "MD",
};

// Vista previa dentro de un marco aislado (sin scripts, mismo origen para la cabecera de la vista).
export function VistaDocumento({
  documento,
  onCerrar,
  disparador,
}: {
  documento: Documento;
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
    <>
      <div className="scrim" onClick={cerrar} />
      <div className="tl-dialogo tl-dialogo-documento" role="dialog" aria-modal="true" aria-label={`Vista previa de ${documento.titulo}`} ref={ref}>
        <div className="tl-dialogo-cabecera">
          <div className="tl-dialogo-titulo">
            <span className="tl-dialogo-titulo-texto">{documento.titulo}</span>
            <span className="tl-chip">{ETIQUETA_CORTA[documento.formato]}</span>
          </div>
          <div className="tl-dialogo-acciones">
            <a
              className="tl-boton"
              href={urlVistaDocumento(documento.id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Abre una vista lista para imprimir; elige Guardar como PDF en el navegador."
            >
              PDF / Imprimir
            </a>
            <a className="tl-boton tl-boton-principal" href={urlDescargaDocumento(documento.id)} download>
              Descargar
            </a>
            <button type="button" className="tl-boton" onClick={cerrar}>
              Cerrar
            </button>
          </div>
        </div>
        <div className="tl-documento-cuerpo">
          <iframe
            className="tl-documento-marco"
            title={`Contenido de ${documento.titulo}`}
            src={urlVistaDocumento(documento.id)}
            sandbox=""
          />
        </div>
      </div>
    </>
  );
}

// Documentos guardados desde este chat, con vista previa, descarga y borrado.
export function ListaDocumentos({
  conversacionId,
  onVer,
}: {
  conversacionId: string;
  onVer: (documento: Documento) => void;
}) {
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: ["documentos", conversacionId],
    queryFn: () => api.listDocumentos(conversacionId),
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.eliminarDocumento(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documentos", conversacionId] }),
  });

  const n = lista.data?.length ?? 0;
  return (
    <section className="tl-documentos-bloque" aria-labelledby="docs-chat-titulo">
      <h3 id="docs-chat-titulo" className="tl-campo-etiqueta">
        Documentos de este chat{lista.data ? ` (${n})` : ""}
      </h3>
      {lista.isPending && !lista.data && <LoadingSkeleton tipo="lineas" cantidad={3} />}
      {lista.isError && (
        <p className="tl-alerta" role="alert">
          {errorText(lista.error)}
        </p>
      )}
      {lista.data && n === 0 && (
        <p className="tl-documentos-vacio">Aún no hay documentos. Pulsa “Guardar como documento” en una respuesta.</p>
      )}
      {lista.data && n > 0 && (
        <ul className="tl-documentos">
          {lista.data.map((d) => (
            <li key={d.id} className="tl-documento-fila">
              <span className="tl-documento-tag" aria-hidden="true">
                {ETIQUETA_TAG[d.formato]}
              </span>
              <div className="tl-documento-texto">
                <span className="tl-documento-titulo">{d.titulo}</span>
                <span className="tl-documento-meta">
                  {ETIQUETA_CORTA[d.formato]} · {tamano(d.bytes)}
                </span>
              </div>
              <div className="tl-documento-acciones">
                <button type="button" className="tl-accion-texto" onClick={() => onVer(d)}>
                  Ver
                </button>
                <button
                  type="button"
                  className="tl-accion-texto tl-accion-peligro"
                  aria-label={`Eliminar ${d.titulo}`}
                  disabled={borrar.isPending}
                  onClick={() => {
                    if (window.confirm(`¿Eliminar “${d.titulo}”? No se puede deshacer.`)) borrar.mutate(d.id);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
