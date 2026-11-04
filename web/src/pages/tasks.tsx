import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter } from "../components/controls";
import { LoadingSkeleton } from "../components/loading-skeleton";
import { AvisoCuota } from "../components/cuota-aviso";
import { ModelPicker } from "../components/model-picker";
import { HistorialTarea } from "../components/task-history";
import { ProgramadasPanel } from "../components/programadas";
import { TareaPasos, derivarPasos } from "../components/tarea-pasos";
import { PlanTarea, ReporteTarea } from "../components/tarea-plan";
import { TerminalCrudo } from "../components/tarea-terminal";
import { RevisionCambios } from "../components/tarea-revision";
import { cuando } from "../components/tarea-formato";
import { useEventosVivos } from "../lib/eventos-vivos";
import { effortLabel, errorText, textoErrorTarea, STATUS_LABEL } from "../lib/model";
import { useShell } from "../components/shell-context";
import "../styles-trabajo.css";
import "../styles-tareas.css";

// Una tarea activa tiene proceso o espera una decisión del usuario (el plan).
const isActive = (t: Task) =>
  t.status === "queued" || t.status === "analyzing" || t.status === "running" || t.status === "waiting_approval";
const MAX_LINEAS_VIVAS = 1_500;
const MAX_PROMPT_CHARS = 10_000;

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function TasksPage() {
  // /tareas/$id muestra el detalle; /tareas, la lista.
  const params = useParams({ strict: false }) as { id?: string };
  if (params.id) return <DetalleTarea id={params.id} />;
  return <ListaTareas />;
}

