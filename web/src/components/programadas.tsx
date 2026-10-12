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

export function frecuenciaTexto(p: Programada): string {
  if (p.frecuencia === "diaria") return `Diaria a las ${p.hora ?? ""}`;
  const n = p.cada_horas ?? 0;
  return `Cada ${n} ${n === 1 ? "hora" : "horas"}`;
}

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
    <section className="panel" aria-labelledby="programadas-titulo">
      <div className="panel-header-row">
        <h2 id="programadas-titulo" className="panel-title">
          Programadas
        </h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setFormAbierto((o) => !o)}
          aria-expanded={formAbierto}
        >
          {formAbierto ? "Cerrar" : "Nueva programada"}
        </button>
      </div>

      {formAbierto && <FormProgramada alCrear={() => setFormAbierto(false)} modelList={modelList} />}

      {programadas.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(programadas.error)}</span>
        </div>
      )}

      {programadas.data?.length === 0 && !formAbierto && (
        <p className="help-note">Todavía no hay tareas programadas.</p>
      )}

      {programadas.data && programadas.data.length > 0 && (
        <div className="sched-list">
          {programadas.data.map((p) => (
            <div key={p.id} className="sched-row">
              <div className="sched-main">
                <span className="sched-title">{p.titulo || "Sin título"}</span>
                <div className="sched-meta">
                  <span>Frecuencia: {frecuenciaTexto(p)}</span>
                  <span>{p.activa ? `Próxima: ${cuando(p.proxima_en)}` : "En pausa"}</span>
                  {p.project_name && <span>Proyecto: {p.project_name}</span>}
                  <span>Modelo: {nombreModelo(p.model)}</span>
                  {p.ultima_tarea_id && (
                    <Link to="/tareas/$id" params={{ id: p.ultima_tarea_id }} style={{ color: "var(--ink)" }}>
                      Ver última tarea
                    </Link>
                  )}
                  {lanzada?.programada === p.id && (
                    <span role="status" style={{ color: "var(--ink)" }}>
                      Tarea lanzada.{" "}
                      <Link to="/tareas/$id" params={{ id: lanzada.tarea }}>
                        Ver tarea
                      </Link>
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span className={`badge-status${p.activa ? " active" : ""}`}>
                  {p.activa ? "Activa" : "Pausada"}
                </span>

                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  disabled={alternar.isPending && alternar.variables?.id === p.id}
                  onClick={() => alternar.mutate(p)}
                >
                  {p.activa ? "Pausar" : "Reanudar"}
                </button>

                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  disabled={ejecutar.isPending && ejecutar.variables?.id === p.id}
                  onClick={() => ejecutar.mutate(p)}
                >
                  {ejecutar.isPending && ejecutar.variables?.id === p.id ? "Lanzando…" : "Ejecutar"}
                </button>

                {confirmarId === p.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ background: "var(--danger)", color: "#fff", padding: "4px 8px", fontSize: 12 }}
                      disabled={eliminar.isPending}
                      onClick={() => {
                        eliminar.mutate(p.id);
                        setConfirmarId(null);
                      }}
                    >
                      Sí
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      onClick={() => setConfirmarId(null)}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 12, color: "var(--danger)" }}
                    onClick={() => setConfirmarId(p.id)}
                  >
                    Borrar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {eliminar.isError && (
        <div className="error-box" role="alert" style={{ marginTop: 8 }}>
          <span className="error-text">{errorText(eliminar.error)}</span>
        </div>
      )}
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
  const [modelo, setModelo] = useState<string | null | undefined>(undefined);
  const [effort, setEffort] = useState<string | null>(null);
  const [proyecto, setProyecto] = useState("");
  const [frecuencia, setFrecuencia] = useState<"cada_horas" | "diaria">("cada_horas");
  const [horas, setHoras] = useState("6");
  const [hora, setHora] = useState("08:00");
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

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
    <form className="form-box" onSubmit={enviar} aria-label="Nueva tarea programada">
      <div className="form-row">
        <label className="form-label" htmlFor="programada-titulo">
          Título (opcional)
        </label>
        <input
          id="programada-titulo"
          className="input-text"
          maxLength={MAX_TITULO}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ej. Auditoría nocturna de dependencias npm y SBOM"
        />
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="programada-prompt">
          Instrucciones para el agente
        </label>
        <textarea
          id="programada-prompt"
          className="textarea"
          rows={3}
          maxLength={MAX_PROMPT}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Escribe lo que el agente debe hacer en cada ejecución."
        />
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="programada-proyecto">
          Proyecto
        </label>
        <select
          id="programada-proyecto"
          className="select-text"
          value={proyecto}
          onChange={(e) => setProyecto(e.target.value)}
        >
          <option value="">Sin proyecto (carpeta temporal)</option>
          {proyectos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (/srv/orquestador/projects/{p.carpeta})
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <span className="form-label">Frecuencia</span>
        <div className="radio-group">
          <label className="radio-item">
            <input
              type="radio"
              name="freq"
              checked={frecuencia === "cada_horas"}
              onChange={() => setFrecuencia("cada_horas")}
            />
            Cada cierto número de horas
          </label>
          {frecuencia === "cada_horas" && (
            <div style={{ paddingLeft: 26 }}>
              <input
                type="number"
                min={1}
                max={168}
                className="input-text"
                style={{ width: 100 }}
                value={horas}
                onChange={(e) => setHoras(e.target.value)}
              />
            </div>
          )}
          <label className="radio-item">
            <input
              type="radio"
              name="freq"
              checked={frecuencia === "diaria"}
              onChange={() => setFrecuencia("diaria")}
            />
            Diaria a una hora fija
          </label>
          {frecuencia === "diaria" && (
            <div style={{ paddingLeft: 26 }}>
              <input
                type="text"
                className="input-text"
                style={{ width: 100 }}
                placeholder="08:00"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {errorLocal && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorLocal}</span>
        </div>
      )}
      {crear.isError && (
        <div className="error-box" role="alert">
          <span className="error-text">{errorText(crear.error)}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button type="submit" className="btn-primary" disabled={crear.isPending}>
          {crear.isPending ? "Guardando…" : "Guardar programación"}
        </button>
        <button type="button" className="btn-ghost" onClick={alCrear}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
