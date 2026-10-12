import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { HistorialTarea } from "../components/task-history";
import { ProgramadasPanel } from "../components/programadas";
import { TareaPasos, derivarPasos } from "../components/tarea-pasos";
import { TerminalCrudo } from "../components/tarea-terminal";
import { RevisionCambios } from "../components/tarea-revision";
import { cuando, hora } from "../components/tarea-formato";
import { useEventosVivos } from "../lib/eventos-vivos";
import { effortLabel, errorText, formatUsd, sanearDetalle, STATUS_LABEL } from "../lib/model";
import { EVENTO_VERSION_NUEVA, hayVersionNueva } from "../lib/version";
import { useShell } from "../components/shell-context";
import { BotonTema } from "../components/tema-boton";
import { AppNav } from "../components/nav";
import "../styles-trabajo.css";

const isActive = (t: Task) => t.status === "queued" || t.status === "running";
const MAX_PROMPT_CHARS = 10_000;
const MAX_LINEAS_VIVAS = 1_500;
type TaskFilter = "all" | "active" | "done";

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// Tiempo transcurrido de una tarea en curso (SQLite guarda la fecha en UTC sin zona).
function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "00:00:00";
  const start = new Date(startedAt.replace(" ", "T") + "Z").getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function TasksPage() {
  // /tareas/$id muestra el detalle; /tareas, la lista.
  const params = useParams({ strict: false }) as { id?: string };
  if (params.id) return <DetalleTarea id={params.id} />;
  return <ListaTareas />;
}