function ListaTareas() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { newTaskOpen, setNewTaskOpen } = useShell();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const proyectoDesdeNavegacion = useRouterState({
    select: (s) => (s.location.state as unknown as { proyectoId?: string } | undefined)?.proyectoId ?? null,
  });

  const abrirFormulario = () => {
    setFormOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 60);
  };
  useEffect(() => {
    if (!proyectoDesdeNavegacion) return;
    setProjectId(proyectoDesdeNavegacion);
    abrirFormulario();
  }, [proyectoDesdeNavegacion]);
  useEffect(() => {
    if (!newTaskOpen) return;
    abrirFormulario();
    setNewTaskOpen(false);
  }, [newTaskOpen, setNewTaskOpen]);

  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  useEffect(() => {
    if (prefs.data && model === null && effort === null && prefs.data.defaultModel) {
      setModel(prefs.data.defaultModel);
      setEffort(prefs.data.defaultEffort);
    }
  }, [prefs.data, model, effort]);
  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === model) ?? null;
  const create = useMutation({
    mutationFn: () => api.createTask({ prompt: draft.trim(), model, effort: model ? effort : null, projectId: projectId || null }),
    onSuccess: (task) => {
      setDraft("");
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void navigate({ to: "/tareas/$id", params: { id: task.id } });
    },
  });
  const pickModel = (selected: ModelInfo | null, selectedEffort: string | null = null) => {
    setPickerOpen(false);
    setModel(selected?.id ?? null);
    setEffort(selected && selectedEffort && selected.variants.includes(selectedEffort) ? selectedEffort : null);
  };

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const servidorOk = Boolean(health.data?.ok) && !health.isError;
  const claseServidor = health.isError ? "is-failed" : servidorOk ? "is-running" : "";
  const estadoServidor = health.isError ? "Sin conexión" : servidorOk ? "Servidor activo" : "Conectando…";

  return (
    <div className="page-wrap tk-pagina">
      <main className="container tk-principal">
        <header className="tk-cabecera">
          <div className="tk-cabecera-texto">
            <span className="tk-servidor" role="status">
              <span className={`tk-punto ${claseServidor}`} aria-hidden="true" />
              {estadoServidor}
            </span>
            <h1 className="tk-titulo-pagina">Tareas programadas</h1>
            <p className="tk-descripcion">Automatizaciones que se ejecutan en el servidor según el horario que elijas.</p>
          </div>
          <div className="tk-cabecera-acciones">
            <button type="button" className="tk-boton tk-boton-primario" onClick={abrirFormulario}>
              <Svg><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
              Nueva tarea
            </button>
          </div>
        </header>
        {formOpen && (
          <section className="panel new-task-panel" aria-labelledby="tk-nueva-tarea">
            <div className="card-top">
              <h2 id="tk-nueva-tarea">Nueva tarea</h2>
              <button type="button" className="ghost task-mini-btn" onClick={() => setFormOpen(false)}>Cerrar</button>
            </div>
            <form className="composer-box task-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); if (draft.trim() && !create.isPending) create.mutate(); }}>
              {pickerOpen && <ModelPicker models={modelList} currentId={model} conEsfuerzo currentEffort={effort} onSelect={pickModel} onClose={() => setPickerOpen(false)} />}
              <textarea
                ref={textareaRef}
                rows={3}
                value={draft}
                maxLength={MAX_PROMPT_CHARS}
                placeholder="Describe la tarea. Se ejecutará una vez en el servidor."
                aria-label="Descripción de la tarea"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.trim() && !create.isPending) create.mutate(); }
                }}
              />
              <div className="toolbar">
                <button type="button" className="model-chip" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
                  <span className="model-chip-name">{modelInfo?.name ?? model ?? "Predeterminado"}</span>
                  {modelInfo && <CostMeter tier={modelInfo.costTier} />}
                </button>
                {(proyectos.data?.length ?? 0) > 0 && (
                  <select className="project-select" aria-label="Proyecto de la tarea" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">Sin proyecto</option>
                    {proyectos.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                )}
                <button type="submit" className="primary launch-btn" aria-label="Lanzar tarea" disabled={!draft.trim() || create.isPending}>
                  {create.isPending ? "Lanzando…" : "Lanzar tarea"}
                </button>
              </div>
              {create.isError && <p className="error task-form-error" role="alert">{errorText(create.error)}</p>}
            </form>
          </section>
        )}
        <ProgramadasPanel />
      </main>
    </div>
  );
}
// Detalle de una tarea: estado, resumen, terminal, revisión de cambios e historial.
function DetalleTarea({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Líneas del agente que llegaron en vivo desde la última carga del terminal.
  const [vivas, setVivas] = useState<string[]>([]);

  const tarea = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.getTask(id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 3_000 : false),
  });
  const t = tarea.data;
  const activa = t ? isActive(t) : false;
  const enCurso = t?.status === "running" || t?.status === "analyzing";
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
    // Los pasos y los turnos de los chats no son de esta tarea.
    if (evento.tipo === "actividad" || evento.tipo === "chat" || evento.tipo === "configuracion_chat") return;
    void qc.invalidateQueries({ queryKey: ["task", id] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    // Solo cuando la tarea ya no puede cambiar: el diff y la salida quedan listos.
    if (evento.status === "done" || evento.status === "failed" || evento.status === "cancelled" || evento.status === "interrupted") {
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
  // Tras una cuota agotada: el modelo elegido y su esfuerzo. Sin elegir, sigue el modelo agotado (y no se activa Seguir).
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [modeloElegido, setModeloElegido] = useState<{ id: string; esfuerzo: string | null } | null>(null);
  const seguir = useMutation({
    mutationFn: (eleccion: { model: string; effort: string | null }) => api.continueTask(id, eleccion),
    onSuccess: () => setModeloElegido(null),
    onSettled: refrescar,
  });
  const reintentar = useMutation({
    mutationFn: () => api.retryTask(id),
    onSuccess: (nueva) => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void navigate({ to: "/tareas/$id", params: { id: nueva.id } });
    },
  });

  // Aprobar el plan lo pone en la cola; rechazarlo cancela la tarea. Las notas viajan con la decisión.
  const aprobarPlan = useMutation({
    mutationFn: (notas: string) => {
      if (!t?.plan_hash) throw new Error("No hay un plan vigente para aprobar");
      return api.approveTaskPlan(id, { ...(notas ? { notas } : {}), plan_hash: t.plan_hash, secretos: t.plan?.secretos_requeridos });
    },
    onSettled: refrescar,
  });
  const rechazarPlan = useMutation({
    mutationFn: (motivo: string) => api.rejectTaskPlan(id, motivo ? { motivo } : {}),
    onSettled: refrescar,
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
    <div className="page-wrap tk-pagina">
      <main className="container tk-principal">
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
                <div className="tk-estado-linea">
                  <p className="folder-note">
                    {STATUS_LABEL[t.status]} · {modelName}
                    {t.effort ? ` · ${effortLabel(t.effort)}` : ""}
                  </p>
                  {t.status === "done" && (
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => reintentar.mutate()}
                      disabled={reintentar.isPending}
                      title="Crea una tarea nueva con el mismo prompt y el mismo proyecto"
                    >
                      {reintentar.isPending ? "Creando…" : "Ejecutar de nuevo"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

      {tarea.isPending && !tarea.data && <LoadingSkeleton tipo="contenido" cantidad={4} />}

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

          {t.plan && (
            <PlanTarea
              plan={t.plan}
              aguardaAprobacion={t.status === "waiting_approval"}
              ocupado={aprobarPlan.isPending || rechazarPlan.isPending}
              error={aprobarPlan.isError || rechazarPlan.isError ? errorText(aprobarPlan.error ?? rechazarPlan.error) : null}
              onAprobar={(notas) => aprobarPlan.mutate(notas)}
              onRechazar={(motivo) => rechazarPlan.mutate(motivo)}
            />
          )}

          {t.reporte && <ReporteTarea reporte={t.reporte} />}

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

            {t.result && !t.reporte && (
              <div className="tarea-bloque">
                <span className="tarea-etiqueta">Resultado</span>
                <div className="tarea-texto">{t.result}</div>
              </div>
            )}

            {t.status === "sin_cuota" && (
              <AvisoCuota
                modeloAgotado={models.data?.models.find((m) => m.id === t.modelo_agotado)?.name ?? t.modelo_agotado ?? t.model}
                modeloSeleccionado={models.data?.models.find((m) => m.id === (modeloElegido?.id ?? t.model))?.name ?? modeloElegido?.id ?? t.model}
                puedeSeguir={(modeloElegido?.id ?? t.model) !== t.modelo_agotado}
                seguirPendiente={seguir.isPending}
                onCambiarModelo={() => setSelectorAbierto(true)}
                onSeguir={() =>
                  seguir.mutate({
                    model: modeloElegido?.id ?? t.model,
                    effort: modeloElegido?.esfuerzo ?? null,
                  })
                }
                error={seguir.isError ? errorText(seguir.error) : null}
              />
            )}
            {selectorAbierto && (
              <div className="cuota-selector">
                <ModelPicker
                  models={models.data?.models ?? []}
                  currentId={modeloElegido?.id ?? t.model}
                  conEsfuerzo
                  currentEffort={modeloElegido?.esfuerzo ?? t.effort}
                  onSelect={(m, esfuerzo) => {
                    setSelectorAbierto(false);
                    if (m) setModeloElegido({ id: m.id, esfuerzo: esfuerzo ?? null });
                  }}
                  onClose={() => setSelectorAbierto(false)}
                  cargando={models.isPending}
                  error={models.isError ? errorText(models.error) : null}
                  onReintentar={() => void models.refetch()}
                />
              </div>
            )}

            {t.error && t.status !== "sin_cuota" && (
              <div className="tarea-bloque">
                <span className="tarea-etiqueta">Error</span>
                <p className="error tarea-texto" role="alert">
                  {textoErrorTarea(t.error)}
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
              {((activa && t.status !== "waiting_approval") || t.status === "interrupted" || t.status === "sin_cuota") && (
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
                projectId={t.project_id ?? null}
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
