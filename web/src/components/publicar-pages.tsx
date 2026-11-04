import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Task } from "../api";
import { errorText } from "../lib/model";

const ERRORES_PAGES: Record<string, string> = {
  pages_invalid_destination: "Escribe el nombre del proyecto de Pages y la ruta relativa de su carpeta compilada.",
  pages_task_unfinished: "Termina la tarea de construcción antes de publicar.",
  pages_credentials_missing: "Configura el token y el ID de cuenta de Cloudflare en Ajustes → Proveedores.",
  pages_wrangler_missing: "Comprueba que Wrangler y Node.js estén instalados en Estado del servidor.",
  pages_permission_denied: "Cloudflare rechazó el token. Comprueba que tenga permiso Cloudflare Pages → Edit para esa cuenta.",
  pages_project_missing: "Cloudflare no encontró ese proyecto de Pages en la cuenta configurada.",
  pages_assets_missing: "Falta la copia de trabajo o la carpeta compilada. Restaura la tarea o vuelve a compilar desde el proyecto.",
  pages_assets_empty: "La carpeta de publicación está vacía.",
  pages_assets_unsupported: "La carpeta incluye enlaces, archivos privados o un Worker. Elige una carpeta con archivos estáticos.",
  pages_assets_too_large: "La carpeta compilada excede el límite de esta publicación.",
  pages_remote_error: "No se pudo comprobar el proyecto en Cloudflare. Revisa el destino y la conexión.",
  pages_publish_failed: "Wrangler no completó la publicación. Revisa el proyecto y los despliegues en Cloudflare antes de reintentar.",
};

export function PublicarPages({ tarea }: { tarea: Task }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [proyecto, setProyecto] = useState("");
  const [directorio, setDirectorio] = useState("dist");
  const texto = `${tarea.prompt}\n${tarea.reporte?.resumen ?? ""}\n${tarea.error ?? ""}`;
  const habilitado = Boolean(tarea.project_id && tarea.work_mode !== "plan" && ["done", "failed"].includes(tarea.status)
    && /\bcloudflare\b[^\n]{0,120}\bpages\b|\bp[áa]ginas\s+de\s+cloudflare|wrangler\s+pages|pages\.dev|CLOUDFLARE_API_TOKEN/i.test(texto));
  const eventos = useQuery({
    queryKey: ["task-events", tarea.id],
    queryFn: () => api.listTaskEvents(tarea.id),
    enabled: habilitado && abierto,
  });
  const publicar = useMutation({
    mutationFn: () => api.publicarPages(tarea.id, { proyecto, directorio }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["task-events", tarea.id] }); },
  });
  if (!habilitado) return null;
  const url = publicar.data ? publicar.data.url : eventos.data?.filter((evento) => evento.kind === "pages_publicadas").at(-1)?.detail;
  const urlPublicada = url && /^https:\/\/[a-z0-9.-]+\.pages\.dev$/i.test(url) ? url : null;
  const error = publicar.error;
  const mensaje = error instanceof ApiError ? ERRORES_PAGES[error.code] ?? errorText(error) : error ? errorText(error) : null;
  return (
    <details className="tl-reporte-tarea" onToggle={(evento) => setAbierto(evento.currentTarget.open)}>
      <summary>Publicar en Cloudflare Pages</summary>
      <form className="form-group" onSubmit={(evento) => {
        evento.preventDefault();
        if (!publicar.isPending) publicar.mutate();
      }}>
        <p className="help-note">Telo publica los archivos estáticos en producción con la credencial guardada en Ajustes → Proveedores.</p>
        <label className="form-group">
          <span className="form-label">Proyecto existente en Pages</span>
          <input className="input-text" value={proyecto} onChange={(evento) => setProyecto(evento.target.value)} placeholder="mi-proyecto" pattern="[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?" maxLength={63} required disabled={publicar.isPending} />
        </label>
        <label className="form-group">
          <span className="form-label">Carpeta compilada de la tarea</span>
          <input className="input-text" value={directorio} onChange={(evento) => setDirectorio(evento.target.value)} maxLength={1024} required disabled={publicar.isPending} />
        </label>
        <div className="tl-reporte-acciones">
          <button type="submit" className="tl-boton tl-boton-principal" disabled={publicar.isPending}>
            {publicar.isPending ? "Publicando…" : "Publicar en producción"}
          </button>
        </div>
        {mensaje && <p className="tl-alerta" role="alert">{mensaje}</p>}
        {urlPublicada && <p className="help-note" role="status">Última publicación <a href={urlPublicada} target="_blank" rel="noreferrer">{urlPublicada}</a></p>}
        {publicar.isSuccess && !urlPublicada && <p className="help-note" role="status">Wrangler terminó sin devolver una URL. Consulta los despliegues en Cloudflare para verificar la publicación.</p>}
      </form>
    </details>
  );
}
