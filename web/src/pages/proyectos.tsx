import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";
import { BotonTema } from "../components/tema-boton";
import { AppNav } from "../components/nav";

// Misma regla que el servidor para el nombre de la carpeta: sin acentos, minúsculas y guiones.
export function carpetaDe(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MAX_NOMBRE = 60;

export function ProjectsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const [nombre, setNombre] = useState("");

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  const crear = useMutation({
    mutationFn: () => api.createProject({ name: nombre.trim() }),
    onSuccess: (p) => {
      setNombre("");
      refrescar();
      void navigate({
        to: "/proyectos/$id",
        params: { id: p.id },
        state: (prev) => ({ ...prev, proyectoNuevo: true }),
      });
    },
  });

  const slug = carpetaDe(nombre.trim());
  const vistaPrevia = !nombre.trim()
    ? "Escribe un nombre para ver la carpeta que se creará."
    : slug
      ? `Carpeta resultante: /srv/orquestador/projects/${slug}`
      : "El nombre necesita al menos una letra o un número para crear la carpeta.";

  return (
    <div className="page-wrap">
      <AppNav variant="row" />

      <main className="container">
        <header className="header-row">
          <h1 className="page-title">Proyectos</h1>
          <BotonTema />
        </header>

        {/* Panel Nuevo proyecto */}
        <section className="panel" aria-labelledby="nuevo-proyecto-titulo">
          <h2 id="nuevo-proyecto-titulo" className="panel-title">
            Nuevo proyecto
          </h2>
          <form
            className="form-group"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (nombre.trim() && slug && !crear.isPending) crear.mutate();
            }}
          >
            <label className="form-label" htmlFor="projectName">
              Nombre del proyecto
            </label>
            <input
              id="projectName"
              className="input-text"
              maxLength={MAX_NOMBRE}
              placeholder="Ej. orquestador-core"
              autoComplete="off"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              aria-describedby="proyecto-vista-previa"
            />
            <div id="proyecto-vista-previa" className="input-meta" aria-live="polite">
              {vistaPrevia}
            </div>

            {crear.isError && (
              <div className="error-box" role="alert" style={{ marginTop: 8 }}>
                <span className="error-text">{errorText(crear.error)}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              style={{ marginTop: 10 }}
              disabled={!nombre.trim() || !slug || crear.isPending}
            >
              {crear.isPending ? "Creando…" : "Crear proyecto"}
            </button>
            <p className="help-note">La carpeta no cambia: solo el nombre que ves en Telo.</p>
          </form>
        </section>

        {/* Panel Tus proyectos */}
        <section className="panel" aria-labelledby="lista-proyectos-titulo">
          <div className="panel-head-row">
            <h2 id="lista-proyectos-titulo" className="panel-title">
              Tus proyectos
            </h2>
            <span className="help-note">
              {proyectos.data ? `${proyectos.data.length} proyectos` : "0 proyectos"}
            </span>
          </div>

          {proyectos.isPending && <p className="help-note">Cargando proyectos…</p>}
          {proyectos.data?.length === 0 && (
            <div className="empty-state">Todavía no hay proyectos. Crea uno arriba.</div>
          )}

          {proyectos.data && proyectos.data.length > 0 && (
            <div className="project-list">
              {proyectos.data.map((p) => (
                <FilaProyecto key={p.id} proyecto={p} alCambiar={refrescar} />
              ))}
            </div>
          )}
        </section>

        {/* Error global al cargar proyectos con botón Reintentar */}
        {proyectos.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">
              {errorText(proyectos.error) ||
                "No se pudo sincronizar el índice remoto de proyectos. Comprueba la conexión con el servidor."}
            </span>
            <button className="btn-ghost" type="button" onClick={() => void proyectos.refetch()}>
              Reintentar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function FilaProyecto({ proyecto: p, alCambiar }: { proyecto: Project; alCambiar: () => void }) {
  const [renombrando, setRenombrando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState(p.name);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  const editar = useMutation({
    mutationFn: (body: { name?: string; pinned?: boolean }) => api.updateProject(p.id, body),
    onSettled: () => {
      setRenombrando(false);
      alCambiar();
    },
  });

  const quitar = useMutation({
    mutationFn: () => api.deleteProject(p.id),
    onSettled: () => {
      setConfirmarBorrar(false);
      alCambiar();
    },
  });

  const error = editar.error ?? quitar.error;

  if (renombrando) {
    return (
      <div className="project-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const limpio = nuevoNombre.trim();
            if (limpio && limpio !== p.name) editar.mutate({ name: limpio });
            else setRenombrando(false);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label className="form-label" htmlFor={`renombrar-${p.id}`}>
            Nuevo nombre
          </label>
          <input
            id={`renombrar-${p.id}`}
            className="input-text"
            autoFocus
            value={nuevoNombre}
            maxLength={MAX_NOMBRE}
            autoComplete="off"
            onChange={(e) => setNuevoNombre(e.target.value)}
          />
          <p className="help-note">La carpeta no cambia: solo el nombre que ves en Telo.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn-primary" disabled={editar.isPending}>
              Guardar
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRenombrando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="project-row">
      <Link
        to="/proyectos/$id"
        params={{ id: p.id }}
        className="project-info"
        style={{ flex: 1, textDecoration: "none" }}
      >
        <div className="project-name-wrap">
          <span className="project-name">{p.name}</span>
          {p.pinned_at && <span className="tag-pinned">· anclado</span>}
        </div>
        <span className="project-folder">/srv/orquestador/projects/{p.carpeta}</span>
      </Link>

      <div className="project-acciones" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setNuevoNombre(p.name);
            setRenombrando(true);
          }}
        >
          Renombrar
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => editar.mutate({ pinned: !p.pinned_at })}
          disabled={editar.isPending}
        >
          {p.pinned_at ? "Quitar ancla" : "Anclar"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={{ color: "var(--danger)" }}
          onClick={() => setConfirmarBorrar(true)}
          disabled={quitar.isPending || confirmarBorrar}
        >
          Eliminar
        </button>
      </div>

      {confirmarBorrar && (
        <div
          className="error-box"
          role="alertdialog"
          aria-label={`Eliminar ${p.name}`}
          style={{ width: "100%", marginTop: 8 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="error-text">
              ¿Quitar «{p.name}» de Telo? Se elimina solo el registro: la carpeta «{p.carpeta}» y sus archivos siguen en el servidor.
            </span>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="btn-primary"
                style={{ background: "var(--danger)", color: "#fff" }}
                onClick={() => quitar.mutate()}
                disabled={quitar.isPending}
              >
                Sí, quitar
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmarBorrar(false)}>
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-box" role="alert" style={{ width: "100%", marginTop: 8 }}>
          <span className="error-text">{errorText(error)}</span>
        </div>
      )}
    </div>
  );
}
