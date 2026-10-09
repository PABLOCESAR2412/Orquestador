import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { errorText } from "../lib/model";
import { useShell } from "../components/shell-context";

const isActive = (t: Task) => t.status === "queued" || t.status === "running";
const MAX_PROMPT_CHARS = 10_000;
type TaskFilter = "all" | "active" | "done";

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "00:00:00";
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatFinishedTime(finishedAt: string | null): string {
  if (!finishedAt) return "";
  try {
    const d = new Date(finishedAt);
    return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return finishedAt;
  }
}

export function TasksPage() {
  const qc = useQueryClient();
  const { newTaskOpen, setNewTaskOpen, toggleDrawer } = useShell();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Si hay tareas en cola o corriendo, la lista se actualiza cada 3s.
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: api.listTasks,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3_000 : false),
  });

  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === model) ?? null;

  const create = useMutation({
    mutationFn: () =>
      api.createTask({ prompt: draft.trim(), model, effort: model ? effort : null }),
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
    if (filter === "done") return taskList.filter((t) => !isActive(t));
    return taskList;
  }, [taskList, filter]);

  const isOnline = Boolean(health.data?.ok);

  return (
    <main className="page">
      {/* Cabecera Tareas del Servidor */}
      <header className="task-header-wrap">
        <div className="task-header-meta">
          <button
            type="button"
            className="ghost menu-btn"
            aria-label="Abrir menú"
            onClick={toggleDrawer}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <span className={`status-pill ${isOnline ? "is-online" : "is-offline"}`}>
            <span className="pill-dot" aria-hidden="true" />
            {isOnline ? "Daemon • Activo" : "Sin conexión"}
          </span>
        </div>

        <div className="task-header-main">
          <div className="task-header-title-col">
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, letterSpacing: "-0.01em" }}>
              Tareas del Servidor
            </h1>
            <p className="page-desc">
              Procesos persistentes que continúan ejecutándose aunque cierres la sesión local o cambies de workspace.
            </p>
          </div>

          <button
            type="button"
            className="task-btn-nueva"
            onClick={() => {
              setFormOpen((prev) => !prev);
              if (!formOpen) setTimeout(() => textareaRef.current?.focus(), 60);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{formOpen ? "Cerrar formulario" : "Nueva tarea"}</span>
          </button>
        </div>
      </header>

      {/* Formulario de nueva tarea en panel colapsable */}
      {formOpen && (
        <section className="panel new-task-panel">
          <div className="card-top">
            <h2>Nueva tarea</h2>
            <button
              type="button"
              className="ghost"
              style={{ padding: "4px 8px", fontSize: "12px" }}
              onClick={() => setFormOpen(false)}
            >
              Cerrar
            </button>
          </div>

          <form
            className="composer-box"
            style={{ width: "100%", margin: 0 }}
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
          </form>

          {create.isError && (
            <p className="error" role="alert" style={{ margin: 0 }}>
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

      {/* Filtros: Todas, Activas, Completadas */}
      <div className="task-filter-row">
        <div className="period" role="group" aria-label="Filtro de tareas">
          <button
            type="button"
            className={`pill${filter === "all" ? " on" : ""}`}
            onClick={() => setFilter("all")}
          >
            Todas ({taskList.length})
          </button>
          <button
            type="button"
            className={`pill${filter === "active" ? " on" : ""}`}
            onClick={() => setFilter("active")}
          >
            Activas ({runningCount + queuedCount})
          </button>
          <button
            type="button"
            className={`pill${filter === "done" ? " on" : ""}`}
            onClick={() => setFilter("done")}
          >
            Completadas ({taskList.filter((t) => !isActive(t)).length})
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--ink-2)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span className="pill-dot is-live" style={{ width: "5px", height: "5px" }} />
            Sync 3s
          </span>
          <button
            type="button"
            className="task-footer-btn"
            onClick={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
            title="Refrescar tareas"
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

      {tasks.isError && <p className="error">No se pudieron cargar las tareas.</p>}

      {tasks.data && filteredTasks.length === 0 && (
        <p className="muted-note">
          {filter === "all"
            ? "Todavía no hay tareas. Lanza una nueva tarea con el botón superior."
            : filter === "active"
              ? "No hay tareas activas en cola ni en ejecución."
              : "Todavía no hay tareas completadas."}
        </p>
      )}

      {/* Lista de tarjetas de tareas */}
      <ul className="task-list">
        {filteredTasks.map((t) => {
          const open = openId === t.id;
          const isRunning = t.status === "running";
          const isQueued = t.status === "queued";
          const isDone = t.status === "done";
          const isFailed = t.status === "failed";

          let statusText = "En cola";
          if (isRunning) statusText = `Ejecutando (${formatElapsed(t.started_at)})`;
          else if (isDone) statusText = `Completada (${formatFinishedTime(t.finished_at)})`;
          else if (isFailed) statusText = `Falló (${formatFinishedTime(t.finished_at)})`;
          else if (t.status === "cancelled") statusText = "Cancelada";

          return (
            <li key={t.id}>
              <article className="task-card">
                <button
                  type="button"
                  className="task-card-head"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : t.id)}
                >
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
                      <span className="task-card-sub">uuid: {t.id.slice(0, 8)}</span>
                    </div>
                  </div>

                  <div className="task-card-right">
                    <div className="task-card-status">
                      <span
                        className={`pill-dot${isRunning ? " is-live" : isQueued ? "" : isFailed ? " is-offline" : ""}`}
                        style={{
                          backgroundColor: isQueued ? "var(--ink-2)" : isDone ? "var(--ink)" : undefined,
                        }}
                        aria-hidden="true"
                      />
                      <span>{statusText}</span>
                    </div>

                    {isActive(t) && (
                      <button
                        type="button"
                        className="ghost task-cancel-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancel.mutate(t.id);
                        }}
                        disabled={cancel.isPending}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </button>

                {open && (
                  <div className="task-card-body">
                    <div className="task-card-prompt">
                      <strong style={{ color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                        Prompt:
                      </strong>
                      {t.prompt}
                    </div>

                    {t.result && (
                      <div className="task-card-result">
                        <strong style={{ color: "var(--ink)", display: "block", marginBottom: "4px", fontFamily: "var(--font)" }}>
                          Resultado:
                        </strong>
                        {t.result}
                      </div>
                    )}

                    {t.error && (
                      <p className="error" role="alert">
                        <strong>Error: </strong> {t.error}
                      </p>
                    )}

                    <div className="task-meta-bar">
                      <span className="muted-note">
                        {modelName(t.model)}
                        {t.effort ? ` · ${t.effort}` : ""}
                        {t.started_at ? ` · Iniciada: ${new Date(t.started_at).toLocaleTimeString()}` : ""}
                        {t.finished_at ? ` · Finalizada: ${new Date(t.finished_at).toLocaleTimeString()}` : ""}
                      </span>
                    </div>
                  </div>
                )}
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

        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            type="button"
            className="task-footer-btn"
            onClick={() => qc.invalidateQueries({ queryKey: ["tasks"] })}
            title="Actualizar estado de tareas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>Actualizar</span>
          </button>
        </div>
      </footer>
    </main>
  );
}
