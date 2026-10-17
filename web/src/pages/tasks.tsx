import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { api, type ModelInfo, type Task } from "../api";
import { CostMeter } from "../components/controls";
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
import { effortLabel, errorText, sanearDetalle, STATUS_LABEL } from "../lib/model";
import { AGENTES, agenteDeTarea, haceTexto, nombreAgente, type AgenteId } from "../lib/tareas-vista";
import { EVENTO_VERSION_NUEVA, hayVersionNueva } from "../lib/version";
import { useShell } from "../components/shell-context";
import "../styles-trabajo.css";
import "../styles-tareas.css";

// Una tarea activa tiene proceso o espera una decisión del usuario (el plan).
const isActive = (t: Task) =>
  t.status === "queued" || t.status === "analyzing" || t.status === "running" || t.status === "waiting_approval";
const MAX_PROMPT_CHARS = 10_000;
const MAX_LINEAS_VIVAS = 1_500;
type EstadoFiltro = "all" | "active" | "done";
type AgenteFiltro = "todos" | AgenteId;

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

// Estado en texto y color del punto. El texto dice el estado; el color solo lo refuerza.
function estadoDeTarea(t: Task, posicion?: number): { texto: string; clase: string } {
  switch (t.status) {
    case "running":
      return { texto: `Ejecutando (${formatElapsed(t.started_at)})`, clase: "is-running" };
    case "queued":
      return { texto: posicion ? `En cola (posición ${posicion})` : "En cola", clase: "is-queued" };
    case "done": {
      const hace = haceTexto(t.finished_at);
      return { texto: hace ? `Completada ${hace}` : "Completada", clase: "is-done" };
    }
    case "failed": {
      const hace = haceTexto(t.finished_at);
      return { texto: hace ? `Falló ${hace}` : "Falló", clase: "is-failed" };
    }
    case "cancelled":
      return { texto: "Cancelada", clase: "is-muted" };
    case "interrupted":
      return { texto: "Interrumpida", clase: "is-failed" };
    case "sin_cuota":
      return { texto: "Sin cuota · elige modelo", clase: "is-atencion" };
    case "analyzing":
      return { texto: `Analizando (${formatElapsed(t.started_at)})`, clase: "is-running" };
    case "waiting_approval":
      return { texto: "Espera tu aprobación", clase: "is-atencion" };
  }
}

// Primera línea del prompt, recortada: el resumen real que va bajo el título.
function resumenPrompt(prompt: string): string {
  const linea = prompt.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return linea.length > 160 ? `${linea.slice(0, 157)}…` : linea;
}

// Iconos de trazo: mismo estilo que el resto de la app.
function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function TasksPage() {
  // /tareas/$id muestra el detalle; /tareas, la lista.
  const params = useParams({ strict: false }) as { id?: string };
  if (params.id) return <DetalleTarea id={params.id} />;
  return <ListaTareas />;
}

