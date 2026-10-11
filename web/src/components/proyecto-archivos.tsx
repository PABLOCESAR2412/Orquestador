import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { cuando, formatBytes } from "./tarea-formato";

// Explorador de solo lectura dentro de la carpeta del proyecto.
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
    <section className="panel tarea-seccion" aria-labelledby="proyecto-archivos-titulo">
      <h2 id="proyecto-archivos-titulo">Archivos</h2>

      {archivo === null ? (
        <>
          <nav aria-label="Ruta dentro del proyecto">
            <ol className="migas">
              <li>
                <button type="button" className="migas-btn" onClick={() => irA("")} aria-current={partes.length === 0 ? "location" : undefined}>
                  Raíz
                </button>
              </li>
              {partes.map((parte, i) => {
                const destino = partes.slice(0, i + 1).join("/");
                const actual = i === partes.length - 1;
                return (
                  <li key={destino}>
                    <button
                      type="button"
                      className="migas-btn"
                      onClick={() => irA(destino)}
                      aria-current={actual ? "location" : undefined}
                    >
                      {parte}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {listado.isPending && <p className="muted-note">Cargando la carpeta…</p>}
          {listado.isError && (
            <>
              <p className="error" role="alert">
                {errorText(listado.error)}
              </p>
              <div>
                <button type="button" className="ghost" onClick={() => void listado.refetch()}>
                  Reintentar
                </button>
              </div>
            </>
          )}
          {listado.data && listado.data.entradas.length === 0 && (
            <p className="muted-note">Esta carpeta está vacía.</p>
          )}
          {listado.data && listado.data.entradas.length > 0 && (
            <ul className="archivos-lista" aria-label="Contenido de la carpeta">
              {listado.data.entradas.map((e) => (
                <li key={e.ruta}>
                  <button
                    type="button"
                    className="archivo-fila"
                    onClick={() => (e.tipo === "carpeta" ? irA(e.ruta) : setArchivo(e.ruta))}
                  >
                    <span className="archivo-nombre">
                      {e.tipo === "carpeta" ? `${e.nombre}/` : e.nombre}
                    </span>
                    <span className="archivo-meta">
                      {e.tipo === "carpeta" ? "Carpeta" : formatBytes(e.tamano ?? 0)}
                      {e.modificado ? ` · ${cuando(e.modificado)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="archivo-cabecera">
            <button type="button" className="ghost task-mini-btn" onClick={() => setArchivo(null)}>
              Volver a la carpeta
            </button>
            <span className="archivo-titulo">{archivo}</span>
          </div>

          {contenido.isPending && <p className="muted-note">Cargando el archivo…</p>}
          {contenido.isError && (
            <>
              <p className="error" role="alert">
                {errorText(contenido.error)}
              </p>
              <div>
                <button type="button" className="ghost" onClick={() => void contenido.refetch()}>
                  Reintentar
                </button>
              </div>
            </>
          )}
          {contenido.data && (
            <>
              <p className="muted-note">
                {formatBytes(contenido.data.tamano)}
                {contenido.data.truncado ? " · Se muestran los primeros 256 KB del archivo." : ""}
              </p>
              <pre className="archivo-texto" tabIndex={0} aria-label={`Contenido de ${archivo}`}>
                {contenido.data.texto}
              </pre>
            </>
          )}
        </>
      )}
    </section>
  );
}
