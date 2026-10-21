import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText } from "../lib/model";
import { copiarTexto } from "./chat-contenido";
import { cuando } from "./tarea-formato";

// Iconos de la fila de acciones: trazo heredado del color del botón, 16 px.
function IconoMostrar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconoOcultar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconoCopiar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconoCopiada() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ProyectoClave({ id }: { id: string }) {
  const qc = useQueryClient();
  const clave = useQuery({
    queryKey: ["project-ssh-key", id],
    queryFn: () => api.getProjectSshKey(id),
  });

  // La clave pública se oculta por defecto: se ve con el icono de mostrar, y el de copiar la lleva al portapapeles sin mostrarla.
  const [mostrar, setMostrar] = useState(false);
  const [copia, setCopia] = useState<"reposo" | "copiada" | "fallo">("reposo");
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["project-ssh-key", id] });

  // El aviso de "copiada" dura poco y vuelve solo al icono normal.
  useEffect(() => {
    if (copia === "reposo") return;
    const t = window.setTimeout(() => setCopia("reposo"), 1600);
    return () => window.clearTimeout(t);
  }, [copia]);

  const crear = useMutation({
    mutationFn: () => api.createProjectSshKey(id),
    onSuccess: () => {
      setMostrar(false);
      setCopia("reposo");
      refrescar();
    },
  });

  const quitar = useMutation({
    mutationFn: () => api.deleteProjectSshKey(id),
    onSettled: () => {
      setConfirmarQuitar(false);
      setMostrar(false);
      setCopia("reposo");
      refrescar();
    },
  });

  const datos = clave.data;

  async function copiar() {
    if (!datos?.publica) return;
    setCopia((await copiarTexto(datos.publica)) ? "copiada" : "fallo");
  }

  return (
    <section className="panel" aria-labelledby="proyecto-clave-titulo">
      <h2 id="proyecto-clave-titulo" className="panel-title">
        Clave de GitHub
      </h2>
      <p className="help-note">
        Con esta clave Telo sube las ramas de las tareas a GitHub sin token. Es una deploy key de este repositorio.
      </p>

      {clave.isPending && !clave.data && <LoadingSkeleton tipo="lineas" cantidad={2} />}
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
          <div className="clave-fila">
            <span className="clave-etiqueta">Clave pública</span>
            <div className="clave-acciones">
              <button
                type="button"
                className="btn-ghost clave-icono"
                aria-pressed={mostrar}
                aria-label={mostrar ? "Ocultar clave pública" : "Mostrar clave pública"}
                title={mostrar ? "Ocultar clave" : "Mostrar clave"}
                onClick={() => setMostrar((m) => !m)}
              >
                {mostrar ? <IconoOcultar /> : <IconoMostrar />}
              </button>
              <button
                type="button"
                className={`btn-ghost clave-icono${copia === "copiada" ? " is-copiada" : ""}`}
                aria-label={copia === "copiada" ? "Clave copiada" : "Copiar clave pública"}
                title={copia === "copiada" ? "Copiada" : "Copiar clave"}
                onClick={() => void copiar()}
              >
                {copia === "copiada" ? <IconoCopiada /> : <IconoCopiar />}
              </button>
            </div>
          </div>
          {mostrar ? (
            <pre className="mono-block" aria-label="Clave pública de GitHub">
              {datos.publica}
            </pre>
          ) : (
            <p className="mono-block clave-oculta" aria-label="Clave pública oculta">
              {datos.publica.split(" ")[0]} {"•".repeat(24)}
            </p>
          )}
          {copia === "fallo" && (
            <p className="error" role="alert">
              No se pudo copiar. Muestra la clave y cópiala a mano.
            </p>
          )}
          <p className="help-note clave-huella">
            Huella: {datos.huella} · creada {cuando(datos.creada_en)}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