function ListaTareas() {
  const qc = useQueryClient();
  const { newTaskOpen, setNewTaskOpen } = useShell();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  // "" significa sin proyecto: la tarea usa su carpeta temporal.
  const [projectId, setProjectId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agenteFiltro, setAgenteFiltro] = useState<AgenteFiltro>("todos");
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>("all");
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

  const abrirFormulario = () => {
    setFormOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 60);
  };

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

  const pickModel = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    setPickerOpen(false);
    setModel(m?.id ?? null);
    setEffort(m && esfuerzo && m.variants.includes(esfuerzo) ? esfuerzo : null);
  };

  const submit = () => {
    if (draft.trim() && !create.isPending && draft.length <= MAX_PROMPT_CHARS) {
      create.mutate();
    }
  };

  const modelName = (id: string) => modelList.find((m) => m.id === id)?.name ?? id;

  const taskList = tasks.data ?? [];
  // El analizador también usa el agente, así que cuenta como ejecución.
  const runningCount = taskList.filter((t) => t.status === "running" || t.status === "analyzing").length;
  const queuedCount = taskList.filter((t) => t.status === "queued").length;
  const activasCount = runningCount + queuedCount;
  const doneCount = taskList.filter((t) => t.status === "done").length;
  const completedTodayCount = taskList.filter(
    (t) => t.status === "done" && (isToday(t.finished_at) || isToday(t.created_at)),
  ).length;

  // Tareas por agente, para el segmentado. Un agente sin tareas queda en 0.
  const porAgente = Object.fromEntries(AGENTES.map((a) => [a.id, 0])) as Record<AgenteId, number>;
  for (const t of taskList) porAgente[agenteDeTarea(t)] += 1;
  const opcionesAgente: { id: AgenteFiltro; nombre: string; cuenta: number }[] = [
    { id: "todos", nombre: "Todas", cuenta: taskList.length },
    ...AGENTES.map((a) => ({ id: a.id, nombre: a.nombre, cuenta: porAgente[a.id] })),
  ];

  // Posición en la cola: la tarea más antigua va primero.
  const posiciones = new Map<string, number>();
  [...taskList]
    .filter((t) => t.status === "queued")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((t, i) => posiciones.set(t.id, i + 1));

  // Contador en vivo para tareas corriendo
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!runningCount) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [runningCount]);

  const filteredTasks = useMemo(
    () =>
      taskList.filter((t) => {
        if (agenteFiltro !== "todos" && agenteDeTarea(t) !== agenteFiltro) return false;
        if (estadoFiltro === "active") return isActive(t);
        if (estadoFiltro === "done") return t.status === "done";
        return true;
      }),
    [taskList, agenteFiltro, estadoFiltro],
  );

  // Estado del servidor: solo "activo" si la API responde en este momento.
  const servidorOk = Boolean(health.data?.ok) && !health.isError;
  const claseServidor = health.isError ? "is-failed" : servidorOk ? "is-running" : "";
  const estadoServidor = health.isError ? "Sin conexión" : servidorOk ? "Servidor activo" : "Conectando…";
  const textoPie = health.isError
    ? "Servidor local: sin conexión"
    : servidorOk
      ? "Servidor local: conectado"
      : "Servidor local: conectando…";
  const textoSincro = activasCount > 0 ? (conectado ? "En vivo" : "Auto-sync 3 s") : "En reposo";

  return (
    <div className="page-wrap tk-pagina">
      <main className="container tk-principal">
        <header className="tk-cabecera">
          <div className="tk-cabecera-texto">
            <span className="tk-servidor" role="status">
              <span className={`tk-punto ${claseServidor}`} aria-hidden="true" />
              {estadoServidor}
            </span>
            <h1 className="tk-titulo-pagina">Tareas del Servidor</h1>
            <p className="tk-descripcion">
              Tareas que siguen corriendo en el servidor aunque cierres la app o apagues el teléfono.
            </p>
          </div>
          <div className="tk-cabecera-acciones">
            <button
              type="button"
              className="tk-boton"
              disabled
              title="La terminal remota todavía no está disponible en Telo."
            >
              <Svg>
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </Svg>
              Terminal remota
            </button>
            <button type="button" className="tk-boton tk-boton-primario" onClick={abrirFormulario}>
              <Svg>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </Svg>
              Nueva tarea
            </button>
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
                  conEsfuerzo
                  currentEffort={effort}
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

        {/* Tres tarjetas con cifras reales; la barra muestra la parte de la cola activa o de lo terminado */}
        <section className="tk-kpis" aria-label="Resumen de tareas">
          <Kpi
            titulo="En ejecución"
            icono={
              <Svg>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </Svg>
            }
            cifra={runningCount}
            texto={runningCount === 1 ? "activa" : "activas"}
            proporcion={activasCount ? runningCount / activasCount : 0}
          />
          <Kpi
            titulo="Planificadas"
            icono={
              <Svg>
                <path d="M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10" />
              </Svg>
            }
            cifra={queuedCount}
            texto="en cola de espera"
            proporcion={activasCount ? queuedCount / activasCount : 0}
          />
          <Kpi
            titulo="Completadas"
            icono={
              <Svg>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </Svg>
            }
            cifra={completedTodayCount}
            texto="hoy"
            proporcion={doneCount ? completedTodayCount / doneCount : 0}
          />
        </section>

        {/* Filtros por agente y por estado, y sincronización */}
        <div className="tk-barra-filtros">
          <div className="tk-segmentado" role="group" aria-label="Filtrar por agente">
            {opcionesAgente.map((op) => (
              <button
                key={op.id}
                type="button"
                className="tk-segmento"
                aria-pressed={agenteFiltro === op.id}
                onClick={() => setAgenteFiltro(op.id)}
              >
                {op.nombre}
                <span className="tk-cuenta">{op.cuenta}</span>
              </button>
            ))}
          </div>

          <div className="tk-sincro">
            <select
              className="tk-select"
              aria-label="Estado de las tareas"
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)}
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activas ({activasCount})</option>
              <option value="done">Completadas ({doneCount})</option>
            </select>
            <span className="tk-sincro-texto">
              <span className={`tk-punto${activasCount > 0 ? " is-running" : ""}`} aria-hidden="true" />
              {textoSincro}
            </span>
            <button
              type="button"
              className="tk-boton tk-boton-icono"
              onClick={() => void actualizar()}
              disabled={buscando}
              aria-label="Actualizar tareas"
              title="Actualizar tareas y buscar cambios de la app"
            >
              <Svg size={14}>
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </Svg>
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
          <p className="tk-vacio">
            {taskList.length === 0
              ? "Todavía no hay tareas. Lanza una nueva con el botón Nueva tarea."
              : estadoFiltro === "active"
                ? "No hay tareas activas en cola ni en ejecución."
                : estadoFiltro === "done"
                  ? "Todavía no hay tareas completadas con estos filtros."
                  : "Ninguna tarea coincide con estos filtros."}
          </p>
        )}

        {/* Lista de tarjetas: cada una abre el detalle en /tareas/$id */}
        <ul className="tk-lista">
          {filteredTasks.map((t) => (
            <li key={t.id}>
              <TarjetaTarea
                t={t}
                posicion={posiciones.get(t.id)}
                modelo={modelName(t.model)}
                cancelando={cancel.isPending}
                onCancelar={() => cancel.mutate(t.id)}
              />
            </li>
          ))}
        </ul>

        <ProgramadasPanel />

        {/* Pie con el estado del servidor y de la cola, sin métricas inventadas */}
        <footer className="tk-pie">
          <div className="tk-pie-estado">
            <span className={`tk-punto ${claseServidor}`} aria-hidden="true" />
            <span>{textoPie}</span>
            <span className="tk-pie-sep" aria-hidden="true">·</span>
            <span>{queuedCount > 0 ? `${queuedCount} en espera` : "Cola libre"}</span>
          </div>
          <div className="tk-pie-acciones">
            {avisoActualizar && (
              <span className="tk-aviso" role="status">
                {avisoActualizar}
              </span>
            )}
            <button
              type="button"
              className="tk-boton tk-boton-pequeno"
              onClick={() => void actualizar()}
              disabled={buscando}
              title="Actualizar tareas y buscar cambios de la app"
            >
              <Svg size={14}>
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </Svg>
              {buscando ? "Buscando…" : "Actualizar"}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

