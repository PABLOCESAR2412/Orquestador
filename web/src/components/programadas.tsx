import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Programada, type ProgramadaInput } from "../api";
import { EffortControl } from "./controls";
import { errorText } from "../lib/model";
import { cuando } from "./tarea-formato";

const MAX_PROMPT = 10_000;
const MAX_TITULO = 80;
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

// "Cada 6 horas" o "Diaria a las 08:00".
export function frecuenciaTexto(p: Programada): string {
  if (p.frecuencia === "diaria") return `Diaria a las ${p.hora ?? ""}`;
  const n = p.cada_horas ?? 0;
  return `Cada ${n} ${n === 1 ? "hora" : "horas"}`;
}

// Sección de tareas programadas dentro de Tareas. El servidor las lanza aunque la app esté cerrada.
export function ProgramadasPanel() {
  const qc = useQueryClient();
  const [formAbierto, setFormAbierto] = useState(false);
  const [lanzada, setLanzada] = useState<{ programada: string; tarea: string } | null>(null);

  const programadas = useQuery({ queryKey: ["programadas"], queryFn: api.listProgramadas });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const nombreModelo = (id: string) => modelList.find((m) => m.id === id)?.name ?? id;

  const refrescar = () => void qc.invalidateQueries({ queryKey: ["programadas"] });

  const alternar = useMutation({
    mutationFn: (p: Programada) => api.updateProgramada(p.id, { activa: !p.activa }),
    onSettled: refrescar,
  });

  const ejecutar = useMutation({
    mutationFn: (p: Programada) => api.runProgramada(p.id),
    onSuccess: (tarea, p) => {
      setLanzada({ programada: p.id, tarea: tarea.id });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onSettled: refrescar,
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.deleteProgramada(id),
    onSettled: refrescar,
  });

  const [confirmarId, setConfirmarId] = useState<string | null>(null);

  return (
    <section className="panel tarea-seccion" aria-labelledby="programadas-titulo">
      <div className="card-top">
        <h2 id="programadas-titulo">Programadas</h2>
        <button type="button" className="ghost task-mini-btn" onClick={() => setFormAbierto((o) => !o)} aria-expanded={formAbierto}>
          {formAbierto ? "Cerrar" : "Nueva programada"}
        </button>
      </div>
      <p className="muted-note">El servidor lanza estas tareas a su hora, aunque cierres la app.</p>

      {programadas.isError && (
        <p className="error" role="alert">
          {errorText(programadas.error)}
        </p>
      )}
      {programadas.data?.length === 0 && <p className="muted-note">Todavía no hay tareas programadas.</p>}

      {programadas.data && programadas.data.length > 0 && (
        <ul className="programadas-lista">
          {programadas.data.map((p) => (
            <li key={p.id} className={`programada${p.activa ? "" : " is-pausada"}`}>
              <div className="programada-info">
                <span className="programada-titulo">{p.titulo || "Sin título"}</span>
                <span className="programada-meta">
                  {frecuenciaTexto(p)} · {nombreModelo(p.model)}
                  {p.project_name ? ` · ${p.project_name}` : ""}
                </span>
                <span className="programada-meta">
                  {p.activa ? `Próxima: ${cuando(p.proxima_en)}` : "En pausa"}
                  {p.ultima_ejecucion ? ` · Última: ${cuando(p.ultima_ejecucion)}` : ""}
                </span>
                {p.ultima_tarea_id && (
                  <Link to="/tareas/$id" params={{ id: p.ultima_tarea_id }} className="foot-link">
                    Ver última tarea
                  </Link>
                )}
                {lanzada?.programada === p.id && (
                  <span className="programada-meta" role="status">
                    Tarea lanzada.{" "}
                    <Link to="/tareas/$id" params={{ id: lanzada.tarea }} className="foot-link">
                      Ver tarea
                    </Link>
                  </span>
                )}
              </div>

              <div className="programada-acciones">
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.activa}
                  className="programada-switch"
                  disabled={alternar.isPending && alternar.variables?.id === p.id}
                  onClick={() => alternar.mutate(p)}
                >
                  <span className="programada-switch-pista" aria-hidden="true">
                    <span className="programada-switch-bola" />
                  </span>
                  {p.activa ? "Activa" : "Pausada"}
                </button>

                <button
                  type="button"
                  className="ghost task-mini-btn"
                  disabled={ejecutar.isPending && ejecutar.variables?.id === p.id}
                  onClick={() => ejecutar.mutate(p)}
                >
                  {ejecutar.isPending && ejecutar.variables?.id === p.id ? "Lanzando…" : "Ejecutar ahora"}
                </button>

                {confirmarId === p.id ? (
                  <div className="programada-confirmar">
                    <span>¿Eliminar esta programada? Las tareas que ya creó se conservan.</span>
                    <div className="programada-confirmar-acciones">
                      <button
                        type="button"
                        className="danger-solid task-mini-btn"
                        disabled={eliminar.isPending}
                        onClick={() => {
                          eliminar.mutate(p.id);
                          setConfirmarId(null);
                        }}
                      >
                        Sí, eliminar
                      </button>
                      <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarId(null)}>
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="ghost task-mini-btn" onClick={() => setConfirmarId(p.id)}>
                    Eliminar
                  </button>
                )}
              </div>

              {alternar.isError && alternar.variables?.id === p.id && (
                <p className="error" role="alert">
                  {errorText(alternar.error)}
                </p>
              )}
              {ejecutar.isError && ejecutar.variables?.id === p.id && (
                <p className="error" role="alert">
                  {errorText(ejecutar.error)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {eliminar.isError && (
        <p className="error" role="alert">
          {errorText(eliminar.error)}
        </p>
      )}

      {formAbierto && <FormProgramada alCrear={() => setFormAbierto(false)} modelList={modelList} />}
    </section>
  );
}

function FormProgramada({ alCrear, modelList }: { alCrear: () => void; modelList: ModelInfo[] }) {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const recomendados: { id: string; name: string }[] = modelList
    .filter((m) => m.recommended)
    .map((m) => ({ id: m.id, name: m.name }));
  const [titulo, setTitulo] = useState("");
  const [prompt, setPrompt] = useState("");
  // undefined: sin elegir (usa el de Ajustes). null: "Predeterminado de Ajustes" elegido a mano.
  const [modelo, setModelo] = useState<string | null | undefined>(undefined);
  const [effort, setEffort] = useState<string | null>(null);
  const [proyecto, setProyecto] = useState("");
  const [frecuencia, setFrecuencia] = useState<"cada_horas" | "diaria">("cada_horas");
  const [horas, setHoras] = useState("6");
  const [hora, setHora] = useState("08:00");
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // El modelo inicial es el de Ajustes; si no está en la lista de recomendados, se muestra igual.
  const modeloActual = modelo !== undefined ? (modelo ?? "") : (prefs.data?.defaultModel ?? "");
  const modeloInfo = modelList.find((m) => m.id === modeloActual) ?? null;
  const variantes = modeloInfo?.variants ?? [];
  const opcionesModelo = [...recomendados];
  if (modeloActual && !opcionesModelo.some((m) => m.id === modeloActual)) {
    opcionesModelo.unshift({ id: modeloActual, name: modeloInfo?.name ?? modeloActual });
  }

  const crear = useMutation({
    mutationFn: (body: ProgramadaInput) => api.createProgramada(body),
    onSuccess: () => {
      setTitulo("");
      setPrompt("");
      setErrorLocal(null);
      void qc.invalidateQueries({ queryKey: ["programadas"] });
      alCrear();
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setErrorLocal(null);
    const texto = prompt.trim();
    if (!texto || texto.length > MAX_PROMPT) {
      setErrorLocal(`El prompt debe tener entre 1 y ${MAX_PROMPT.toLocaleString("es")} caracteres.`);
      return;
    }
    const base = {
      titulo: titulo.trim() || undefined,
      prompt: texto,
      model: modeloActual || null,
      effort: modeloActual && effort ? effort : null,
      projectId: proyecto || null,
    };
    if (frecuencia === "cada_horas") {
      const n = Number(horas);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        setErrorLocal("Escribe un número de horas entre 1 y 168.");
        return;
      }
      crear.mutate({ ...base, frecuencia: "cada_horas", cada_horas: n });
    } else {
      if (!HORA_VALIDA.test(hora)) {
        setErrorLocal("Escribe una hora en formato HH:MM.");
        return;
      }
      crear.mutate({ ...base, frecuencia: "diaria", hora });
    }
  };

  return (
    <form className="programada-form" onSubmit={enviar} aria-label="Nueva tarea programada">
      <div className="campo">
        <label className="field-label" htmlFor="programada-titulo">
          Título
        </label>
        <input
          id="programada-titulo"
          className="text-input tarea-campo-ancho"
          maxLength={MAX_TITULO}
          placeholder="Opcional"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
      </div>

      <div className="campo">
        <label className="field-label" htmlFor="programada-prompt">
          Prompt
        </label>
        <textarea
          id="programada-prompt"
          className="tarea-textarea"
          rows={4}
          maxLength={MAX_PROMPT}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Qué debe hacer el agente en cada ejecución"
        />
        <span className="muted-note" aria-live="polite">
          {prompt.length.toLocaleString("es")} / {MAX_PROMPT.toLocaleString("es")}
        </span>
      </div>

      <div className="campo">
        <label className="field-label" htmlFor="programada-modelo">
          Modelo
        </label>
        <select
          id="programada-modelo"
          className="tarea-select"
          value={modeloActual}
          onChange={(e) => {
            const nuevo = e.target.value || null;
            setModelo(nuevo);
            const info = modelList.find((m) => m.id === nuevo);
            if (!info || !info.variants.includes(effort ?? "")) setEffort(null);
          }}
        >
          <option value="">Predeterminado de Ajustes</option>
          {opcionesModelo.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {variantes.length > 0 && (
        <div className="campo">
          <span className="field-label">Esfuerzo</span>
          <EffortControl variants={variantes} value={effort} disabled={!modeloActual} onChange={setEffort} />
        </div>
      )}

      <div className="campo">
        <label className="field-label" htmlFor="programada-proyecto">
          Proyecto
        </label>
        <select
          id="programada-proyecto"
          className="tarea-select"
          value={proyecto}
          onChange={(e) => setProyecto(e.target.value)}
        >
          <option value="">Sin proyecto</option>
          {proyectos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="tarea-fieldset">
        <legend className="field-label">Frecuencia</legend>
        <label className="tarea-opcion">
          <input
            type="radio"
            name="programada-frecuencia"
            checked={frecuencia === "cada_horas"}
            onChange={() => setFrecuencia("cada_horas")}
          />
          <span>Cada cierto número de horas</span>
        </label>
        {frecuencia === "cada_horas" && (
          <div className="campo campo-anidado">
            <label className="field-label" htmlFor="programada-horas">
              Horas (1 a 168)
            </label>
            <input
              id="programada-horas"
              className="text-input tarea-campo-corto"
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              step={1}
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
            />
          </div>
        )}

        <label className="tarea-opcion">
          <input
            type="radio"
            name="programada-frecuencia"
            checked={frecuencia === "diaria"}
            onChange={() => setFrecuencia("diaria")}
          />
          <span>Una vez al día</span>
        </label>
        {frecuencia === "diaria" && (
          <div className="campo campo-anidado">
            <label className="field-label" htmlFor="programada-hora">
              Hora (HH:MM, hora del servidor)
            </label>
            <input
              id="programada-hora"
              className="text-input tarea-campo-corto"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </div>
        )}
      </fieldset>

      {(errorLocal || crear.isError) && (
        <p className="error" role="alert">
          {errorLocal ?? errorText(crear.error)}
        </p>
      )}

      <div className="savebar">
        <button type="submit" className="primary" disabled={crear.isPending || !prompt.trim()}>
          {crear.isPending ? "Creando…" : "Crear programada"}
        </button>
      </div>
    </form>
  );
}
