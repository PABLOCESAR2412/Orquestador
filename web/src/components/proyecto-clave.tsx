import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

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
    <section className="panel" aria-labelledby="proyecto-clave-titulo">
      <h2 id="proyecto-clave-titulo" className="panel-title">
        Clave de GitHub
      </h2>
      <p className="help-note">
        Con esta clave Telo sube las ramas de las tareas a GitHub sin token. Es una deploy key de este repositorio.
      </p>

      {clave.isPending && <p className="help-note">Cargando la clave…</p>}
      {clave.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(clave.error)}</span>
          <button type="button" className="btn-ghost" onClick={() => void clave.refetch()}>
            Reintentar
          </button>
        </div>
      )}

      {datos && !datos.existe && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="help-note">
            Este proyecto todavía no tiene clave. Telo guarda la parte privada cifrada y nunca la muestra.
          </p>
          {crear.isError && (
            <div className="error-box" role="alert">
              <span className="error-text">{errorText(crear.error)}</span>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!datos.disponible || crear.isPending}
            onClick={() => crear.mutate()}
          >
            {crear.isPending ? "Creando…" : "Crear clave"}
          </button>
        </div>
      )}

      {datos?.existe && datos.publica && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <pre className="mono-block" aria-label="Clave pública de GitHub">
            {datos.publica}
          </pre>
          <p className="help-note">
            Huella: {datos.huella} · creada {cuando(datos.creada_en)}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn-ghost" onClick={() => void copiar()}>
              {copiada ? "Copiada" : "Copiar clave"}
            </button>
            {confirmarQuitar ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ background: "var(--danger)", color: "var(--bg)" }}
                  disabled={quitar.isPending}
                  onClick={() => quitar.mutate()}
                >
                  Sí, quitar
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmarQuitar(false)}>
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                style={{ color: "var(--danger)" }}
                onClick={() => setConfirmarQuitar(true)}
              >
                Quitar clave
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
