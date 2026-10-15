import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "../api";
import { useShell } from "../components/shell-context";
import { errorText } from "../lib/model";
import { MAX_NOMBRE_PROYECTO, rutaCarpeta } from "../lib/proyecto";
import { haceTexto } from "../lib/tiempo";

// Vista de proyectos: una tarjeta por proyecto del servidor, con su carpeta, su actividad y sus acciones.
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
          <div>
            <h1 className="page-title">Proyectos</h1>
            {proyectos.data && proyectos.data.length > 0 && (
              <p className="help-note">{resumenProyectos(proyectos.data)}</p>
            )}
          </div>
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

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function resumenProyectos(lista: Project[]): string {
  const ancladas = lista.filter((p) => p.pinned_at).length;
  return ancladas > 0
    ? `${plural(lista.length, "proyecto", "proyectos")} · ${ancladas} anclado${ancladas === 1 ? "" : "s"}`
    : plural(lista.length, "proyecto", "proyectos");
}

// "Activo ahora", "Última actividad hace 3 min" o "Sin actividad".
function actividadTexto(sql: string | null | undefined): string {
  if (!sql) return "Sin actividad";
  const texto = haceTexto(sql);
  return texto === "ahora" ? "Activo ahora" : `Última actividad ${texto}`;
}

function metricasTexto(p: Project): string {
  return [plural(p.chats ?? 0, "chat", "chats"), plural(p.tareas ?? 0, "tarea", "tareas"), actividadTexto(p.ultima_actividad)].join(
    " · ",
  );
}

// Iconos de 18 px dentro de botones de 40 px (mismo trazo que conv-item.tsx).
const ICONO = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

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

  const ruta = rutaCarpeta(p.carpeta);

  return (
    <article className="proyecto-tarjeta">
      <Link to="/proyectos/$id" params={{ id: p.id }} className="proyecto-tarjeta-enlace">
        <span className="proyecto-tarjeta-cabecera">
          <span className="proyecto-tarjeta-nombre">{p.name}</span>
          {p.pinned_at && <span className="tag-pinned">Anclado</span>}
        </span>
        <span className="proyecto-tarjeta-ruta" title={ruta}>
          {ruta}
        </span>
        <span className="proyecto-tarjeta-metricas">{metricasTexto(p)}</span>
        {estado && <span className="proyecto-tarjeta-estado">{estado}</span>}
      </Link>

      <div className="proyecto-tarjeta-pie" role="group" aria-label={`Acciones de ${p.name}`}>
        <button
          type="button"
          className="proyecto-icono"
          aria-label={`Renombrar ${p.name}`}
          title="Renombrar"
          onClick={() => {
            setNuevoNombre(p.name);
            setRenombrando(true);
          }}
        >
          <svg {...ICONO}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
        <button
          type="button"
          className={`proyecto-icono${p.pinned_at ? " is-activo" : ""}`}
          aria-label={p.pinned_at ? `Quitar ${p.name} del ancla` : `Anclar ${p.name} arriba`}
          aria-pressed={!!p.pinned_at}
          title={p.pinned_at ? "Quitar del ancla" : "Anclar arriba"}
          onClick={() => editar.mutate({ pinned: !p.pinned_at })}
          disabled={editar.isPending}
        >
          <svg {...ICONO}>
            <path d="M12 17v5" />
            <path d="M9 10.76V6a3 3 0 0 1 6 0v4.76l2.5 2.5V15h-11v-1.74z" />
          </svg>
        </button>
        <button
          type="button"
          className="proyecto-icono is-peligro"
          aria-label={`Eliminar ${p.name}`}
          title="Eliminar"
          onClick={() => setConfirmarBorrar(true)}
          disabled={quitar.isPending || confirmarBorrar}
        >
          <svg {...ICONO}>
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
          </svg>
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
