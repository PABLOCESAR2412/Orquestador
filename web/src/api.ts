export type Conversation = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  project_id?: string | null;
  project_name?: string | null;
  pinned_at?: string | null;
  // Hay un mensaje en curso (puede venir de otro dispositivo).
  ocupada?: boolean;
  created_at: string;
};

export type Project = {
  id: string;
  name: string;
  repo_path: string;
  pinned_at?: string | null;
  created_at: string;
  instrucciones: string | null;
  // Nombre de la carpeta dentro de la raíz de proyectos.
  carpeta: string;
};

export type ProjectDetail = {
  project: Project;
  chats: number;
  tareas: { total: number; en_curso: number; fallidas: number; hechas: number };
  ultima_tarea: Task | null;
  git: {
    rama: string;
    commits: number;
    ultimo_commit: { sha: string; asunto: string; fecha: string } | null;
    sucio: boolean;
  } | null;
  tamano_bytes: number;
};

export type ProjectFileEntry = {
  nombre: string;
  ruta: string;
  tipo: "carpeta" | "archivo";
  tamano: number | null;
  modificado: string;
};

export type ProjectSecretsList = {
  disponible: boolean;
  secretos: { nombre: string; actualizado_en: string }[];
};

// Clave SSH del proyecto (deploy key). La privada nunca llega al navegador.
export type ProjectSshKey = {
  disponible: boolean;
  existe: boolean;
  publica: string | null;
  huella: string | null;
  creada_en: string | null;
};

export type Programada = {
  id: string;
  titulo: string;
  prompt: string;
  model: string;
  effort: string | null;
  project_id: string | null;
  project_name: string | null;
  frecuencia: "cada_horas" | "diaria";
  cada_horas: number | null;
  hora: string | null;
  activa: boolean;
  proxima_en: string;
  ultima_ejecucion: string | null;
  ultima_tarea_id: string | null;
  created_at: string;
};

export type ProgramadaInput =
  | { titulo?: string; prompt: string; model?: string | null; effort?: string | null; projectId?: string | null; frecuencia: "cada_horas"; cada_horas: number }
  | { titulo?: string; prompt: string; model?: string | null; effort?: string | null; projectId?: string | null; frecuencia: "diaria"; hora: string };

export type TaskDiffArchivo = {
  ruta: string;
  estado: "nuevo" | "modificado" | "borrado" | "renombrado";
  adiciones: number;
  eliminaciones: number;
  binario: boolean;
  // Parece un secreto (.env, claves privadas, credenciales). Bloquea el commit.
  sensible: boolean;
};

export type TaskDiff = {
  estado: "sin_repo" | "sin_cambios" | "con_cambios";
  rama: string | null;
  base_commit: string | null;
  commit: string | null;
  archivos: TaskDiffArchivo[];
  diff: string;
  truncado: boolean;
  hash: string | null;
  remoto: boolean;
  aprobaciones: {
    commit: { estado: "pendiente" | "aprobada"; sha: string; hash: string; decidida_en: string; mensaje: string } | null;
    push: { sha: string; remoto: string; decidida_en: string } | null;
  };
};

export type UsoProveedor = {
  id: string;
  nombre: string;
  ultimas5h: { costoUsd: number; tokens: number; llamadas: number };
  ultimos7d: { costoUsd: number; tokens: number; llamadas: number };
  cuotaRestanteUsd: number | null;
  precision: "medida_telo" | "sin_datos";
};

export type ServidorEstado = {
  generado: string;
  proceso: { arrancado: string; segundosActivo: number; bun: string; rssMb: number; plataforma: string };
  disco: { etiqueta: "datos" | "proyectos"; totalBytes: number; usadoBytes: number; libreBytes: number }[];
  carpetas: { nombre: string; bytes: number; archivos: number }[];
  herramientas: { nombre: string; version: string | null; disponible: boolean }[];
  costos: { mesUsd: number; ultimos30dUsd: number; llamadas30d: number; tokens30d: number };
  tareas: { ultimos30d: number; en_cola: number; en_curso: number };
};

