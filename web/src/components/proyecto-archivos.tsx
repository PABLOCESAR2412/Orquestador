import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { formatBytes } from "./tarea-formato";

// Explorador de archivos con tabla y visor de código en mono-block tipo Stitch.
export function ProyectoArchivos({ id }: { id: string }) {
  const [ruta, setRuta] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);

  const listado = useQuery({
    queryKey: ["project-files", id, ruta],
    queryFn: () => api.listProjectFiles(id, ruta),
    enabled: archivo === null,
  });

  const contenido = useQuery({
    queryKey: ["project-file", id, archivo],
    queryFn: () => api.readProjectFile(id, archivo ?? ""),
    enabled: archivo !== null,
  });

  const partes = ruta ? ruta.split("/").filter(Boolean) : [];

  const irA = (nueva: string) => {
    setArchivo(null);
    setRuta(nueva);
  };

  return (
    <section className="panel" aria-labelledby="proyecto-archivos-titulo">
      <h2 id="proyecto-archivos-titulo" className="panel-title">
        Documentos
      </h2>

      {archivo === null ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: "4px 8px", fontSize: 12 }}
              onClick={() => irA("")}
            >
              Raíz
            </button>
            {partes.map((parte, i) => {
              const destino = partes.slice(0, i + 1).join("/");
              return (
                <span key={destino} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.5 }}>/</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 12 }}
                    onClick={() => irA(destino)}
                  >
                    {parte}
                  </button>
                </span>
              );
            })}
          </div>

          {listado.isPending && <p className="help-note">Cargando la carpeta…</p>}
          {listado.isError && (
            <div className="error-box" role="alert">
              <span className="error-text">{errorText(listado.error)}</span>
              <button type="button" className="btn-ghost" onClick={() => void listado.refetch()}>
                Reintentar
              </button>
            </div>
          )}

          {listado.data && listado.data.entradas.length === 0 && (
            <p className="help-note">Esta carpeta está vacía.</p>
          )}

          {listado.data && listado.data.entradas.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflowX: "auto" }}>
              <table className="files-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tamaño</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {listado.data.entradas.map((e) => (
                    <tr
                      key={e.ruta}
                      onClick={() => (e.tipo === "carpeta" ? irA(e.ruta) : setArchivo(e.ruta))}
                    >
                      <td>
                        <span className="file-name">
                          {e.tipo === "carpeta" ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                              <polyline points="13 2 13 9 20 9" />
                            </svg>
                          )}
                          {e.nombre}
                        </span>
                      </td>
                      <td>
                        <span className="file-meta">
                          {e.tipo === "carpeta" ? "—" : formatBytes(e.tamano ?? 0)}
                        </span>
                      </td>
                      <td>
                        <span className="file-meta">{e.tipo === "carpeta" ? "Carpeta" : "Archivo"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <button type="button" className="btn-ghost" onClick={() => setArchivo(null)}>
              ← Volver a la carpeta
            </button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink)" }}>
              {archivo}
            </span>
          </div>

          {contenido.isPending && <p className="help-note">Cargando el archivo…</p>}
          {contenido.isError && (
            <div className="error-box" role="alert">
              <span className="error-text">{errorText(contenido.error)}</span>
              <button type="button" className="btn-ghost" onClick={() => void contenido.refetch()}>
                Reintentar
              </button>
            </div>
          )}

          {contenido.data && (
            <div className="file-preview">
              <div className="file-preview-header">
                <span>Contenido de {archivo} ({formatBytes(contenido.data.tamano)})</span>
                <span>{contenido.data.truncado ? "Truncado (256 KB)" : "Lectura"}</span>
              </div>
              <pre className="mono-block" style={{ border: "none", borderRadius: 0, margin: 0 }}>
                {contenido.data.texto}
              </pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
