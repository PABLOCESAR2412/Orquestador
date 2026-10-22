import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

const archivoUrl = (id: string, descargar = false) =>
  `/api/media/${encodeURIComponent(id)}/archivo${descargar ? "?descargar=1" : ""}`;

export function MediaJobCard({ id }: { id: string }) {
  const job = useQuery({
    queryKey: ["media-job", id],
    queryFn: () => api.medio(id),
    refetchInterval: (consulta) => consulta.state.data?.estado === "generando" ? 3000 : false,
    staleTime: 0,
  });
  const medio = job.data;
  if (!medio) {
    return <div className="tl-media-card" role="status">{job.isError ? "No se pudo cargar la solicitud de medio." : "Cargando solicitud de medio…"}</div>;
  }

  const titulo = medio.tipo === "imagen" ? "Generar imagen" : "Generar video";
  const archivoListo = medio.estado === "completada";

  return (
    <section className={`tl-media-card is-${medio.estado}`} aria-label={titulo}>
      <header className="tl-media-card-cabecera">
        <span className="tl-media-icono" aria-hidden="true">{medio.tipo === "imagen" ? "▧" : "▶"}</span>
        <div className="tl-media-card-titulo">
          <strong>{titulo}</strong>
          <span>{medio.estado === "pendiente" ? "Desactivado para evitar cargos" : medio.estado === "generando" ? "Pausado" : medio.estado === "completada" ? "Listo" : medio.estado === "cancelada" ? "Cancelado" : "No se completó"}</span>
        </div>
        {medio.estado === "generando" && <span className="tl-media-spinner" aria-label="Generando" />}
      </header>
      <p className="tl-media-prompt">{medio.prompt}</p>
      <dl className="tl-media-datos">
        <div><dt>Modelo</dt><dd>{medio.modelo}</dd></div>
        <div><dt>Salida</dt><dd>{medio.resolucion} · {medio.relacion}{medio.duracion_segundos ? ` · ${medio.duracion_segundos} s` : ""}</dd></div>
      </dl>

      {medio.estado === "pendiente" && <p className="tl-media-aviso" role="status">Esta solicitud usaba un generador externo de pago, desactivado para evitar cargos. Pídele al agente que cree el archivo con el modelo seleccionado y las herramientas locales disponibles.</p>}

      {medio.estado === "generando" && <p className="tl-media-aviso" role="status">Esta generación externa está pausada. Pídele al agente que cree el archivo con herramientas locales.</p>}
      {medio.estado === "error" && <p className="tl-media-error" role="alert">{medio.error ?? "No se pudo generar el medio."}</p>}
      {medio.estado === "cancelada" && <p className="tl-media-aviso">No se llamó a la API de generación.</p>}

      {archivoListo && (
        <div className="tl-media-resultado">
          {medio.tipo === "imagen" ? (
            <img src={archivoUrl(id)} alt={medio.prompt} loading="lazy" />
          ) : (
            <video src={archivoUrl(id)} controls preload="metadata" aria-label={medio.prompt} />
          )}
          <a
            className="tl-boton tl-media-descargar"
            href={archivoUrl(id, true)}
            download={medio.nombre_archivo ?? (medio.tipo === "imagen" ? "imagen.jpg" : "video.mp4")}
          >
            Descargar {medio.tipo}
          </a>
        </div>
      )}
    </section>
  );
}
