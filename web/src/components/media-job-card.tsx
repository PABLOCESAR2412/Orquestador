import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

const archivoUrl = (id: string, descargar = false) =>
  `/api/media/${encodeURIComponent(id)}/archivo${descargar ? "?descargar=1" : ""}`;

export function MediaJobCard({ id }: { id: string }) {
  const qc = useQueryClient();
  const job = useQuery({
    queryKey: ["media-job", id],
    queryFn: () => api.medio(id),
    refetchInterval: (consulta) => consulta.state.data?.estado === "generando" ? 3000 : false,
    staleTime: 0,
  });
  const confirmar = useMutation({
    mutationFn: () => api.confirmarMedio(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ["media-job", id] }),
  });
  const cancelar = useMutation({
    mutationFn: () => api.cancelarMedio(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ["media-job", id] }),
  });
  const medio = job.data;
  if (!medio) {
    return <div className="tl-media-card" role="status">{job.isError ? "No se pudo cargar la solicitud de medio." : "Cargando solicitud de medio…"}</div>;
  }

  const titulo = medio.tipo === "imagen" ? "Generar imagen" : "Generar video";
  const costo = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 4 }).format(medio.costo_estimado_usd);
  const archivoListo = medio.estado === "completada";

  return (
    <section className={`tl-media-card is-${medio.estado}`} aria-label={titulo}>
      <header className="tl-media-card-cabecera">
        <span className="tl-media-icono" aria-hidden="true">{medio.tipo === "imagen" ? "▧" : "▶"}</span>
        <div className="tl-media-card-titulo">
          <strong>{titulo}</strong>
          <span>{medio.estado === "pendiente" ? "Espera tu autorización" : medio.estado === "generando" ? "Generación en curso" : medio.estado === "completada" ? "Listo" : medio.estado === "cancelada" ? "Cancelado" : "No se completó"}</span>
        </div>
        {medio.estado === "generando" && <span className="tl-media-spinner" aria-label="Generando" />}
      </header>
      <p className="tl-media-prompt">{medio.prompt}</p>
      <dl className="tl-media-datos">
        <div><dt>Modelo</dt><dd>{medio.modelo}</dd></div>
        <div><dt>Salida</dt><dd>{medio.resolucion} · {medio.relacion}{medio.duracion_segundos ? ` · ${medio.duracion_segundos} s` : ""}</dd></div>
      </dl>

      {medio.estado === "pendiente" && (
        <>
          <p className="tl-media-costo">Costo estimado desde <strong>{costo}</strong>. La API puede cobrar según la salida y el uso de entrada.</p>
          {!medio.api_google_configurada ? (
            <p className="tl-media-aviso" role="status">
              Configura una API key de Google (Gemini) en <a href="/ajustes?pestana=proveedores">Ajustes → Proveedores IA</a>. El nivel gratuito de Gemini no cubre estos modelos de generación.
            </p>
          ) : (
            <p className="tl-media-aviso">La generación usa un modelo multimedia de Google; el modelo elegido para conversar no cambia este costo. No se enviará nada hasta que lo autorices.</p>
          )}
          <div className="tl-media-acciones">
            <button type="button" className="tl-boton tl-media-confirmar" disabled={!medio.api_google_configurada || confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? "Preparando…" : "Autorizar generación"}
            </button>
            <button type="button" className="tl-boton" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar</button>
          </div>
          {confirmar.isError && <p className="tl-media-error" role="alert">No se autorizó la solicitud. Revisa la clave de Google y vuelve a intentarlo.</p>}
        </>
      )}

      {medio.estado === "generando" && <p className="tl-media-aviso" role="status">Google está procesando el archivo. Puedes seguir usando este chat mientras termina.</p>}
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
            download={medio.nombre_archivo ?? (medio.tipo === "imagen" ? "imagen.png" : "video.mp4")}
          >
            Descargar {medio.tipo}
          </a>
        </div>
      )}
    </section>
  );
}
