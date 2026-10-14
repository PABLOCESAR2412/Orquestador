import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { useShell } from "../components/shell-context";
import { errorText } from "../lib/model";
import { MAX_NOMBRE_PROYECTO, rutaCarpeta } from "../lib/proyecto";

// Vista de proyectos: una tarjeta por proyecto del servidor, con su nombre y su carpeta.
// El alta vive en la ventana «Nuevo proyecto», que se abre desde el botón de arriba.
export function ProjectsPage() {
  const qc = useQueryClient();
  const { abrirNuevoProyecto } = useShell();
  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  return (
    <div className="page-wrap">
      <main className="container">
        <header className="header-row">
          <h1 className="page-title">Proyectos</h1>
          <button type="button" className="btn-primary" onClick={abrirNuevoProyecto}>
            Nuevo proyecto
          </button>
        </header>

        {proyectos.isPending && <p className="help-note">Cargando proyectos…</p>}
        {proyectos.data?.length === 0 && (
          <div className="empty-state">Todavía no hay proyectos. Crea el primero con Nuevo proyecto.</div>
        )}

        {proyectos.data && proyectos.data.length > 0 && (
          <ul className="proyectos-cuadricula" aria-label="Proyectos">
            {proyectos.data.map((p) => (
              <li key={p.id}>
                <TarjetaProyecto proyecto={p} alCambiar={refrescar} />
              </li>
            ))}
          </ul>
        )}

        {proyectos.isError && (
          <div className="error-box" role="alert">
            <span className="error-text">
              {errorText(proyectos.error) ||
                "No se pudo cargar la lista de proyectos. Comprueba la conexión con el servidor."}
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

function estadoOrigen(p: Project): string | null {
  if (!p.origen_url) return null;
  return p.clonado_en ? "Clonado desde GitHub" : "Falta clonar desde GitHub";
}

function TarjetaProyecto({ proyecto: p, alCambiar }: { proyecto: Project; alCambiar: () => void }) {
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
  const estado = estadoOrigen(p);

  if (renombrando) {
    return (
      <article className="proyecto-tarjeta" aria-label={`Renombrar ${p.name}`}>
        <form
          className="proyecto-tarjeta-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const limpio = nuevoNombre.trim();
            if (limpio && limpio !== p.name) editar.mutate({ name: limpio });
            else setRenombrando(false);
          }}
        >
          <label className="tl-campo">
            <span className="tl-campo-etiqueta">Nuevo nombre</span>
            <input
              className="tl-campo-texto"
              autoFocus
              value={nuevoNombre}
              maxLength={MAX_NOMBRE_PROYECTO}
              autoComplete="off"
              onChange={(e) => setNuevoNombre(e.target.value)}
              aria-describedby={`renombrar-ayuda-${p.id}`}
            />
            <span id={`renombrar-ayuda-${p.id}`} className="tl-campo-ayuda">
              La carpeta no cambia: solo el nombre que ves en Telo.
            </span>
          </label>
          <div className="proyecto-tarjeta-acciones">
            <button type="submit" className="btn-primary" disabled={editar.isPending}>
              Guardar
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRenombrando(false)}>
              Cancelar
            </button>
          </div>
        </form>
        {error && (
          <div className="error-box" role="alert">
            <span className="error-text">{errorText(error)}</span>
          </div>
        )}
      </article>
    );
  }

  return (
    <article className="proyecto-tarjeta">
      <Link to="/proyectos/$id" params={{ id: p.id }} className="proyecto-tarjeta-enlace">
        <span className="proyecto-tarjeta-cabecera">
          <span className="proyecto-tarjeta-nombre">{p.name}</span>
          {p.pinned_at && <span className="tag-pinned">Anclado</span>}
        </span>
        <span className="proyecto-tarjeta-ruta">{rutaCarpeta(p.carpeta)}</span>
        {estado && <span className="proyecto-tarjeta-estado">{estado}</span>}
      </Link>

      <div className="proyecto-tarjeta-acciones">
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
          className="btn-ghost proyecto-tarjeta-peligro"
          onClick={() => setConfirmarBorrar(true)}
          disabled={quitar.isPending || confirmarBorrar}
        >
          Eliminar
        </button>
      </div>

      {confirmarBorrar && (
        <div className="error-box" role="alertdialog" aria-label={`Eliminar ${p.name}`}>
          <span className="error-text">
            ¿Quitar «{p.name}» de Telo? Se elimina solo el registro: la carpeta «{p.carpeta}» y sus archivos siguen en el servidor.
          </span>
          <div className="proyecto-tarjeta-acciones">
            <button
              type="button"
              className="btn-primary proyecto-tarjeta-confirmar"
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
      )}

      {error && !renombrando && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(error)}</span>
        </div>
      )}
    </article>
  );
}
