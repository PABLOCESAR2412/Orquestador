import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { errorText } from "../lib/model";

const LIMITE_BYTES = 64 * 1024;

// Lista y editor de skills. Sin projectId trabaja con las globales; con projectId, con las del proyecto.
// El nombre de la carpeta es la clave: no hay renombrado, se crea de nuevo y se quita la anterior.
export function SkillsEditor({ projectId, ayuda, titulo }: { projectId?: string; ayuda: string; titulo?: string }) {
  const qc = useQueryClient();
  const ambito = projectId ?? "global";
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [comandoNuevo, setComandoNuevo] = useState("");
  const [borrador, setBorrador] = useState("");
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);
  const instalando = useRef(false);

  const lista = useQuery({ queryKey: ["skills", ambito], queryFn: () => api.listSkills(projectId) });
  const detalle = useQuery({
    queryKey: ["skill", ambito, seleccion],
    queryFn: () => api.getSkill(seleccion ?? "", projectId),
    enabled: seleccion !== null,
  });

  const instalar = useMutation({
    mutationFn: () => api.installSkill(comandoNuevo.trim(), projectId),
    onSuccess: () => {
      setCreando(false);
      setComandoNuevo("");
      refrescar();
    },
    onSettled: () => { instalando.current = false; },
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
    onSuccess: refrescar,
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
  const cambiado = detalle.data ? borrador !== detalle.data.contenido : false;

  function abrir(nombre: string) {
    setSeleccion(nombre);
    setConfirmandoQuitar(false);
    guardar.reset();
    quitar.reset();
  }

  function empezarNueva() {
    if (!comandoNuevo.trim() || instalando.current) return;
    instalando.current = true;
    instalar.mutate();
  }

  function descartar() {
    if (detalle.data) setBorrador(detalle.data.contenido);
  }

  const editorVisible = seleccion !== null && detalle.data !== undefined;

  return (
    <div className="skills">
      <div className="skills-cabecera">
        <div>
          {titulo && <h2 className="panel-title">{titulo}</h2>}
          <p className="aj-nota">{ayuda}</p>
        </div>
        {!creando && (
          <button
            type="button"
            className="aj-btn aj-btn-primario"
            onClick={() => {
              setCreando(true);
              setComandoNuevo("");
              instalar.reset();
            }}
          >
            Nueva skill
          </button>
        )}
      </div>

      {creando && (
        <div className="skills-nueva" style={{ marginTop: 16 }}>
          <label className="skills-etiqueta" htmlFor={`skills-comando-${ambito}`}>
            Comando de instalación
          </label>
            <input
              id={`skills-comando-${ambito}`}
              className="skills-entrada"
              disabled={instalar.isPending}
              value={comandoNuevo}
              placeholder="npx skills add openai/skills --skill playwright"
              onChange={(e) => setComandoNuevo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  empezarNueva();
                }
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={`skills-comando-ayuda-${ambito}`}
            />
          <p id={`skills-comando-ayuda-${ambito}`} className="aj-nota">
            Pega el comando de skills.sh. Telo descarga solo el archivo SKILL.md y no ejecuta el comando ni scripts.
          </p>
          {instalar.isError && (
            <p className="aj-error" role="alert" style={{ marginTop: 8 }}>
              {errorText(instalar.error)}
            </p>
          )}

          <div className="instalar-acciones" style={{ marginTop: 16 }}>
            <button type="button" className="aj-btn aj-btn-primario" disabled={!comandoNuevo.trim() || instalar.isPending} onClick={empezarNueva}>
              {instalar.isPending ? "Instalando…" : "Instalar skill"}
            </button>
            <button
              type="button"
              className="aj-btn"
              disabled={instalar.isPending}
              onClick={() => {
                setCreando(false);
                instalar.reset();
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
              <button type="button" className="aj-texto-btn skills-peligro" onClick={() => setConfirmandoQuitar(true)}>
                Quitar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
