import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { LoadingSkeleton } from "./loading-skeleton";
import { errorText } from "../lib/model";

const LIMITE_BYTES = 64 * 1024;
const PLANTILLA_SKILL = `---
name: nueva-skill
description: Explica qué resuelve esta skill y cuándo debe activarse, con ejemplos concretos de solicitudes.
---

# Objetivo

Describe el resultado que debe producir.

## Entradas

- Datos necesarios y dónde encontrarlos.

## Procedimiento

1. Revisa el contexto y los patrones existentes.
2. Ejecuta los pasos necesarios para resolver la tarea.
3. Comprueba el resultado con evidencia observable.

## Criterios de éxito

- Define qué debe quedar listo y cómo verificarlo.

## Límites y casos especiales

- Explica qué hacer si falta información, hay contradicciones o el pedido queda fuera del alcance.
`;

function nombreDesdeFrontmatter(texto: string): string | null {
  const cabecera = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texto)?.[1];
  const nombre = cabecera && /(?:^|\r?\n)name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:\r?\n|$)/.exec(cabecera)?.[1];
  return nombre ?? null;
}

// Lista y editor de skills. Sin projectId trabaja con las globales; con projectId, con las del proyecto.
// El nombre de la carpeta es la clave: no hay renombrado, se crea de nuevo y se quita la anterior.
export function SkillsEditor({ projectId, ayuda, titulo }: { projectId?: string; ayuda: string; titulo?: string }) {
  const qc = useQueryClient();
  const ambito = projectId ?? "global";
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [modoNueva, setModoNueva] = useState<"propia" | "instalar">("instalar");
  const [comandoNuevo, setComandoNuevo] = useState("");
  const [contenidoNuevo, setContenidoNuevo] = useState("");
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

  const nombreNuevo = nombreDesdeFrontmatter(contenidoNuevo);
  const bytesNuevo = new TextEncoder().encode(contenidoNuevo).length;
  const nombreYaExiste = Boolean(nombreNuevo && lista.data?.skills.some((s) => s.nombre === nombreNuevo));
  const crearPropia = useMutation({
    mutationFn: () => api.saveSkill(nombreNuevo!, contenidoNuevo, projectId),
    onSuccess: async () => {
      const nombre = nombreNuevo!;
      setCreando(false);
      setSeleccion(nombre);
      setContenidoNuevo("");
      void qc.invalidateQueries({ queryKey: ["skills", ambito] });
      await qc.invalidateQueries({ queryKey: ["skill", ambito, nombre] });
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
              setModoNueva("instalar");
              setComandoNuevo("");
              setContenidoNuevo("");
              instalar.reset();
              crearPropia.reset();
            }}
          >
            Nueva skill
          </button>
        )}
      </div>

      {creando && (
        <div className="skills-nueva" style={{ marginTop: 16 }}>
          <div className="skills-modos" role="group" aria-label="Cómo añadir una skill">
            <button type="button" className={`aj-btn${modoNueva === "propia" ? " aj-btn-primario" : ""}`} aria-pressed={modoNueva === "propia"} onClick={() => setModoNueva("propia")}>
              Crear desde propuesta
            </button>
            <button type="button" className={`aj-btn${modoNueva === "instalar" ? " aj-btn-primario" : ""}`} aria-pressed={modoNueva === "instalar"} onClick={() => setModoNueva("instalar")}>
              Instalar desde catálogo
            </button>
          </div>
          {modoNueva === "propia" ? (
            <>
              <p className="aj-nota">
                Pega el borrador de <code>SKILL.md</code> que preparó el agente. Revísalo y guárdalo solo cuando estés conforme; las pruebas sugeridas no cuentan como ejecutadas.
              </p>
              <div className="skills-nueva-acciones">
                <span className="skills-peso">{Math.round((bytesNuevo / 1024) * 10) / 10} / 64 KB</span>
                <button type="button" className="aj-btn" onClick={() => { setContenidoNuevo(PLANTILLA_SKILL); crearPropia.reset(); }}>
                  Usar plantilla
                </button>
              </div>
              <textarea
                className="skills-texto"
                aria-label="Borrador de SKILL.md"
                value={contenidoNuevo}
                onChange={(e) => { setContenidoNuevo(e.target.value); crearPropia.reset(); }}
                spellCheck={false}
                autoCapitalize="none"
              />
              {!nombreNuevo && contenidoNuevo && <p className="aj-error" role="alert">El bloque inicial debe incluir un nombre válido en el campo <code>name</code>.</p>}
              {nombreYaExiste && <p className="aj-error" role="alert">Ya existe la skill <code>{nombreNuevo}</code>. Ábrela en la lista para editarla sin reemplazarla por accidente.</p>}
              {bytesNuevo > LIMITE_BYTES && <p className="aj-error" role="alert">El borrador supera el límite de 64 KB. Reduce el contenido antes de guardarlo.</p>}
              {crearPropia.isError && <p className="aj-error" role="alert">{errorText(crearPropia.error)}</p>}
              <details className="skills-revision">
                <summary>Lista de revisión antes de guardar</summary>
                <ul>
                  <li>La descripción explica cuándo se activa y cuándo no.</li>
                  <li>La skill tiene un objetivo único, pasos claros y criterios de éxito verificables.</li>
                  <li>Incluye límites y casos normales y excepcionales; los detalles opcionales no inflan el flujo principal.</li>
                  <li>Prueba por separado el disparador y la ejecución con los modelos previstos, e informa solo resultados reales.</li>
                </ul>
              </details>
              <div className="instalar-acciones">
                <button type="button" className="aj-btn aj-btn-primario" disabled={!nombreNuevo || nombreYaExiste || !contenidoNuevo.trim() || bytesNuevo > LIMITE_BYTES || crearPropia.isPending} onClick={() => crearPropia.mutate()}>
                  {crearPropia.isPending ? "Guardando…" : "Guardar skill revisada"}
                </button>
                <button type="button" className="aj-btn" disabled={crearPropia.isPending} onClick={() => { setCreando(false); setContenidoNuevo(""); crearPropia.reset(); }}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {lista.isPending && !lista.data && <LoadingSkeleton tipo="lineas" cantidad={3} />}
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

          <details className="skills-revision">
            <summary>Lista de revisión de esta skill</summary>
            <ul>
              <li>El disparador coincide con solicitudes concretas y evita las parecidas fuera de alcance.</li>
              <li>El procedimiento termina en verificaciones observables y cubre errores o datos faltantes.</li>
              <li>El archivo principal se mantiene conciso y no incluye instrucciones condicionales que rara vez se usan.</li>
              <li>Se comprueba la activación y el resultado real con los modelos que usarás.</li>
            </ul>
          </details>

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
