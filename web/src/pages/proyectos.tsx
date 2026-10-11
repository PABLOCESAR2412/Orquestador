import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { errorText } from "../lib/model";
import { useShell } from "../components/shell-context";
import "../styles-trabajo.css";

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
  const { toggleDrawer } = useShell();

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
      void navigate({ to: "/proyectos/$id", params: { id: p.id } });
    },
  });

  const slug = carpetaDe(nombre.trim());
  const vistaPrevia = !nombre.trim()
    ? "Escribe un nombre para ver la carpeta que se creará."
    : slug
      ? `Se creará la carpeta «${slug}» en la carpeta de proyectos del servidor`
      : "El nombre necesita al menos una letra o un número para crear la carpeta.";

  return (
    <main className="page tr-pagina">
      <header className="page-head">
        <div className="page-title-row">
          <button type="button" className="ghost menu-btn" aria-label="Abrir menú" onClick={toggleDrawer}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <div>
            <h1>Proyectos</h1>
            <p className="page-desc">
              Carpetas del servidor donde trabajan los chats y las tareas. Cada proyecto es un repositorio Git.
            </p>
          </div>
        </div>
      </header>

      <section className="panel tarea-seccion" aria-labelledby="nuevo-proyecto-titulo">
        <h2 id="nuevo-proyecto-titulo">Nuevo proyecto</h2>
        <form
          className="tarea-formulario"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (nombre.trim() && slug && !crear.isPending) crear.mutate();
          }}
        >
          <div className="campo">
            <label className="field-label" htmlFor="proyecto-nombre">
              Nombre
            </label>
            <input
              id="proyecto-nombre"
              className="text-input tarea-campo-ancho"
              maxLength={MAX_NOMBRE}
              placeholder="Mi proyecto"
              autoComplete="off"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              aria-describedby="proyecto-vista-previa"
            />
            <p id="proyecto-vista-previa" className="muted-note" aria-live="polite">
              {vistaPrevia}
            </p>
          </div>

          {crear.isError && (
            <p className="error" role="alert">
              {errorText(crear.error)}
            </p>
          )}

          <div className="savebar">
            <button type="submit" className="primary" disabled={!nombre.trim() || !slug || crear.isPending}>
              {crear.isPending ? "Creando…" : "Crear proyecto"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel tarea-seccion" aria-labelledby="lista-proyectos-titulo">
        <h2 id="lista-proyectos-titulo">Tus proyectos</h2>

        {proyectos.isPending && <p className="muted-note">Cargando proyectos…</p>}
        {proyectos.isError && (
          <>
            <p className="error" role="alert">
              {errorText(proyectos.error)}
            </p>
            <div>
              <button type="button" className="ghost" onClick={() => void proyectos.refetch()}>
                Reintentar
              </button>
            </div>
          </>
        )}
        {proyectos.data?.length === 0 && <p className="muted-note">Todavía no hay proyectos. Crea uno arriba.</p>}

        {proyectos.data && proyectos.data.length > 0 && (
          <ul className="project-list">
            {proyectos.data.map((p) => (
              <FilaProyecto key={p.id} proyecto={p} alCambiar={refrescar} />
            ))}
          </ul>
        )}
      </section>
    </main>
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
      <li className="project-row">
        <form
          className="conv-rename"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const limpio = nuevoNombre.trim();
            if (limpio && limpio !== p.name) editar.mutate({ name: limpio });
            else setRenombrando(false);
          }}
        >
          <label className="field-label" htmlFor={`renombrar-${p.id}`}>
            Nuevo nombre
          </label>
          <input
            id={`renombrar-${p.id}`}
            className="conv-rename-input"
            autoFocus
            value={nuevoNombre}
            maxLength={MAX_NOMBRE}
            autoComplete="off"
            onChange={(e) => setNuevoNombre(e.target.value)}
          />
          <p className="muted-note">La carpeta no cambia: solo el nombre que ves en Telo.</p>
          <div className="conv-rename-acciones">
            <button type="submit" className="primary task-mini-btn" disabled={editar.isPending}>
              Guardar
            </button>
            <button type="button" className="ghost task-mini-btn" onClick={() => setRenombrando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="project-row proyecto-fila">
      <div className="project-info">
        <span className="proyecto-nombre-fila">
          <Link to="/proyectos/$id" params={{ id: p.id }} className="project-name proyecto-enlace">
            {p.name}
          </Link>
          {p.pinned_at && <span className="project-anclado"> · anclado</span>}
        </span>
        <span className="project-path">Carpeta: {p.carpeta}</span>
      </div>

      <div className="project-acciones">
        <button type="button" className="ghost task-mini-btn" onClick={() => { setNuevoNombre(p.name); setRenombrando(true); }}>
          Renombrar
        </button>
        <button
          type="button"
          className="ghost task-mini-btn"
          onClick={() => editar.mutate({ pinned: !p.pinned_at })}
          disabled={editar.isPending}
        >
          {p.pinned_at ? "Quitar ancla" : "Anclar"}
        </button>
        <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarBorrar(true)} disabled={quitar.isPending || confirmarBorrar}>
          Eliminar
        </button>
      </div>

      {confirmarBorrar && (
        <div className="proyecto-confirmar" role="alertdialog" aria-label={`Eliminar ${p.name}`}>
          <p>
            ¿Quitar «{p.name}» de Telo? Se elimina solo el registro: la carpeta «{p.carpeta}» y sus archivos siguen en el servidor.
          </p>
          <div className="programada-confirmar-acciones">
            <button type="button" className="danger-solid task-mini-btn" onClick={() => quitar.mutate()} disabled={quitar.isPending}>
              Sí, quitar
            </button>
            <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarBorrar(false)}>
              No
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="error proyecto-error" role="alert">
          {errorText(error)}
        </p>
      )}
    </li>
  );
}
