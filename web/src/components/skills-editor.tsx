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
export function SkillsEditor({ projectId, ayuda, titulo }: { projectId?: string; ayuda: string; titulo?: string }) {
  const qc = useQueryClient();
  const ambito = projectId ?? "global";
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [contenidoNuevo, setContenidoNuevo] = useState("");
  const [urlNueva, setUrlNueva] = useState("");
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);

  const lista = useQuery({ queryKey: ["skills", ambito], queryFn: () => api.listSkills(projectId) });
  const detalle = useQuery({
    queryKey: ["skill", ambito, seleccion],
    queryFn: () => api.getSkill(seleccion ?? "", projectId),
    enabled: seleccion !== null && !nueva,
  });

  const buscarCatalogo = useMutation({
    mutationFn: () => api.searchSkills(nombreNuevo.trim()),
  });

  const importarUrl = useMutation({
    mutationFn: (url: string) => {
      if (!projectId) throw new Error("Importar por URL solo está disponible para proyectos");
      return api.saveProjectSkill(projectId, { url });
    },
    onSuccess: () => {
      setCreando(false);
      setNombreNuevo("");
      setContenidoNuevo("");
      setUrlNueva("");
      refrescar();
    },
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

  const guardarCreada = useMutation({
    mutationFn: (datos: { nombre: string; contenido: string }) =>
      api.saveSkill(datos.nombre, datos.contenido, projectId),
    onSuccess: (_, variables) => {
      setCreando(false);
      setNombreNuevo("");
      setContenidoNuevo("");
      setUrlNueva("");
      refrescar();
      abrir(variables.nombre);
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
    if (urlNueva.trim()) {
      let u = urlNueva.trim();
      u = u.replace(/[?#].*$/, "").replace(/\/+$/, "");
      importarUrl.mutate(u);
      return;
    }

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

    if (contenidoNuevo.trim()) {
      const contenidoFinal = contenidoNuevo.startsWith("---")
        ? contenidoNuevo
        : `---\nname: ${nombre}\ndescription: ${nombre}\n---\n\n${contenidoNuevo}`;
      guardarCreada.mutate({ nombre, contenido: contenidoFinal });
      return;
    }

    setCreando(false);
    setNombreNuevo("");
    setContenidoNuevo("");
    setUrlNueva("");
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
      <div className="skills-cabecera" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          {titulo && <h2 className="panel-title" style={{ margin: "0 0 6px 0" }}>{titulo}</h2>}
          <p className="aj-nota" style={{ margin: 0 }}>{ayuda}</p>
        </div>
        {!creando && (
          <button
            type="button"
            className="aj-btn aj-btn-primario"
            style={{ whiteSpace: "nowrap" }}
            onClick={() => {
              setCreando(true);
              setNombreNuevo("");
              setContenidoNuevo("");
              setUrlNueva("");
              setErrorNombre(null);
              buscarCatalogo.reset();
            }}
          >
            Nueva skill
          </button>
        )}
      </div>

      {creando && (
        <div className="skills-nueva" style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 8, padding: 16 }}>
          <label className="skills-etiqueta" htmlFor="skills-nombre">
            Nombre de la skill
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              id="skills-nombre"
              className="skills-entrada"
              style={{ flex: "1 1 200px" }}
              value={nombreNuevo}
              placeholder="por-ejemplo-ssh"
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
            <button
              type="button"
              className="aj-btn"
              disabled={!nombreNuevo.trim() || buscarCatalogo.isPending}
              onClick={() => buscarCatalogo.mutate()}
            >
              {buscarCatalogo.isPending ? "Buscando…" : "Buscar en catálogos oficiales"}
            </button>
          </div>
          <p id="skills-nombre-ayuda" className="aj-nota">
            Minúsculas, números y guiones. Será el nombre de la carpeta de la skill.
          </p>

          {buscarCatalogo.isSuccess && buscarCatalogo.data.length === 0 && (
            <p className="aj-nota" style={{ color: "var(--text-muted)" }}>
              Sin coincidencias en los catálogos oficiales. Puedes escribir tus instrucciones o importar desde una URL.
            </p>
          )}

          {buscarCatalogo.data && buscarCatalogo.data.length > 0 && (
            <div style={{ margin: "12px 0", maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}>
              {buscarCatalogo.data.map((s) => (
                <div key={s.url} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <button
                    type="button"
                    className="aj-btn"
                    style={{ fontSize: 12, padding: "2px 8px" }}
                    disabled={importarUrl.isPending}
                    onClick={() => importarUrl.mutate(s.url)}
                  >
                    Instalar {s.name}
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="skills-etiqueta" htmlFor="skills-contenido-nuevo" style={{ marginTop: 12 }}>
            Instrucciones o prompt (opcional si usas plantilla)
          </label>
          <textarea
            id="skills-contenido-nuevo"
            className="skills-texto"
            rows={4}
            value={contenidoNuevo}
            onChange={(e) => setContenidoNuevo(e.target.value)}
            placeholder="Pega aquí el contenido o las instrucciones paso a paso de la skill..."
            spellCheck={false}
          />

          <label className="skills-etiqueta" htmlFor="skills-url-nueva" style={{ marginTop: 12 }}>
            URL del SKILL.md en GitHub (opcional)
          </label>
          <input
            id="skills-url-nueva"
            className="skills-entrada"
            type="url"
            value={urlNueva}
            onChange={(e) => setUrlNueva(e.target.value)}
            placeholder="https://github.com/… (enlace a archivo SKILL.md o a la carpeta del skill)"
          />

          {errorNombre && (
            <p className="aj-error" role="alert" style={{ marginTop: 8 }}>
              {errorNombre}
            </p>
          )}
          {importarUrl.isError && (
            <p className="aj-error" role="alert" style={{ marginTop: 8 }}>
              {errorText(importarUrl.error)}
            </p>
          )}
          {guardarCreada.isError && (
            <p className="aj-error" role="alert" style={{ marginTop: 8 }}>
              {errorText(guardarCreada.error)}
            </p>
          )}

          <div className="instalar-acciones" style={{ marginTop: 16 }}>
            {urlNueva.trim() ? (
              <button
                type="button"
                className="aj-btn aj-btn-primario"
                disabled={importarUrl.isPending}
                onClick={empezarNueva}
              >
                {importarUrl.isPending ? "Importando…" : "Importar skill desde GitHub"}
              </button>
            ) : (
              <button
                type="button"
                className="aj-btn aj-btn-primario"
                disabled={!nombreNuevo.trim() || guardarCreada.isPending}
                onClick={empezarNueva}
              >
                {guardarCreada.isPending ? "Guardando…" : "Crear skill"}
              </button>
            )}
            <button
              type="button"
              className="aj-btn"
              onClick={() => {
                setCreando(false);
                setErrorNombre(null);
                buscarCatalogo.reset();
              }}
            >
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
