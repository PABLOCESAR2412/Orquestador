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
};

export type ProviderStatus = {
  id: string;
  name: string;
  configured: boolean;
  implemented: boolean;
  hint: string;
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
  | "terminada";

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
  updateProject: (id: string, patch: { name?: string; pinned?: boolean }) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listTaskEvents: (id: string) => request<TaskEvent[]>(`/api/tasks/${id}/eventos`),
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
  createProject: (body: { path: string; name?: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  listProviders: () => request<ProviderStatus[]>("/api/providers"),
  getPreferences: () => request<Preferences>("/api/preferences"),
  savePreferences: (patch: Partial<Preferences>) =>
    request<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }),
  getAnalytics: (days: number) => request<Analytics>(`/api/analytics?days=${days}`),
};

export type Preferences = {
  defaultModel: string | null;
  defaultEffort: string | null;
  monthlyBudgetUsd: number | null;
  budgetAlertPercent: number;
};

export type Analytics = {
  days: number;
  totals: { calls: number; inputTokens: number; outputTokens: number; cost: number };
  byDay: { day: string; cost: number; tokens: number; calls: number }[];
  byModel: { model: string; cost: number; tokens: number; calls: number }[];
  tasks: Record<TaskStatus, number>;
  budget: {
    monthlyUsd: number;
    spentUsd: number;
    percent: number;
    alertPercent: number;
    status: "ok" | "alerta" | "excedido";
  } | null;
};
