export type Conversation = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  project_id?: string | null;
  project_name?: string | null;
  created_at: string;
};

export type Project = {
  id: string;
  name: string;
  repo_path: string;
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

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

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
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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
  updateConversation: (id: string, patch: { model?: string | null; effort?: string | null }) =>
    request<{
      id: string;
      model: string | null;
      effort: string | null;
      costTier: CostTier | null;
      costWarning: string | null;
    }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
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
