import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter, EffortControl } from "../components/controls";
import { AppNav } from "../components/nav";
import { ModelPicker } from "../components/model-picker";
import { effortLabel, errorText, formatWhen, STATUS_LABEL } from "../lib/model";

const isActive = (t: Task) => t.status === "queued" || t.status === "running";

export function TasksPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.listModels,
    staleTime: 5 * 60_000,
  });

  // Mientras haya tareas en cola o corriendo, la lista se actualiza sola.
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
    if (draft.trim() && !create.isPending) create.mutate();
  };

  const modelName = (id: string) => modelList.find((m) => m.id === id)?.name ?? id;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Tareas</h1>
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
          rows={2}
          value={draft}
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

          <button
            type="submit"
            className="send"
            aria-label="Crear tarea"
            disabled={!draft.trim() || create.isPending}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
      {tasks.data?.length === 0 && (
        <p className="muted-note">Todavía no hay tareas. Describe una arriba.</p>
      )}

      <ul className="task-list">
        {tasks.data?.map((t) => {
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
                <time className="task-time muted-note">{formatWhen(t.created_at)}</time>
              </button>

              {open && (
                <div className="task-body">
                  <p className="task-prompt">{t.prompt}</p>
                  {t.result && <div className="task-result">{t.result}</div>}
                  {t.error && <p className="error">{t.error}</p>}
                  <p className="muted-note">
                    {modelName(t.model)}
                    {t.effort ? ` · ${effortLabel(t.effort)}` : ""}
                  </p>
                  {isActive(t) && (
                    <div>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => cancel.mutate(t.id)}
                        disabled={cancel.isPending}
                      >
                        Cancelar tarea
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