export type ProviderStatus = {
  id: string;
  name: string;
  configured: boolean;
  implemented: boolean;
  hint: string;
  // Nombre de la variable de entorno (nunca su valor) y si llega a los agentes.
  variable: string | null;
  enAgente: boolean;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type CostTier = "gratis" | "economico" | "medio" | "alto" | "premium";

export type ModelInfo = {
  id: string;
  provider: string;
  name: string;
  inputUsd: number;
  outputUsd: number;
  context: number;
  variants: string[];
  free: boolean;
  costTier: CostTier;
  costWarning: string | null;
  group: string;
  recommended: boolean;
};

export type TaskStatus = "queued" | "running" | "interrupted" | "done" | "failed" | "cancelled";

export type Task = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  effort: string | null;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  project_id?: string | null;
  // Tarea creada como reintento de otra.
  retry_of?: string | null;
  // Tiene la sesión del agente: puede continuar donde quedó.
  reanudable: boolean;
  // Git: rama de trabajo del clon y commit base (solo tareas de un proyecto con Git).
  rama: string | null;
  base_commit: string | null;
  project_name?: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type TaskEventKind =
  | "creada"
  | "iniciada"
  | "sesion_asignada"
  | "cancelacion_pedida"
  | "interrumpida"
  | "reanudada"
  | "reintento_creado"
  | "terminada"
  | "modelo_respaldo"
  | "clon_creado"
  | "commit_aprobado"
  | "push_aprobado"
  | "push_fallido";

// Evento en vivo del canal /api/eventos-vivos (SSE).
export type EventoVivo =
  | { tipo: "tarea"; id: string; status: TaskStatus; finished_at: string | null }
  | { tipo: "evento"; task_id: string; kind: TaskEventKind; detail: string | null; created_at: string }
  | { tipo: "salida"; task_id: string; linea: string };

export type TaskEvent = {
  id: number;
  task_id: string;
  kind: TaskEventKind;
  detail: string | null;
  created_at: string;
};

export type QuotaAccount = {
  id: string;
  label: string;
  anotadoUsd: number;
  limiteUsd: number | null;
  saldoEstimadoUsd: number;
  usoDesdeAnotacionUsd: number;
  anotadoEn: string;
  nota: string | null;
  precision: "estimado";
};

export type QuotaProvider = {
  id: string;
  nombre: string;
  gastoMesUsd: number;
  cuentas: QuotaAccount[];
  precision: "estimado" | "sin_saldo";
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    // Sin sesión, la app va a la pantalla de entrada (salvo la propia petición de entrar).
    if (res.status === 401 && !path.startsWith("/api/login") && location.pathname !== "/entrar") {
      location.assign("/entrar");
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>("/api/health"),
  runnerStatus: () =>
    request<{ opencode: boolean; bwrap: boolean; aislamiento: boolean }>("/api/runner"),
  sesion: () => request<{ ok: boolean }>("/api/sesion"),
  login: (clave: string) =>
    request<{ ok: boolean }>("/api/login", { method: "POST", body: JSON.stringify({ clave }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST", body: "{}" }),
  listConversations: () => request<Conversation[]>("/api/conversations"),
  createConversation: (projectId?: string | null) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ projectId: projectId ?? null }),
    }),
  listMessages: (id: string) => request<Message[]>(`/api/conversations/${id}/messages`),
  sendMessage: (id: string, content: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  listModels: () => request<{ models: ModelInfo[]; total: number }>("/api/models?all=1"),
  updateConversation: (
    id: string,
    patch: { model?: string | null; effort?: string | null; title?: string; pinned?: boolean },
  ) =>
    request<{
      id: string;
      title: string;
      model: string | null;
      effort: string | null;
      pinned_at: string | null;
      costTier: CostTier | null;
      costWarning: string | null;
    }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  updateProject: (id: string, patch: { name?: string; pinned?: boolean; instrucciones?: string }) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listTaskEvents: (id: string) => request<TaskEvent[]>(`/api/tasks/${id}/eventos`),
  taskOutput: (id: string) => request<{ texto: string; truncado: boolean }>(`/api/tasks/${id}/salida`),
  taskDiff: (id: string) => request<TaskDiff>(`/api/tasks/${id}/diff`),
  approveTask: (id: string, body: { accion: "commit" | "push"; hash: string; mensaje?: string }) =>
    request<{ accion: "commit" | "push"; sha: string; rama: string; remoto?: string }>(
      `/api/tasks/${id}/aprobar`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  listProjectFiles: (id: string, ruta = "") =>
    request<{ ruta: string; entradas: ProjectFileEntry[] }>(
      `/api/projects/${id}/archivos?ruta=${encodeURIComponent(ruta)}`,
    ),
  readProjectFile: (id: string, ruta: string) =>
    request<{ ruta: string; tamano: number; texto: string; truncado: boolean }>(
      `/api/projects/${id}/archivo?ruta=${encodeURIComponent(ruta)}`,
    ),
  listProjectSecrets: (id: string) => request<ProjectSecretsList>(`/api/projects/${id}/secretos`),
  setProjectSecret: (id: string, nombre: string, valor: string) =>
    request<{ nombre: string; actualizado_en: string }>(
      `/api/projects/${id}/secretos/${encodeURIComponent(nombre)}`,
      { method: "PUT", body: JSON.stringify({ valor }) },
    ),
  deleteProjectSecret: (id: string, nombre: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}/secretos/${encodeURIComponent(nombre)}`, { method: "DELETE" }),
  getProjectSshKey: (id: string) => request<ProjectSshKey>(`/api/projects/${id}/clave-ssh`),
  createProjectSshKey: (id: string) => request<ProjectSshKey>(`/api/projects/${id}/clave-ssh`, { method: "POST" }),
  deleteProjectSshKey: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}/clave-ssh`, { method: "DELETE" }),
  listProgramadas: () => request<Programada[]>("/api/programadas"),
  createProgramada: (body: ProgramadaInput) =>
    request<Programada>("/api/programadas", { method: "POST", body: JSON.stringify(body) }),
  updateProgramada: (id: string, patch: { activa: boolean }) =>
    request<Programada>(`/api/programadas/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProgramada: (id: string) =>
    request<{ ok: boolean }>(`/api/programadas/${id}`, { method: "DELETE" }),
  runProgramada: (id: string) =>
    request<Task>(`/api/programadas/${id}/ejecutar`, { method: "POST", body: "{}" }),
  usage: () => request<{ generado: string; proveedores: UsoProveedor[] }>("/api/uso"),
  serverStatus: () => request<ServidorEstado>("/api/servidor"),
  resumeTask: (id: string) => request<Task>(`/api/tasks/${id}/reanudar`, { method: "POST", body: "{}" }),
  retryTask: (id: string) => request<Task>(`/api/tasks/${id}/reintentar`, { method: "POST", body: "{}" }),
  listQuotas: () =>
    request<{ generado: string; proveedores: QuotaProvider[] }>("/api/cuotas"),
  createQuota: (body: { provider: string; label: string; remainingUsd: number; limitUsd?: number | null }) =>
    request<{ id: string }>("/api/cuotas", { method: "POST", body: JSON.stringify(body) }),
  updateQuota: (id: string, body: { remainingUsd: number; limitUsd?: number | null }) =>
    request<{ ok: boolean }>(`/api/cuotas/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteQuota: (id: string) => request<{ ok: boolean }>(`/api/cuotas/${id}`, { method: "DELETE" }),
  listTasks: () => request<Task[]>("/api/tasks?limit=50"),
  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),
  createTask: (body: {
    prompt: string;
    model?: string | null;
    effort?: string | null;
    projectId?: string | null;
  }) =>
    request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  cancelTask: (id: string) =>
    request<{ outcome: string }>(`/api/tasks/${id}/cancel`, { method: "POST", body: "{}" }),
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (body: { name: string } | { path: string; name?: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  listProviders: () => request<ProviderStatus[]>("/api/providers"),
  getPreferences: () => request<Preferences>("/api/preferences"),
  savePreferences: (patch: Partial<Preferences>) =>
    request<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }),
  getAnalytics: (days: number, filtros: { proyecto?: string | null; modelo?: string | null } = {}) => {
    const q = new URLSearchParams({ days: String(days) });
    if (filtros.proyecto) q.set("proyecto", filtros.proyecto);
    if (filtros.modelo) q.set("modelo", filtros.modelo);
    return request<Analytics>(`/api/analytics?${q.toString()}`);
  },
  googleEstado: () => request<GoogleEstado>("/api/google/estado"),
  // Devuelve la URL de Google; la interfaz la abre en la misma pestaña.
  googleConectar: () => request<{ url: string }>("/api/google/conectar", { method: "POST", body: "{}" }),
  googleDesconectar: () => request<{ ok: boolean }>("/api/google", { method: "DELETE" }),
};

// Estado de la conexión con Google. Nunca incluye tokens: solo el correo de la cuenta.
export type GoogleEstado = {
  configurado: boolean;
  faltantes: string[];
  conectado: boolean;
  cuenta: string | null;
  conectado_en: string | null;
};

export type Preferences = {
  defaultModel: string | null;
  defaultEffort: string | null;
  monthlyBudgetUsd: number | null;
  budgetAlertPercent: number;
  // Modelo de respaldo si el principal responde 429 o un error del servidor del proveedor.
  fallbackModel: string | null;
};

export type Analytics = {
  days: number;
  filtros: { proyecto: string | null; modelo: string | null };
  proyectos: { id: string; name: string }[];
  modelos: string[];
  totals: { calls: number; inputTokens: number; outputTokens: number; cost: number };
  byDay: { day: string; cost: number; tokens: number; calls: number }[];
  byModel: {
    model: string;
    cost: number;
    tokens: number;
    calls: number;
    tareas: number;
    duracionMediaSeg: number | null;
    costoPorTareaUsd: number | null;
  }[];
  tasks: Record<TaskStatus, number>;
  budget: {
    monthlyUsd: number;
    spentUsd: number;
    percent: number;
    alertPercent: number;
    status: "ok" | "alerta" | "excedido";
  } | null;
};