function ListaTareas() {
  const qc = useQueryClient();
  const { newTaskOpen, setNewTaskOpen, toggleDrawer } = useShell();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  // "" significa sin proyecto: la tarea usa su carpeta temporal.
  const [projectId, setProjectId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [buscando, setBuscando] = useState(false);
  const [avisoActualizar, setAvisoActualizar] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "Nueva tarea en este proyecto" llega con el proyecto elegido en el estado de navegación.
  const proyectoDesdeNavegacion = useRouterState({
    select: (s) =>
      (s.location.state as unknown as { proyectoId?: string } | undefined)?.proyectoId ?? null,
  });

  useEffect(() => {
    if (!proyectoDesdeNavegacion) return;
    setProjectId(proyectoDesdeNavegacion);
    setFormOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 60);
  }, [proyectoDesdeNavegacion]);

  // Escucha apertura desde el sidebar o atajo ⌘N
  useEffect(() => {
    if (newTaskOpen) {
      setFormOpen(true);
      setNewTaskOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [newTaskOpen, setNewTaskOpen]);

  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    staleTime: 5 * 60_000,
  });

  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });

  // Inicializa el modelo y esfuerzo por defecto con los valores de Ajustes
  useEffect(() => {
    if (prefs.data && model === null && effort === null) {
      if (prefs.data.defaultModel) setModel(prefs.data.defaultModel);
      if (prefs.data.defaultEffort) setEffort(prefs.data.defaultEffort);
    }
  }, [prefs.data, model, effort]);

  // Si hay tareas en cola o corriendo, la lista se actualiza cada 3s (respaldo del canal en vivo).
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: api.listTasks,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3_000 : false),
  });

  // Los cambios de tareas llegan en vivo: la lista se vuelve a pedir sin esperar al sondeo.
  const { conectado } = useEventosVivos({}, (evento) => {
    if (evento.tipo === "tarea" || evento.tipo === "evento") {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  });

  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === model) ?? null;

  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const create = useMutation({
    mutationFn: () =>
      api.createTask({
        prompt: draft.trim(),
        model,
        effort: model ? effort : null,
        projectId: projectId || null,
      }),
    onSuccess: () => {
      setDraft("");
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelTask(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  // Actualizar: vuelve a pedir las tareas y revisa si hay una versión nueva de la app.
  const actualizar = async () => {
    setBuscando(true);
    setAvisoActualizar(null);
    const [, version] = await Promise.allSettled([
      qc.invalidateQueries({ queryKey: ["tasks"] }),
      hayVersionNueva(),
    ]);
    setBuscando(false);
    if (version.status === "rejected") {
      setAvisoActualizar("Sin conexión. Intenta de nuevo.");
    } else if (version.value) {
      window.dispatchEvent(new Event(EVENTO_VERSION_NUEVA));
    } else {
      setAvisoActualizar("Ya tienes la versión más reciente.");
    }
  };

  // El aviso de Actualizar desaparece solo.
  useEffect(() => {
    if (!avisoActualizar) return;
    const timer = window.setTimeout(() => setAvisoActualizar(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [avisoActualizar]);

  const pickModel = (m: ModelInfo | null) => {
    setPickerOpen(false);
    setModel(m?.id ?? null);
    if (!m || !m.variants.includes(effort ?? "")) setEffort(null);
  };

  const submit = () => {
    if (draft.trim() && !create.isPending && draft.length <= MAX_PROMPT_CHARS) {
      create.mutate();
    }
  };

  const modelName = (id: string) => modelList.find((m) => m.id === id)?.name ?? id;

  const taskList = tasks.data ?? [];
  const runningCount = taskList.filter((t) => t.status === "running").length;
  const queuedCount = taskList.filter((t) => t.status === "queued").length;
  const activasCount = runningCount + queuedCount;
  const doneCount = taskList.filter((t) => t.status === "done").length;
  const completedTodayCount = taskList.filter(
    (t) => t.status === "done" && (isToday(t.finished_at) || isToday(t.created_at)),
  ).length;

  // Contador en vivo para tareas corriendo
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!runningCount) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [runningCount]);

  const filteredTasks = useMemo(() => {
    if (filter === "active") return taskList.filter(isActive);
    if (filter === "done") return taskList.filter((t) => t.status === "done");
    return taskList;
  }, [taskList, filter]);

  const isOnline = Boolean(health.data?.ok);

  return (
    <div className="page-wrap">
      <AppNav variant="row" />

      <main className="container">
        <header className="header-row">
          <h1 className="page-title">Tareas</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={`status-pill ${isOnline ? "is-online" : "is-offline"}`}>
              <span className="pill-dot" aria-hidden="true" />
              {isOnline ? "Servidor activo" : "Sin conexión"}
            </span>
            <BotonTema />
          </div>
        </header>

      {/* Formulario de nueva tarea en panel colapsable */}
      {formOpen && (
        <section className="panel new-task-panel">
          <div className="card-top">
            <h2>Nueva tarea</h2>
            <button type="button" className="ghost task-mini-btn" onClick={() => setFormOpen(false)}>
              Cerrar
            </button>
          </div>

          <form
            className="composer-box task-composer"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit();
            }}
          >
            {pickerOpen && (
              <ModelPicker
                models={modelList}
                currentId={model}
                onSelect={pickModel}
                onClose={() => setPickerOpen(false)}
              />
            )}

            <textarea
              ref={textareaRef}
              rows={3}
              value={draft}
              maxLength={MAX_PROMPT_CHARS}
              placeholder="Describe la tarea. Se ejecuta en el servidor, aunque cierres la app."
              aria-label="Descripción de la tarea"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />

            <div className="toolbar">
              <button
                type="button"
                className="model-chip"
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((o) => !o)}
              >
                <span className="model-chip-name">{modelInfo?.name ?? model ?? "Predeterminado"}</span>
                {modelInfo && <CostMeter tier={modelInfo.costTier} />}
              </button>

              <EffortControl
                variants={modelInfo?.variants ?? []}
                value={effort}
                disabled={!model}
                onChange={setEffort}
              />

              {(proyectos.data?.length ?? 0) > 0 && (
                <select
                  className="project-select"
                  aria-label="Proyecto de la tarea"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">Sin proyecto</option>
                  {proyectos.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}

              <span className="char-counter" aria-live="polite">
                {draft.length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}
              </span>

              <button
                type="submit"
                className="primary launch-btn"
                aria-label="Lanzar tarea"
                disabled={!draft.trim() || create.isPending}
              >
                {create.isPending ? "Lanzando…" : "Lanzar tarea"}
              </button>
            </div>
            {projectId && (
              <p className="hint">El agente puede modificar archivos dentro de este proyecto.</p>
            )}
          </form>

          {create.isError && (
            <p className="error task-form-error" role="alert">
              {errorText(create.error)}
            </p>
          )}
        </section>
      )}

      {/* Tres tarjetas estadísticas calculadas con datos reales */}
      <section className="task-stats-grid" aria-label="Métricas de tareas">
        <div className="task-stat-card">
          <div className="task-stat-card-head">
            <span>En ejecución</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </div>
          <div className="task-stat-card-body">
            <span className="task-stat-card-num">{runningCount}</span>
            <span className="task-stat-card-label">activas</span>
          </div>
        </div>

        <div className="task-stat-card">
          <div className="task-stat-card-head">
            <span>En cola</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="task-stat-card-body">
            <span className="task-stat-card-num">{queuedCount}</span>
            <span className="task-stat-card-label">pendientes</span>
          </div>
        </div>

        <div className="task-stat-card">
          <div className="task-stat-card-head">
            <span>Completadas</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="task-stat-card-body">
            <span className="task-stat-card-num">{completedTodayCount}</span>
            <span className="task-stat-card-label">hoy</span>
          </div>
        </div>
      </section>

      <ProgramadasPanel />

      {/* Filtros: Todas, Activas, Completadas */}
      <div className="task-filter-row">
        <div className="period" role="group" aria-label="Filtro de tareas">
          <button
            type="button"
            className={`pill${filter === "all" ? " on" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            Todas ({taskList.length})
          </button>
          <button
            type="button"
            className={`pill${filter === "active" ? " on" : ""}`}
            aria-pressed={filter === "active"}
            onClick={() => setFilter("active")}
          >
            Activas ({activasCount})
          </button>
          <button
            type="button"
            className={`pill${filter === "done" ? " on" : ""}`}
            aria-pressed={filter === "done"}
            onClick={() => setFilter("done")}
          >
            Completadas ({doneCount})
          </button>
        </div>

        <div className="task-sync">
          <span className="task-sync-label">
            <span className={`pill-dot task-sync-dot${activasCount > 0 ? " is-live" : ""}`} aria-hidden="true" />
            {activasCount > 0 ? (conectado ? "En vivo" : "Cada 3 s") : "En reposo"}
          </span>
          <button
            type="button"
            className="task-footer-btn"
            onClick={() => void actualizar()}
            disabled={buscando}
            aria-label="Actualizar"
            title="Actualizar tareas y buscar cambios de la app"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {cancel.isError && (
        <p className="error" role="alert">
          {errorText(cancel.error)}
        </p>
      )}

      {tasks.isPending && <p className="muted-note">Cargando las tareas…</p>}

      {tasks.isError && (
        <>
          <p className="error" role="alert">
            No se pudieron cargar las tareas.
          </p>
          <div>
            <button type="button" className="ghost task-mini-btn" onClick={() => void tasks.refetch()}>
              Reintentar
            </button>
          </div>
        </>
      )}

      {tasks.data && filteredTasks.length === 0 && (
        <p className="muted-note">
          {filter === "all"
            ? "Todavía no hay tareas. Lanza una nueva tarea con el botón superior."
            : filter === "active"
              ? "No hay tareas activas en cola ni en ejecución."
              : "Todavía no hay tareas completadas."}
        </p>
      )}

      {/* Lista de tarjetas: cada una abre el detalle en /tareas/$id */}
      <ul className="task-list">
        {filteredTasks.map((t) => {
          const isRunning = t.status === "running";
          const isQueued = t.status === "queued";
          const isDone = t.status === "done";
          const isFailed = t.status === "failed";

          let statusText = "En cola";
          if (isRunning) statusText = `Corriendo (${formatElapsed(t.started_at)})`;
          else if (isDone) statusText = `Lista (${hora(t.finished_at)})`;
          else if (isFailed) statusText = `Falló (${hora(t.finished_at)})`;
          else if (t.status === "cancelled") statusText = "Cancelada";
          else if (t.status === "interrupted") statusText = "Interrumpida";

          const dotClass = isRunning
            ? " is-live"
            : isQueued
              ? " task-dot-queued"
              : isDone
                ? " task-dot-done"
                : isFailed || t.status === "interrupted"
                  ? " is-offline"
                  : "";

          return (
            <li key={t.id}>
              <article className="task-card">
                {/* El botón de cancelar va al lado, no dentro, del enlace que abre la tarea */}
                <div className="task-card-top">
                  <Link to="/tareas/$id" params={{ id: t.id }} className="task-card-head">
                    <div className="task-card-left">
                      <span className="task-card-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="18" r="3" />
                          <circle cx="6" cy="6" r="3" />
                          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                          <line x1="6" y1="9" x2="6" y2="21" />
                        </svg>
                      </span>
                      <div className="task-card-info">
                        <div className="task-card-title-row">
                          <span className="task-card-title">{t.title}</span>
                          <span className="task-card-badge">{modelName(t.model)}</span>
                        </div>
                        <span className="task-card-sub">
                          {t.project_name ? `${t.project_name} · ` : ""}uuid: {t.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>

                    <div className="task-card-status">
                      <span className={`pill-dot${dotClass}`} aria-hidden="true" />
                      <span>{statusText}</span>
                    </div>
                  </Link>

                  {(isActive(t) || t.status === "interrupted") && (
                    <button
                      type="button"
                      className="ghost task-cancel-btn"
                      onClick={() => cancel.mutate(t.id)}
                      disabled={cancel.isPending}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      {/* Pie con estado del servidor y de la cola, sin métricas ficticias */}
      <footer className="task-footer-bar">
        <div className="task-footer-left">
          <span className={`pill-dot${isOnline ? " is-live" : " is-offline"}`} aria-hidden="true" />
          <span>{isOnline ? "Servidor local: conectado" : "Servidor local: desconectado"}</span>
          <span className="task-footer-sep">•</span>
          <span>
            {runningCount > 0
              ? `${runningCount} ${runningCount === 1 ? "tarea en ejecución" : "tareas en ejecución"}`
              : "Cola libre"}
          </span>
          <span className="task-footer-sep">•</span>
          <span>{queuedCount} en espera</span>
        </div>

        <div className="task-footer-actions">
          {avisoActualizar && (
            <span className="task-footer-aviso" role="status">
              {avisoActualizar}
            </span>
          )}
          <button
            type="button"
            className="task-footer-btn"
            onClick={() => void actualizar()}
            disabled={buscando}
            title="Actualizar tareas y buscar cambios de la app"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{buscando ? "Buscando…" : "Actualizar"}</span>
          </button>
        </div>
      </footer>
    </main>
  </div>
);
}

// Detalle de una tarea: estado, resumen, terminal, revisión de cambios e historial.
function DetalleTarea({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toggleDrawer } = useShell();
  // Líneas del agente que llegaron en vivo desde la última carga del terminal.
  const [vivas, setVivas] = useState<string[]>([]);

  const tarea = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.getTask(id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 3_000 : false),
  });
  const t = tarea.data;
  const activa = t ? isActive(t) : false;
  const enCurso = t?.status === "running";
  const conGit = Boolean(t?.rama);

  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const modelName = t ? (models.data?.models.find((m) => m.id === t.model)?.name ?? t.model) : "";

  const eventos = useQuery({
    queryKey: ["task-events", id],
    queryFn: () => api.listTaskEvents(id),
    refetchInterval: activa ? 4_000 : false,
  });

  // Los cambios solo se calculan cuando la tarea no está en cola ni corriendo.
  const diff = useQuery({
    queryKey: ["task-diff", id],
    queryFn: () => api.taskDiff(id),
    enabled: conGit && Boolean(t) && !activa,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { conectado } = useEventosVivos({ tareaId: id }, (evento) => {
    if (evento.tipo === "salida") {
      setVivas((prev) => {
        const base = prev.length >= MAX_LINEAS_VIVAS ? prev.slice(-MAX_LINEAS_VIVAS + 1) : prev;
        return [...base, evento.linea];
      });
      return;
    }
    if (evento.tipo === "evento") {
      void qc.invalidateQueries({ queryKey: ["task-events", id] });
      void qc.invalidateQueries({ queryKey: ["task", id] });
      return;
    }
    void qc.invalidateQueries({ queryKey: ["task", id] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    if (evento.status !== "queued" && evento.status !== "running") {
      void qc.invalidateQueries({ queryKey: ["task-diff", id] });
      void qc.invalidateQueries({ queryKey: ["task-output", id] });
    }
  });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["task", id] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const cancelar = useMutation({ mutationFn: () => api.cancelTask(id), onSettled: refrescar });
  const reanudar = useMutation({ mutationFn: () => api.resumeTask(id), onSettled: refrescar });
  const reintentar = useMutation({
    mutationFn: () => api.retryTask(id),
    onSuccess: (nueva) => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void navigate({ to: "/tareas/$id", params: { id: nueva.id } });
    },
  });

  const pasos = t
    ? derivarPasos({
        tarea: t,
        eventos: eventos.data,
        conGit,
        diff: diff.data,
        errorDiff: diff.isError,
      })
    : [];

  return (
    <div className="page-wrap">
      <AppNav variant="row" />

      <main className="container">
        <Link to="/tareas" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Volver a tareas
        </Link>

        <header className="header-main">
          <div className="header-top">
            <div>
              <h1 className="page-title">{t?.title ?? "Tarea"}</h1>
              {t && (
                <p className="folder-note">
                  {STATUS_LABEL[t.status]} · {modelName}
                  {t.effort ? ` · ${effortLabel(t.effort)}` : ""}
                </p>
              )}
            </div>
            <BotonTema />
          </div>
        </header>

      {tarea.isPending && <p className="muted-note">Cargando la tarea…</p>}

      {tarea.isError && (
        <section className="panel" aria-live="polite">
          <p className="error" role="alert">
            {errorText(tarea.error)}
          </p>
          <div className="tr-acciones-fila">
            <button type="button" className="ghost task-mini-btn" onClick={() => void tarea.refetch()}>
              Reintentar
            </button>
            <Link to="/tareas" className="ghost task-mini-btn tr-enlace-boton">
              Ver todas las tareas
            </Link>
          </div>
        </section>
      )}

      {t && (
        <>
          <section className="panel tarea-seccion" aria-labelledby="estado-titulo">
            <div className="card-top">
              <h2 id="estado-titulo">Estado</h2>
              {enCurso && conectado && <span className="badge badge-neutral">En vivo</span>}
            </div>
            <TareaPasos pasos={pasos} />
          </section>

          <section className="panel tarea-seccion" aria-labelledby="resumen-titulo">
            <h2 id="resumen-titulo">Resumen</h2>

            <dl className="tarea-meta">
              <div>
                <dt>Modelo</dt>
                <dd>{modelName}</dd>
              </div>
              {t.effort && (
                <div>
                  <dt>Esfuerzo</dt>
                  <dd>{effortLabel(t.effort)}</dd>
                </div>
              )}
              <div>
                <dt>Proyecto</dt>
                <dd>{t.project_name ?? "Sin proyecto"}</dd>
              </div>
              {t.rama && (
                <div>
                  <dt>Rama</dt>
                  <dd className="tarea-codigo">{t.rama}</dd>
                </div>
              )}
              {t.base_commit && (
                <div>
                  <dt>Commit base</dt>
                  <dd className="tarea-codigo">{t.base_commit.slice(0, 7)}</dd>
                </div>
              )}
              <div>
                <dt>Creada</dt>
                <dd>{cuando(t.created_at)}</dd>
              </div>
              {t.started_at && (
                <div>
                  <dt>Iniciada</dt>
                  <dd>{cuando(t.started_at)}</dd>
                </div>
              )}
              {t.finished_at && (
                <div>
                  <dt>Finalizada</dt>
                  <dd>{cuando(t.finished_at)}</dd>
                </div>
              )}
            </dl>

            <div className="tarea-bloque">
              <span className="tarea-etiqueta">Prompt</span>
              <div className="tarea-texto">{t.prompt}</div>
            </div>

            {t.result && (
              <div className="tarea-bloque">
                <span className="tarea-etiqueta">Resultado</span>
                <div className="tarea-texto">{t.result}</div>
              </div>
            )}

            {t.error && (
              <div className="tarea-bloque">
                <span className="tarea-etiqueta">Error</span>
                <p className="error tarea-texto" role="alert">
                  {sanearDetalle(t.error, 600)}
                </p>
              </div>
            )}

            {(cancelar.isError || reanudar.isError || reintentar.isError) && (
              <p className="error" role="alert">
                {errorText(cancelar.error ?? reanudar.error ?? reintentar.error)}
              </p>
            )}

            <div className="task-card-acciones tr-acciones">
              {t.reanudable && (t.status === "interrupted" || t.status === "failed") && (
                <button
                  type="button"
                  className="ghost task-mini-btn"
                  onClick={() => reanudar.mutate()}
                  disabled={reanudar.isPending}
                >
                  Reanudar
                </button>
              )}
              {(t.status === "interrupted" || t.status === "failed" || t.status === "cancelled") && (
                <button
                  type="button"
                  className="ghost task-mini-btn"
                  onClick={() => reintentar.mutate()}
                  disabled={reintentar.isPending}
                >
                  {reintentar.isPending ? "Creando…" : "Reintentar"}
                </button>
              )}
              {(activa || t.status === "interrupted") && (
                <button
                  type="button"
                  className="ghost task-cancel-btn"
                  onClick={() => cancelar.mutate()}
                  disabled={cancelar.isPending}
                >
                  Cancelar
                </button>
              )}
            </div>
          </section>

          {conGit &&
            (activa ? (
              <section className="panel tarea-seccion" aria-labelledby="revision-titulo">
                <h2 id="revision-titulo">Revisión de cambios</h2>
                <p className="muted-note">Los cambios se revisan cuando la tarea termina.</p>
              </section>
            ) : (
              <RevisionCambios
                id={id}
                datos={diff.data}
                cargando={diff.isPending || diff.isFetching}
                error={diff.error}
                onRecargar={() => void diff.refetch()}
              />
            ))}

          <section className="panel tarea-seccion" aria-labelledby="salida-titulo">
            <h2 id="salida-titulo">Salida y historial</h2>
            <TerminalCrudo
              id={id}
              vivas={vivas}
              enCurso={enCurso}
              onCargada={() => setVivas([])}
            />
            <HistorialTarea id={id} />
          </section>
        </>
      )}
    </main>
  </div>
);
}
