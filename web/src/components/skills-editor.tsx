import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { errorText } from "../lib/model";

// Mismo patrón que exige OpenCode y que valida el servidor (src/skills.ts). Aquí solo sirve para avisar antes.
const NOMBRE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LIMITE_BYTES = 64 * 1024;

function plantilla(nombre: string): string {
  return `---\nname: ${nombre}\ndescription: Di qué hace esta skill y cuándo debe usarla el agente.\n---\n\n# ${nombre}\n\nInstrucciones paso a paso.\n`;
}

// Lista y editor de skills. Sin projectId trabaja con las globales; con projectId, con las del proyecto.
// El nombre de la carpeta es la clave: no hay renombrado, se crea de nuevo y se quita la anterior.
export function SkillsEditor({ projectId, ayuda }: { projectId?: string; ayuda: string }) {
  const qc = useQueryClient();
  const ambito = projectId ?? "global";
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);

  const lista = useQuery({ queryKey: ["skills", ambito], queryFn: () => api.listSkills(projectId) });
  const detalle = useQuery({
    queryKey: ["skill", ambito, seleccion],
    queryFn: () => api.getSkill(seleccion ?? "", projectId),
    enabled: seleccion !== null && !nueva,
  });

  // Al llegar el contenido guardado, el borrador empieza igual que el archivo.
  useEffect(() => {
    if (detalle.data) setBorrador(detalle.data.contenido);
  }, [detalle.data]);

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["skills", ambito] });
    if (seleccion) void qc.invalidateQueries({ queryKey: ["skill", ambito, seleccion] });
  };

  const guardar = useMutation({
    mutationFn: () => api.saveSkill(seleccion ?? "", borrador, projectId),
    onSuccess: () => {
      setNueva(false);
      refrescar();
    },
  });

  const quitar = useMutation({
    mutationFn: () => api.deleteSkill(seleccion ?? "", projectId),
    onSuccess: () => {
      setSeleccion(null);
      setConfirmandoQuitar(false);
      void qc.invalidateQueries({ queryKey: ["skills", ambito] });
    },
  });

  const bytes = new TextEncoder().encode(borrador).length;
  const cambiado = nueva || (detalle.data ? borrador !== detalle.data.contenido : false);

  function abrir(nombre: string) {
    setSeleccion(nombre);
    setNueva(false);
    setConfirmandoQuitar(false);
    guardar.reset();
    quitar.reset();
  }

  function empezarNueva() {
    const nombre = nombreNuevo.trim();
    if (!NOMBRE.test(nombre) || nombre.length > 64) {
      setErrorNombre(errorText(new ApiError(400, "skill_nombre_invalido")));
      return;
    }
    if (lista.data?.skills.some((s) => s.nombre === nombre)) {
      setErrorNombre("Ya hay una skill con ese nombre. Ábrela desde la lista.");
      return;
    }
    setErrorNombre(null);
    setCreando(false);
    setNombreNuevo("");
    setSeleccion(nombre);
    setNueva(true);
    setBorrador(plantilla(nombre));
  }

  function descartar() {
    if (nueva) {
      setSeleccion(null);
      setNueva(false);
      return;
    }
    if (detalle.data) setBorrador(detalle.data.contenido);
  }

  const editorVisible = seleccion !== null && (nueva || detalle.data !== undefined);

  return (
    <div className="skills">
      <div className="skills-cabecera">
        <p className="aj-nota">{ayuda}</p>
        {!creando && (
          <button type="button" className="aj-btn" onClick={() => setCreando(true)}>
            Nueva skill
          </button>
        )}
      </div>

      {creando && (
        // Sin <form>: la página de Ajustes ya es un formulario, y un formulario anidado no es válido.
        <div className="skills-nueva">
          <label className="skills-etiqueta" htmlFor="skills-nombre">
            Nombre de la skill
          </label>
          <input
            id="skills-nombre"
            className="skills-entrada"
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                empezarNueva();
              }
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="skills-nombre-ayuda"
          />
          <p id="skills-nombre-ayuda" className="aj-nota">
            Minúsculas, números y guiones. Será el nombre de la carpeta.
          </p>
          {errorNombre && (
            <p className="aj-error" role="alert">
              {errorNombre}
            </p>
          )}
          <div className="instalar-acciones">
            <button type="button" className="aj-btn aj-btn-primario" onClick={empezarNueva}>
              Crear
            </button>
            <button type="button" className="aj-btn" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {lista.isPending && <p className="aj-nota">Cargando skills…</p>}
      {lista.isError && (
        <p className="aj-error" role="alert">
          {errorText(lista.error)}
        </p>
      )}
      {lista.data && lista.data.skills.length === 0 && !creando && <p className="aj-nota">Todavía no hay skills.</p>}
      {lista.data && lista.data.skills.length > 0 && (
        <ul className="skills-lista" aria-label="Skills">
          {lista.data.skills.map((s) => (
            <li key={s.nombre}>
              <button
                type="button"
                className={`skills-fila${seleccion === s.nombre ? " is-activa" : ""}`}
                aria-pressed={seleccion === s.nombre}
                onClick={() => abrir(s.nombre)}
              >
                <span className="skills-fila-nombre">{s.nombre}</span>
                <span className={`skills-fila-texto${s.valida ? "" : " is-aviso"}`}>
                  {s.valida ? s.descripcion : "No válida: OpenCode no la carga hasta corregir la cabecera."}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {seleccion !== null && !editorVisible && detalle.isError && (
        <p className="aj-error" role="alert">
          {errorText(detalle.error)}
        </p>
      )}

      {editorVisible && (
        <div className="skills-editor">
          <div className="skills-editor-cabecera">
            <h3 className="skills-editor-titulo">{seleccion}</h3>
            {nueva && <span className="aj-etiqueta">Sin guardar</span>}
          </div>
          <label className="skills-etiqueta" htmlFor="skills-contenido">
            <span>Contenido de SKILL.md</span>
            <span className={`skills-peso${bytes > LIMITE_BYTES ? " is-aviso" : ""}`}>
              {Math.round((bytes / 1024) * 10) / 10} / 64 KB
            </span>
          </label>
          <textarea
            id="skills-contenido"
            className="skills-texto"
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
          />

          {guardar.isError && (
            <p className="aj-error" role="alert">
              {errorText(guardar.error)}
            </p>
          )}
          {quitar.isError && (
            <p className="aj-error" role="alert">
              {errorText(quitar.error)}
            </p>
          )}
          {guardar.isSuccess && !cambiado && (
            <p className="aj-nota" role="status">
              Guardada. Los agentes la usan desde su siguiente turno.
            </p>
          )}

          {confirmandoQuitar ? (
            <div className="instalar-confirmar" role="group" aria-label="Confirmar quitar la skill">
              <p className="aj-nota">¿Quitar esta skill? Se borra su archivo y los agentes dejan de usarla.</p>
              <div className="instalar-acciones">
                <button type="button" className="aj-btn skills-peligro" disabled={quitar.isPending} onClick={() => quitar.mutate()}>
                  Quitar
                </button>
                <button type="button" className="aj-btn" onClick={() => setConfirmandoQuitar(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="instalar-acciones">
              <button
                type="button"
                className="aj-btn aj-btn-primario"
                disabled={!cambiado || guardar.isPending || bytes > LIMITE_BYTES}
                onClick={() => guardar.mutate()}
              >
                {guardar.isPending ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" className="aj-btn" disabled={!cambiado || guardar.isPending} onClick={descartar}>
                Descartar
              </button>
              {!nueva && (
                <button type="button" className="aj-texto-btn skills-peligro" onClick={() => setConfirmandoQuitar(true)}>
                  Quitar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