function Kpi({
  titulo,
  icono,
  cifra,
  texto,
  proporcion,
}: {
  titulo: string;
  icono: ReactNode;
  cifra: number;
  texto: string;
  proporcion: number;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, proporcion)) * 100);
  return (
    <div className="tk-kpi">
      <div className="tk-kpi-cabeza">
        <span className="tk-kpi-etiqueta">{titulo}</span>
        <span className="tk-kpi-icono" aria-hidden="true">
          {icono}
        </span>
      </div>
      <div className="tk-kpi-cifra">
        <span className="tk-kpi-num">{cifra}</span>
        <span className="tk-kpi-texto">{texto}</span>
      </div>
      <div className="tk-barra" aria-hidden="true">
        <span className="tk-barra-relleno" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Tarjeta de una tarea: agente, estado con tiempo, título, resumen real y acciones.
function TarjetaTarea({
  t,
  posicion,
  modelo,
  cancelando,
  onCancelar,
}: {
  t: Task;
  posicion?: number;
  modelo: string;
  cancelando: boolean;
  onCancelar: () => void;
}) {
  const estado = estadoDeTarea(t, posicion);
  const resumen = resumenPrompt(t.prompt);
  const enCurso = t.status === "running";
  const cancelable = t.status === "queued" || t.status === "interrupted" || t.status === "sin_cuota";

  return (
    <article className="tk-tarjeta">
      <div className="tk-tarjeta-cabeza">
        <span className="tk-chip">{nombreAgente(agenteDeTarea(t))}</span>
        <span className="tk-estado">
          <span className={`tk-punto ${estado.clase}`} aria-hidden="true" />
          {estado.texto}
        </span>
      </div>

      <div className="tk-tarjeta-fila">
        <div className="tk-cuerpo">
          <Link to="/tareas/$id" params={{ id: t.id }} className="tk-titulo-enlace">
            <h3 className="tk-titulo">{t.title}</h3>
          </Link>
          {resumen && <p className="tk-resumen">↳ {resumen}</p>}
        </div>

        {/* Detener solo para tareas corriendo; Cancelar para las que esperan o quedaron interrumpidas */}
        <div className="tk-acciones">
          <Link to="/tareas/$id" params={{ id: t.id }} className="tk-boton tk-boton-pequeno">
            <Svg size={14}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <polyline points="7 9 10 12 7 15" />
              <line x1="13" y1="15" x2="17" y2="15" />
            </Svg>
            Ver logs
          </Link>
          {enCurso && (
            <button
              type="button"
              className="tk-boton tk-boton-pequeno tk-boton-peligro"
              onClick={onCancelar}
              disabled={cancelando}
              title="Detiene la ejecución de esta tarea."
            >
              <Svg size={12}>
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </Svg>
              Detener
            </button>
          )}
          {cancelable && (
            <button
              type="button"
              className="tk-boton tk-boton-pequeno"
              onClick={onCancelar}
              disabled={cancelando}
              title="Cancela esta tarea."
            >
              <Svg size={12}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </Svg>
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="tk-pie-tarjeta">
        <span>
          {modelo} · {t.project_name ?? "Sin proyecto"}
        </span>
        <span>ID {t.id.slice(0, 8)}</span>
      </div>
    </article>
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
    if (evento.tipo === "actividad" || evento.tipo === "chat") return;
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
      return api.approveTaskPlan(id, { ...(notas ? { notas } : {}), plan_hash: t.plan_hash });
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
