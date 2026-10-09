import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { AppNav } from "../components/nav";
import { ModelPicker } from "../components/model-picker";
import { effortLabel, errorText, formatWhen, STATUS_LABEL } from "../lib/model";

const isActive = (t: Task) => t.status === "queued" || t.status === "running";
const MAX_PROMPT_CHARS = 10_000;
type TaskFilter = "all" | "active" | "done";

export function TasksPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");

  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    staleTime: 5 * 60_000,
  });

  // Inicializa el modelo y esfuerzo por defecto con los valores de Ajustes
  useEffect(() => {
    if (prefs.data && model === null && effort === null) {
      if (prefs.data.defaultModel) setModel(prefs.data.defaultModel);
      if (prefs.data.defaultEffort) setEffort(prefs.data.defaultEffort);
    }
  }, [prefs.data, model, effort]);

  // Mientras haya tareas en cola o corriendo, la lista se actualiza sola cada 3s.
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
  const runningTask = taskList.find((t) => t.status === "running");
  const queuedCount = taskList.filter((t) => t.status === "queued").length;

  const filteredTasks = useMemo(() => {
    if (filter === "active") return taskList.filter(isActive);
    if (filter === "done") return taskList.filter((t) => !isActive(t));
    return taskList;
  }, [taskList, filter]);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Tareas</h1>
          <p className="page-desc">
            Lanza tareas que continúan ejecutándose en el servidor en segundo plano aunque cierres la app.
          </p>
        </div>
        <div className="status-pill-head">
          {runningTask ? (
            <span className="status-pill is-online">
              <span className="pill-dot" aria-hidden="true" />
              Corriendo
            </span>
          ) : queuedCount > 0 ? (
            <span className="status-pill is-queued">
              <span className="pill-dot" aria-hidden="true" />
              {queuedCount} en cola
            </span>
          ) : (
            <span className="status-pill is-idle">
              <span className="pill-dot" aria-hidden="true" />
              En espera
            </span>
          )}
        </div>
      </header>

      <AppNav />

      <form
        className="composer-box"
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
          rows={3}
          value={draft}
          maxLength={MAX_PROMPT_CHARS}
          placeholder="Describe la tarea. Se ejecuta en el servidor, aunque cierres la app."
          aria-label="Tarea"
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
        <p className="error" role="alert">
          {errorText(create.error)}
        </p>
      )}
      {cancel.isError && (
        <p className="error" role="alert">
          {errorText(cancel.error)}
        </p>
      )}

      {tasks.isError && <p className="error">No se pudieron cargar las tareas.</p>}

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
            Activas ({taskList.filter(isActive).length})
          </button>
          <button
            type="button"
            className={`pill${filter === "done" ? " on" : ""}`}
            onClick={() => setFilter("done")}
          >
            Completadas ({taskList.filter((t) => !isActive(t)).length})
          </button>
        </div>
      </div>

      {tasks.data && filteredTasks.length === 0 && (
        <p className="muted-note">
          {filter === "all"
            ? "Todavía no hay tareas. Escribe lo que quieres que haga un agente."
            : filter === "active"
              ? "No hay tareas activas en cola ni corriendo."
              : "Todavía no hay tareas terminadas."}
        </p>
      )}

      <ul className="task-list">
        {filteredTasks.map((t) => {
          const open = openId === t.id;
          return (
            <li key={t.id} className="task">
              <button
                type="button"
                className="task-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : t.id)}
              >
                <span className={`status status-${t.status}`}>
                  <i aria-hidden="true" />
                  {STATUS_LABEL[t.status]}
                </span>
                <span className="task-title">{t.title}</span>
                <span className="task-head-meta muted-note">
                  {modelName(t.model)}
                </span>
                <time className="task-time muted-note">{formatWhen(t.created_at)}</time>
              </button>

              {open && (
                <div className="task-body">
                  <p className="task-prompt">{t.prompt}</p>
                  {t.result && <div className="task-result">{t.result}</div>}
                  {t.error && <p className="error">{t.error}</p>}
                  <div className="task-meta-bar">
                    <span className="muted-note">
                      {modelName(t.model)}
                      {t.effort ? ` · ${effortLabel(t.effort)}` : ""}
                    </span>
                    {isActive(t) && (
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
