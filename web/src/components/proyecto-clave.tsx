import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

// Clave de GitHub del proyecto: deploy key con la que Telo sube las ramas de las tareas.
// Solo se muestra la parte pública; la privada queda cifrada en el servidor.
export function ProyectoClave({ id }: { id: string }) {
  const qc = useQueryClient();
  const clave = useQuery({
    queryKey: ["project-ssh-key", id],
    queryFn: () => api.getProjectSshKey(id),
  });

  const [copiada, setCopiada] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["project-ssh-key", id] });

  const crear = useMutation({
    mutationFn: () => api.createProjectSshKey(id),
    onSuccess: () => {
      setCopiada(false);
      refrescar();
    },
  });

  const quitar = useMutation({
    mutationFn: () => api.deleteProjectSshKey(id),
    onSettled: () => {
      setConfirmarQuitar(false);
      setCopiada(false);
      refrescar();
    },
  });

  const datos = clave.data;

  async function copiar() {
    if (!datos?.publica) return;
    try {
      await navigator.clipboard.writeText(datos.publica);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <section className="panel tarea-seccion" aria-labelledby="proyecto-clave-titulo">
      <h2 id="proyecto-clave-titulo">Clave de GitHub</h2>
      <p className="muted-note">
        Con esta clave Telo sube las ramas de las tareas a GitHub, sin token. Es una deploy key de este repo.
      </p>

      {clave.isPending && <p className="muted-note">Cargando la clave…</p>}
      {clave.isError && (
        <>
          <p className="error" role="alert">
            {errorText(clave.error)}
          </p>
          <div>
            <button type="button" className="ghost" onClick={() => void clave.refetch()}>
              Reintentar
            </button>
          </div>
        </>
      )}

      {datos && !datos.existe && (
        <>
          <p className="muted-note">
            Este proyecto todavía no tiene clave. Telo guarda la parte privada cifrada y nunca la muestra.
          </p>
          {!datos.disponible && (
            <p className="error" role="alert">
              El servidor no tiene configurada la clave de cifrado, así que no se puede crear la clave.
            </p>
          )}
          {crear.isError && (
            <p className="error" role="alert">
              {errorText(crear.error)}
            </p>
          )}
          <div className="savebar">
            <button
              type="button"
              className="primary"
              disabled={!datos.disponible || crear.isPending}
              onClick={() => crear.mutate()}
            >
              {crear.isPending ? "Creando…" : "Crear clave"}
            </button>
          </div>
        </>
      )}

      {datos?.existe && datos.publica && (
        <>
          <pre className="clave-publica" aria-label="Clave pública de GitHub">
            {datos.publica}
          </pre>
          <p className="muted-note">
            Huella: {datos.huella} · creada {cuando(datos.creada_en)}
          </p>
          <ol className="clave-pasos">
            <li>En GitHub abre el repo: Settings → Deploy keys → Add deploy key.</li>
            <li>Pega la clave completa.</li>
            <li>Marca «Allow write access». Sin ese permiso, Telo no puede subir ramas.</li>
          </ol>
          <p className="muted-note">
            Mientras la clave exista, Telo sube por SSH y no usa el token de GitHub del proyecto.
          </p>

          {copiada && (
            <p className="muted-note" role="status">
              Clave copiada.
            </p>
          )}
          {quitar.isError && (
            <p className="error" role="alert">
              {errorText(quitar.error)}
            </p>
          )}

          <div className="savebar">
            <button type="button" className="ghost" onClick={() => void copiar()}>
              Copiar clave
            </button>
            {confirmarQuitar ? (
              <div className="programada-confirmar-acciones">
                <button
                  type="button"
                  className="danger-solid"
                  disabled={quitar.isPending}
                  onClick={() => quitar.mutate()}
                >
                  Sí, quitar
                </button>
                <button type="button" className="ghost" onClick={() => setConfirmarQuitar(false)}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" className="ghost" onClick={() => setConfirmarQuitar(true)}>
                Quitar clave
              </button>
            )}
          </div>
          {confirmarQuitar && (
            <p className="muted-note">
              Telo dejará de subir con esta clave. Bórrala también en Deploy keys de GitHub.
            </p>
          )}
        </>
      )}
    </section>
  );
}
