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
  en_proceso?: boolean;
  pendiente_aprobacion?: boolean;
  completada?: boolean;
  estado_tarea?: "en_proceso" | "pendiente_aprobacion" | "completada" | null;
  estado_tarea_id?: string | null;
  estado_tarea_version?: string | null;
  tiene_sesion?: boolean;
  last_message_at?: string | null;
  // Modelo que se quedó sin cuota en el último turno: el chat espera a que se cambie de modelo y se siga.
  cuota_modelo?: string | null;
  created_at: string;
  parent_conversation_id?: string | null;
  parent_turn_id?: string | null;
  subagent_turn_id?: string | null;
  subagent_agent?: string | null;
  subagent_prompt?: string | null;
  subagent_status?: "running" | "done" | "failed" | "cancelled" | "interrupted" | null;
  subagent_result?: string | null;
  subchats?: Conversation[];
};

export type SubagentChat = Pick<Conversation,
  "id" | "title" | "model" | "effort" | "project_id" | "parent_conversation_id" | "parent_turn_id" |
  "project_name" | "ocupada" | "en_proceso" | "subagent_turn_id" | "subagent_agent" | "subagent_prompt" |
  "subagent_status" | "subagent_result" | "created_at" | "last_message_at"
>;

export type FormatoDocumento = "docx" | "xlsx" | "html" | "txt" | "md";

// Documento guardado desde un mensaje del chat. El archivo se pide aparte (archivo) o en vista previa.
export type Documento = {
  id: string;
  conversation_id: string;
  titulo: string;
  formato: FormatoDocumento;
  bytes: number;
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
  // Repo de GitHub de origen (si el proyecto se creó clonándolo) y cuándo se clonó. Sin clonado, la carpeta espera.
  origen_url?: string | null;
  clonado_en?: string | null;
  // Actividad del proyecto (GET /api/projects): chats, tareas y el último mensaje o tarea. Null si no hay.
  chats?: number;
  tareas?: number;
  ultima_actividad?: string | null;
  en_proceso?: boolean;
  pendiente_aprobacion?: boolean;
};

// Revisión de un repo de GitHub sin clave: público o privado (un nombre mal escrito también parece privado).
export type VerificacionGithub = {
  url: string;
  repo: string;
  visibilidad: "publico" | "privado";
  credencial?: "app";
};

// Clonado iniciado en el chat del proyecto: el mensaje de la instrucción y el chat donde se ve el avance.
export type ClonadoIniciado = { conversacion_id: string; turno_id: string };

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
  // Lo que los agentes aprendieron del proyecto. Es nota del agente, no órdenes.
  memoria: {
    texto: string | null;
    actualizada_en: string | null;
    propuesta?: string | null;
    propuesta_en?: string | null;
    propuesta_tarea_id?: string | null;
  };
};

export type ProjectFileEntry = {
  nombre: string;
  ruta: string;
  tipo: "carpeta" | "archivo";
  tamano: number | null;
  modificado: string;
};

export type ChatPdfInfo = { ruta: string; nombre: string; tamano: number };
export type ChatImageInfo = { ruta: string; nombre: string; mime: string; tamano: number };
export type ChatVideoInfo = ChatImageInfo;

export function urlPdfConversacion(conversationId: string, ruta: string, descargar = false, meta = false): string {
  const query = new URLSearchParams({ ruta });
  if (descargar) query.set("descargar", "1");
  if (meta) query.set("meta", "1");
  return `/api/conversations/${encodeURIComponent(conversationId)}/archivo-pdf?${query}`;
}

export function urlArchivoConversacion(conversationId: string, ruta: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/archivo?${new URLSearchParams({ ruta })}`;
}

export function urlImagenConversacion(conversationId: string, ruta: string, descargar = false, meta = false): string {
  const query = new URLSearchParams({ ruta });
  if (descargar) query.set("descargar", "1");
  if (meta) query.set("meta", "1");
  return `/api/conversations/${encodeURIComponent(conversationId)}/archivo-imagen?${query}`;
}

export function urlVideoConversacion(conversationId: string, ruta: string, descargar = false, meta = false): string {
  const query = new URLSearchParams({ ruta });
  if (descargar) query.set("descargar", "1");
  if (meta) query.set("meta", "1");
  return `/api/conversations/${encodeURIComponent(conversationId)}/archivo-video?${query}`;
}

export function urlAdjuntoImagenChat(conversationId: string, adjuntoId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/adjuntos/${encodeURIComponent(adjuntoId)}`;
}

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

export type TaskDiff =
  | { estado: "en_curso" }
  | {
      estado: "sin_repo" | "sin_cambios" | "con_cambios";
      rama: string | null;
      base_commit: string | null;
      commit: string | null;
      archivos: TaskDiffArchivo[];
      diff: string;
      truncado: boolean;
      hash: string | null;
      remoto: boolean;
      remoto_url?: string | null;
      aprobaciones: {
        commit: { estado: "pendiente" | "aprobada"; sha: string; hash: string; decidida_en: string; mensaje: string } | null;
        push: { sha: string; remoto: string; rama?: string; autenticacion?: FuenteAutenticacionGithub | null; decidida_en: string } | null;
      };
      identidad_git?: string;
    };

export type GoogleLiveMetrics = {
  conectado: boolean;
  estado: "activo" | "agotado" | "sin_clave" | "clave_invalida" | "desconectado";
  mensaje: string;
  limiteRpd: number;
  llamadasHoy: number;
  restantesRpd: number;
  porcentajeRestante: number;
  limiteRpm: number;
  tokensHoy: number;
  costoHoyUsd: number;
  ultimaComprobacion: string;
};

export type UsoProveedor = {
  id: string;
  nombre: string;
  ultimas5h: { costoUsd: number; tokens: number; llamadas: number };
  ultimos7d: { costoUsd: number; tokens: number; llamadas: number };
  cuotaRestanteUsd: number | null;
  precision: "medida_telo" | "sin_datos";
  googleLive?: GoogleLiveMetrics;
};

// Estado de la unidad orquestador en systemd. Fuera de systemd (desarrollo), disponible es false.
export type ServicioEstado = {
  disponible: boolean;
  activo: string | null;
  subestado: string | null;
  desde: string | null;
  pid: number | null;
};

// Últimas líneas del diario del servicio, ya redactadas por el servidor.
export type RegistrosServidor = { lineas: number; texto: string; generado: string };

export type ServidorEstado = {
  generado: string;
  proceso: { arrancado: string; segundosActivo: number; bun: string; commit: string | null; rssMb: number; plataforma: string };
  disco: { etiqueta: "datos" | "proyectos"; totalBytes: number; usadoBytes: number; libreBytes: number }[];
  carpetas: { nombre: string; bytes: number; archivos: number; truncado: boolean }[];
  herramientas: { nombre: string; version: string | null; disponible: boolean }[];
  costos: { mesUsd: number; ultimos30dUsd: number; llamadas30d: number; tokens30d: number };
  tareas: { ultimos30d: number; en_cola: number; en_curso: number; max_simultaneas: number };
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
  // La clave se puede guardar desde Ajustes, y `guardada` dice si ya está guardada ahí.
  guardable: boolean;
  guardada: boolean;
  sesion: boolean;
};

export type ConexionMcp = {
  id: string;
  nombre: string;
  url: string;
  habilitada: boolean;
  autenticacion_configurada: boolean;
  creada_en: string;
  actualizada_en: string;
};

export type ConexionMcpInput = {
  nombre?: string;
  url?: string;
  token?: string;
  habilitada?: boolean;
  quitar_token?: boolean;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  model: string | null;
  effort: string | null;
};

export type ContextoConversacion = {
  conversation: {
    id: string;
    title: string;
    provider: string | null;
    model: string | null;
    effort: string | null;
    sessionId: string | null;
    sessionModel: string | null;
    createdAt: string;
    lastActivity: string | null;
  };
  messages: { total: number; user: number; assistant: number; system: number };
  actions: number;
  usage: {
    calls: number;
    chatCalls: number;
    taskCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    measured: number;
    estimated: number;
    unavailable: number;
    unknown: number;
  };
  byModel: {
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  lastInput: {
    provider: string;
    model: string;
    inputTokens: number;
    tokensPrecision: string;
    createdAt: string;
  } | null;
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

export type ArtificialAnalysisIndex = {
  configurado: boolean;
  disponible: boolean;
  version: number | null;
  modelos: { slug: string; name: string; creador: string | null; score: number }[];
};

// analyzing: el analizador escribe el plan. waiting_approval: el plan espera la decisión del usuario.
// sin_cuota: el modelo se quedó sin tokens; la tarea espera un modelo distinto para seguir.
export type TaskStatus =
  | "queued"
  | "analyzing"
  | "waiting_approval"
  | "running"
  | "interrupted"
  | "sin_cuota"
  | "done"
  | "failed"
  | "cancelled";

export type TaskPlanStep = { id: number; descripcion: string; archivos: string[] };

// Plan del analizador (AGENTS.md). `notas` son las que el usuario escribió al aprobarlo.
export type TaskPlan = {
  objetivo: string;
  supuestos: string[];
  pasos: TaskPlanStep[];
  criterios_de_aceptacion: string[];
  requiere_aprobacion: ("commit" | "push" | "pr")[];
  riesgos: string[];
  preguntas: string[];
  notas?: string;
};

// Reporte del obrero. `desviacion` trae el motivo cuando el obrero no siguió el plan.
export type TaskReport = {
  estado: "completado" | "fallo" | "desviacion";
  resumen: string;
  cambios: { archivo: string; tipo: string }[];
  pruebas: { comando: string; resultado: string }[];
  pendientes: string[];
  diff_disponible: boolean;
  desviacion: string | null;
};

export type Task = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  effort: string | null;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  // Plan y reporte son null hasta que el analizador y el obrero los entregan.
  plan: TaskPlan | null;
  reporte: TaskReport | null;
  plan_aprobado_en: string | null;
  conversation_id?: string | null;
  plan_hash?: string | null;
  approved_hash?: string | null;
  project_id?: string | null;
  // Tarea creada como reintento de otra.
  retry_of?: string | null;
  // Tiene la sesión del agente: puede continuar donde quedó.
  reanudable: boolean;
  // Modelo que se quedó sin cuota (solo en tareas sin_cuota).
  modelo_agotado?: string | null;
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
  | "push_fallido"
  | "push_reintegrado"
  | "plan_creado"
  | "plan_pendiente"
  | "plan_aprobado"
  | "plan_rechazado"
  | "replanificada"
  | "obrero_iniciado"
  | "comprobacion_fallida"
  | "comprobacion_aviso"
  | "plan_revision"
  | "sin_cuota"
  | "clasificacion_jev"
  | "memoria_evaluada"
  | "memoria_propuesta"
  | "seguida";

// Evento en vivo del canal /api/eventos-vivos (SSE).
// Un paso del agente en un chat, en orden dentro de su turno. Un texto intermedio trae el texto en
// `titulo`; una acción trae su título, su herramienta y una vista previa en `detalle`.
export type PasoActividad = {
  seq: number;
  tipo: "texto" | "accion";
  herramienta: string | null;
  titulo: string;
  detalle: string | null;
  estado: "hecha" | "error" | "texto" | "en_curso";
};

export type MedioJob = {
  id: string;
  conversation_id: string;
  message_id: string;
  tipo: "imagen" | "video";
  prompt: string;
  modelo: string;
  resolucion: string;
  relacion: string;
  duracion_segundos: number | null;
  costo_estimado_usd: number;
  estado: "pendiente" | "generando" | "completada" | "error" | "cancelada";
  mime: string | null;
  bytes: number | null;
  nombre_archivo: string | null;
  error: string | null;
  api_google_configurada: boolean;
  created_at: string;
  updated_at: string;
};

export type CapacidadesMediosApi = {
  politica: "sin_generacion_multimedia_externa_facturable";
  imagen: { ruta: "modelo_seleccionado_y_herramientas_locales" };
  video: { ruta: "modelo_seleccionado_y_herramientas_locales" };
  voz: { ruta: "herramienta_local_o_servidor_mcp_configurado" };
};

export type EventoVivo =
  | { tipo: "tarea"; id: string; status: TaskStatus; finished_at: string | null }
  | { tipo: "evento"; task_id: string; kind: TaskEventKind; detail: string | null; created_at: string }
  | { tipo: "salida"; task_id: string; linea: string }
  | { tipo: "actividad"; conversacion_id: string; turno_id: string; paso: PasoActividad }
  // Un turno del chat empezó o terminó: los demás dispositivos vuelven a pedir sus mensajes.
  | { tipo: "chat"; conversacion_id: string; estado: "en_curso" | "terminado" };

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
    readonly matches?: string[],
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Sin sesión, la app va a la pantalla de entrada (salvo la propia petición de entrar).
    if (res.status === 401 && !path.startsWith("/api/login") && location.pathname !== "/entrar") {
      location.assign("/entrar");
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
      mensaje?: string;
      matches?: unknown;
    };
    const matches = Array.isArray(body.matches)
      ? body.matches.filter((ruta): ruta is string => typeof ruta === "string")
      : undefined;
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.detail ?? body.mensaje, matches);
  }
  return res.json() as Promise<T>;
}

async function requestPdf(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: { Accept: "application/pdf" } });
  if (!res.ok) {
    if (res.status === 401 && location.pathname !== "/entrar") location.assign("/entrar");
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; mensaje?: string };
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.detail ?? body.mensaje);
  }
  if (!res.headers.get("content-type")?.toLowerCase().includes("application/pdf")) {
    throw new ApiError(415, "formato_pdf_invalido", "El servidor no devolvió un documento PDF.");
  }
  const archivo = await res.blob();
  if (archivo.size === 0) throw new ApiError(415, "formato_pdf_invalido", "El PDF está vacío.");
  return archivo;
}

// Instalación de una herramienta del servidor (hoy OpenCode). El servidor solo ejecuta su comando fijo.
export type InstalacionHerramienta = {
  herramienta: string;
  nombre: string;
  comando: string;
  estado: "inactiva" | "instalando" | "lista" | "error";
  instalada: boolean;
  iniciada: string | null;
  terminada: string | null;
  motivo: string | null;
  salida: string;
};

// Inicio de sesión de Codex por código de dispositivo. El token nunca llega a la app.
export type LoginCodex = {
  estado: "inactivo" | "esperando" | "conectado" | "fallido";
  conectada: boolean;
  url: string | null;
  codigo: string | null;
  salida: string;
  motivo: string | null;
  iniciada: string | null;
};

export type ModeloCodex = { id: string; name: string; context: number; variants: string[] };

export type SkillResumen = {
  nombre: string;
  descripcion: string | null;
  valida: boolean;
  bytes: number;
  modificada: string;
};

export type SkillDetalle = SkillResumen & { contenido: string };

// Skills globales (sin proyecto) o las del proyecto indicado.
function skillsRuta(projectId?: string): string {
  return projectId ? `/api/projects/${projectId}/skills` : "/api/skills";
}

export const api = {
  projectGit: (id: string) => request<GitConfig>(`/api/projects/${id}/git`),
  saveProjectGit: (
    id: string,
    body: Pick<GitConfig, "remote" | "author_name" | "base_branch">,
  ) =>
    request<{ ok: boolean }>(`/api/projects/${id}/git`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  checkProjectGit: (id: string, action: "push" | "pr" | "merge" = "push") =>
    request<{
      ok: boolean;
      repo: string;
      push: boolean | null;
      autenticacion: FuenteAutenticacionGithub;
      verificacion: "confirmada" | "no_verificada";
      aviso: string | null;
    }>(`/api/projects/${id}/git/comprobar`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  projectContext: (id: string) =>
    request<{ compartir: boolean; chats: { id: string; title: string; mensajes: number }[] }>(
      `/api/projects/${id}/contexto`,
    ),
  saveProjectContext: (id: string, compartir: boolean) =>
    request<{ ok: boolean }>(`/api/projects/${id}/contexto`, {
      method: "PUT",
      body: JSON.stringify({ compartir }),
    }),
  projectSkills: (id: string) => request<ProjectSkill[]>(`/api/projects/${id}/skills-importadas`),
  searchSkills: (q: string) =>
    request<{ name: string; url: string }[]>(`/api/skills/catalogo/buscar?q=${encodeURIComponent(q)}`),
  saveProjectSkill: (id: string, body: { name?: string; content?: string; url?: string }) =>
    request<ProjectSkill>(`/api/projects/${id}/skills-importadas`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteProjectSkill: (id: string, name: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}/skills-importadas/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  conversationTasks: (id: string) => request<Task[]>(`/api/conversations/${id}/tasks`),
  decidePlan: (
    id: string,
    optsOrHash: string | { decision: "approve" | "revise"; plan_hash: string; feedback?: string },
    decision?: "approve" | "revise",
    feedback?: string,
  ) => {
    const body =
      typeof optsOrHash === "string"
        ? { decision, hash: optsOrHash, plan_hash: optsOrHash, feedback }
        : {
            decision: optsOrHash.decision,
            hash: optsOrHash.plan_hash,
            plan_hash: optsOrHash.plan_hash,
            feedback: optsOrHash.feedback,
          };
    return request<Task>(`/api/tasks/${id}/plan`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  repositoryActions: (id: string) =>
    request<RepositoryAction[]>(`/api/conversations/${id}/acciones`),
  requestRepositoryAction: (
    id: string,
    body: {
      action: string;
      conversationId?: string;
      taskId?: string;
      messageId?: string;
      message?: string;
      title?: string;
      pr_number?: number;
      pr_url?: string;
    },
  ) =>
    request<RepositoryAction>(`/api/projects/${id}/acciones`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  decideRepositoryAction: (id: string, approve: boolean, destino?: "base" | "rama") =>
    request<{ ok: boolean; result?: unknown }>(`/api/acciones/${id}/decidir`, {
      method: "POST",
      body: JSON.stringify({ approve, ...(destino ? { destino } : {}) }),
    }),
  resolveRepositoryConflicts: (id: string) =>
    request<{ task_id: string; reutilizada: boolean }>(`/api/acciones/${id}/resolver-conflictos`, {
      method: "POST",
      body: "{}",
    }),
  verifyRepositoryConflicts: (id: string) =>
    request<VerificacionConflictos>(`/api/acciones/${id}/verificar-conflictos`, {
      method: "POST",
      body: "{}",
    }),

  health: () => request<{ ok: boolean; time: string }>("/api/health"),
  runnerStatus: () =>
    request<{ opencode: boolean; bwrap: boolean; aislamiento: boolean }>("/api/runner"),
  sesion: () => request<{ ok: boolean }>("/api/sesion"),
  login: (clave: string) =>
    request<{ ok: boolean }>("/api/login", { method: "POST", body: JSON.stringify({ clave }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST", body: "{}" }),
  listConversations: () => request<Conversation[]>("/api/conversations"),
  createConversation: (projectId?: string | null, title?: string) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ projectId: projectId ?? null, title }),
    }),
  listMessages: (id: string) => request<Message[]>(`/api/conversations/${id}/messages`),
  conversationContext: (id: string) => request<ContextoConversacion>(`/api/conversations/${id}/contexto`),
  uploadChatImage: (id: string, archivo: File) => {
    const body = new FormData();
    body.append("archivo", archivo, archivo.name);
    return request<{ id: string; nombre: string; mime: string; bytes: number }>(`/api/conversations/${id}/adjuntos`, {
      method: "POST",
      body,
    });
  },
  chatPdfInfo: (id: string, ruta: string) => request<ChatPdfInfo>(urlPdfConversacion(id, ruta, false, true)),
  chatPdf: (id: string, ruta: string) => requestPdf(urlPdfConversacion(id, ruta)),
  chatFile: (id: string, ruta: string) => request<{ ruta: string; tamano: number; texto: string; truncado: boolean }>(urlArchivoConversacion(id, ruta)),
  chatImageInfo: (id: string, ruta: string) => request<ChatImageInfo>(urlImagenConversacion(id, ruta, false, true)),
  chatVideoInfo: (id: string, ruta: string) => request<ChatVideoInfo>(urlVideoConversacion(id, ruta, false, true)),
  // Pasos del agente de un turno (el id es el del mensaje del usuario).
  listTurnoActividad: (conversacionId: string, turnoId: string) =>
    request<PasoActividad[]>(`/api/conversations/${conversacionId}/turnos/${turnoId}/actividad`),
  listSubagentes: (conversacionId: string, turnoId: string) =>
    request<SubagentChat[]>(`/api/conversations/${conversacionId}/turnos/${turnoId}/subagentes`),
  capacidadesMedios: () => request<CapacidadesMediosApi>("/api/media/capacidades"),
  medio: (id: string) => request<MedioJob>(`/api/media/${encodeURIComponent(id)}`),
  cancelarMedio: (id: string) => request<{ ok: boolean }>(`/api/media/${encodeURIComponent(id)}/cancelar`, { method: "POST", body: "{}" }),
  sendMessage: (id: string, content: string, retryOf?: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, ...(retryOf ? { retryOf } : {}) }),
    }),
  listModels: () => request<{ models: ModelInfo[]; total: number }>("/api/models?all=1"),
  modelIntelligence: () => request<ArtificialAnalysisIndex>("/api/models/intelligence"),
  modelUsage: () => request<{ counts: Record<string, number> }>("/api/models/usage"),
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
  listDocumentos: (conversacionId: string) =>
    request<Documento[]>(`/api/documentos?conversacion_id=${encodeURIComponent(conversacionId)}`),
  crearDocumento: (body: { mensaje_id: string; formato: FormatoDocumento; titulo?: string }) =>
    request<Documento>("/api/documentos", { method: "POST", body: JSON.stringify(body) }),
  eliminarDocumento: (id: string) =>
    request<{ ok: boolean }>(`/api/documentos/${id}`, { method: "DELETE" }),
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
  // El plan espera al usuario: aprobarlo lo pone en la cola; las notas llegan al obrero.
  approveTaskPlan: (id: string, body: { notas?: string; plan_hash: string }) =>
    request<Task>(`/api/tasks/${id}/aprobar-plan`, { method: "POST", body: JSON.stringify(body) }),
  rejectTaskPlan: (id: string, body: { motivo?: string }) =>
    request<Task>(`/api/tasks/${id}/rechazar-plan`, { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  // Solo sugiere: el texto se revisa en el campo de instrucciones y se guarda desde ahí.
  suggestProjectInstructions: (id: string) =>
    request<{ texto: string; fuentes: string[] }>(`/api/projects/${id}/instrucciones/sugeridas`),
  clearProjectMemory: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}/memoria`, { method: "DELETE" }),
  // Corrige la memoria a mano. Texto vacío la borra. El servidor la redacta y la limita a 4 000 caracteres.
  saveProjectMemory: (id: string, texto: string) =>
    request<{ texto: string | null; actualizada_en: string | null }>(`/api/projects/${id}/memoria`, {
      method: "PUT",
      body: JSON.stringify({ texto }),
    }),
  approveProjectMemoryProposal: (id: string) =>
    request<ProjectDetail["memoria"]>(`/api/projects/${id}/memoria/aprobar`, {
      method: "POST",
      body: "{}",
    }),
  discardProjectMemoryProposal: (id: string) =>
    request<ProjectDetail["memoria"]>(`/api/projects/${id}/memoria/descartar`, {
      method: "POST",
      body: "{}",
    }),
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
  usage: () => request<{ generado: string; proveedores: UsoProveedor[]; googleLive?: GoogleLiveMetrics }>("/api/uso"),
  serverStatus: () => request<ServidorEstado>("/api/servidor"),
  serverService: () => request<ServicioEstado>("/api/servidor/servicio"),
  serverLogs: (lineas = 100) => request<RegistrosServidor>(`/api/servidor/logs?lineas=${lineas}`),
  // Instalación de OpenCode: el servidor exige `confirmar: true` y ejecuta solo su comando fijo.
  herramientaInstalacion: (id: string) => request<InstalacionHerramienta>(`/api/herramientas/${id}/instalacion`),
  instalarHerramienta: (id: string) =>
    request<InstalacionHerramienta>(`/api/herramientas/${id}/instalacion`, {
      method: "POST",
      body: JSON.stringify({ confirmar: true }),
    }),
  codexLogin: () => request<LoginCodex>("/api/providers/codex/login"),
  codexModels: () => request<{ generado: string; models: ModeloCodex[] }>("/api/providers/codex/models"),
  iniciarCodexLogin: () => request<LoginCodex>("/api/providers/codex/login", { method: "POST", body: "{}" }),
  cancelarCodexLogin: () => request<LoginCodex>("/api/providers/codex/login", { method: "DELETE" }),
  confirmarCodexLogin: () => request<LoginCodex>("/api/providers/codex/confirmar", { method: "POST" }),
  // Cuenta global de GitHub (en Ajustes) para operar sin claves SSH por proyecto.
  githubCuenta: () => request<GithubCuenta>("/api/github/cuenta"),
  listMcpConnections: () => request<{ conexiones: ConexionMcp[] }>("/api/conexiones"),
  createMcpConnection: (body: ConexionMcpInput) =>
    request<ConexionMcp>("/api/conexiones", { method: "POST", body: JSON.stringify(body) }),
  updateMcpConnection: (id: string, body: ConexionMcpInput) =>
    request<ConexionMcp>(`/api/conexiones/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMcpConnection: (id: string) =>
    request<{ ok: boolean }>(`/api/conexiones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  githubAppInstalaciones: () => request<GithubAppEstado>("/api/github/app/instalaciones"),
  vincularGithubApp: (id: number) =>
    request<{ ok: boolean; instalacion: GithubAppInstalacion; cuenta: GithubCuenta }>("/api/github/app/instalacion", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  desvincularGithubApp: () =>
    request<{ ok: boolean }>("/api/github/app/instalacion", { method: "DELETE" }),
  conectarGithubCuenta: (token: string) =>
    request<GithubCuenta>("/api/github/cuenta", { method: "POST", body: JSON.stringify({ token }) }),
  desconectarGithubCuenta: () =>
    request<{ ok: boolean }>("/api/github/cuenta", { method: "DELETE" }),
  // Skills: sin projectId, las globales de Ajustes; con projectId, las de la carpeta del proyecto.
  listSkills: (projectId?: string) => request<{ skills: SkillResumen[] }>(skillsRuta(projectId)),
  getSkill: (nombre: string, projectId?: string) =>
    request<SkillDetalle>(`${skillsRuta(projectId)}/${encodeURIComponent(nombre)}`),
  saveSkill: (nombre: string, contenido: string, projectId?: string) =>
    request<{ creada: boolean }>(`${skillsRuta(projectId)}/${encodeURIComponent(nombre)}`, {
      method: "PUT",
      body: JSON.stringify({ contenido }),
    }),
  installSkill: (comando: string, projectId?: string) =>
    request<{ name: string; content: string; source: string }>(
      projectId ? `/api/projects/${projectId}/skills/instalar` : "/api/skills/instalar",
      { method: "POST", body: JSON.stringify({ comando }) },
    ),
  deleteSkill: (nombre: string, projectId?: string) =>
    request<{ ok: boolean }>(`${skillsRuta(projectId)}/${encodeURIComponent(nombre)}`, { method: "DELETE" }),
  resumeTask: (id: string) => request<Task>(`/api/tasks/${id}/reanudar`, { method: "POST", body: "{}" }),
  // Tras una cuota agotada: vuelve a la cola con otro modelo y retoma la sesión.
  continueTask: (id: string, body: { model?: string; effort?: string | null } = {}) =>
    request<Task>(`/api/tasks/${id}/seguir`, { method: "POST", body: JSON.stringify(body) }),
  continueChat: (id: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${id}/seguir`, { method: "POST", body: "{}" }),
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
  // Con url, la carpeta queda vacía para clonar ese repo de GitHub (ver verificarRepositorioGithub).
  createProject: (
    body:
      | { name: string; url?: string; sobrescribir?: boolean; vincular?: boolean }
      | { path: string; name?: string; sobrescribir?: boolean; vincular?: boolean },
  ) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  verificarRepositorioGithub: (url: string) =>
    request<VerificacionGithub>("/api/github/verificar", { method: "POST", body: JSON.stringify({ url }) }),
  // Empieza el clonado en el chat del proyecto. Responde al instante; el avance se ve en ese chat.
  cloneProject: (id: string) => request<ClonadoIniciado>(`/api/projects/${id}/clonar`, { method: "POST" }),
  deleteProject: (id: string, opts?: { borrarCarpeta?: boolean }) =>
    request<{ ok: boolean }>(`/api/projects/${id}${opts?.borrarCarpeta ? "?borrar_carpeta=true" : ""}`, {
      method: "DELETE",
    }),
  listProviders: () => request<ProviderStatus[]>("/api/providers"),
  // La clave se escribe una vez y nunca vuelve por la API. Guardar otra vez la reemplaza.
  setProviderKey: (id: string, valor: string) =>
    request<{ id: string; configurada: boolean; actualizada_en: string }>(
      `/api/claves-proveedor/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify({ valor }) },
    ),
  deleteProviderKey: (id: string) =>
    request<{ ok: boolean }>(`/api/claves-proveedor/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getJev: () => request<JevStatus>("/api/jev"),
  setJevKey: (valor: string) => request<{ configurada: boolean; actualizada_en: string }>("/api/jev", {
    method: "PUT", body: JSON.stringify({ valor }),
  }),
  deleteJevKey: () => request<{ ok: boolean }>("/api/jev", { method: "DELETE" }),
  testJev: () => request<{ ok: boolean }>("/api/jev/probar", { method: "POST", body: "{}" }),
  rankChatRecommendations: (conversacionId: string, candidatas: string[]) =>
    request<{ recomendaciones: string[]; ordenadas_con_jev: boolean }>("/api/jev/recomendaciones", {
      method: "POST", body: JSON.stringify({ conversacionId, candidatas }),
    }),
  getPreferences: () => request<Preferences>("/api/preferences"),
  savePreferences: (patch: Partial<Preferences>) =>
    request<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }),
  getAnalytics: (days: number, filtros: { proyecto?: string | null; modelo?: string | null } = {}) => {
    const q = new URLSearchParams({ days: String(days) });
    if (filtros.proyecto) q.set("proyecto", filtros.proyecto);
    if (filtros.modelo) q.set("modelo", filtros.modelo);
    return request<Analytics>(`/api/analytics?${q.toString()}`);
  },
  listSessions: () => request<AuthSession[]>("/api/sesiones"),
  revokeSession: (id: string) => request<{ ok: boolean }>(`/api/sesiones/${id}`, { method: "DELETE" }),
  closeOtherSessions: () => request<{ ok: boolean; revocadas: number }>("/api/sesiones/cerrar-otras", { method: "POST", body: "{}" }),
};

export type AuthSession = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  actual?: boolean;
};

export type JevStatus = { disponible: boolean; configurada: boolean; actualizada_en: string | null };

export type GithubCuenta = {
  conectado: boolean;
  login?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string[];
  actualizado_en?: string;
  metodo?: "app" | "token";
  sesion_anterior?: boolean;
};

export type GithubAppInstalacion = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  repository_selection: "all" | "selected";
  permissions: Record<string, "read" | "write">;
  configuration_url: string | null;
};

export type GithubAppEstado = {
  configurado: boolean;
  faltantes: string[];
  seleccionada: number | null;
  instalaciones: GithubAppInstalacion[];
};

export type FuenteAutenticacionGithub = {
  tipo: "github_app" | "credencial_anterior" | "clave_ssh" | "ninguna";
  origen: "app" | "sesion_anterior" | "token_proyecto" | "token_pr_proyecto" | "ssh" | "ninguna";
  etiqueta: string;
  cuenta: string | null;
  instalacion_id: number | null;
};

export type Preferences = {
  defaultModel: string | null;
  defaultEffort: string | null;
  monthlyBudgetUsd: number | null;
  budgetAlertPercent: number;
  // Modelo de respaldo si el principal responde 429 o un error del servidor del proveedor.
  fallbackModel: string | null;
  compartirContextoChats?: boolean;
};

export type CalidadUso = { tokensMedidos: number; tokensEstimados: number; costesEstimados: number; sinTokens: number; sinCoste: number; historicos: number };
export type Analytics = {
  calidad?: CalidadUso;
  byTask?: (CalidadUso & { taskId: string; calls: number; tokens: number; cost: number })[];
  days: number;
  filtros: { proyecto: string | null; modelo: string | null };
  proyectos: { id: string; name: string }[];
  modelos: string[];
  totals: { calls: number; inputTokens: number; outputTokens: number; cost: number };
  byType: { tipo: "chat" | "tarea" | "otro"; calls: number; tokens: number; cost: number; sinTokens?: number; sinCoste?: number }[];
  usoJev?: { tipo: "recomendaciones_chat" | "memoria_proyecto" | "clasificacion_tarea" | "prueba_conexion"; calls: number; inputTokens: number; outputTokens: number; tokens: number }[];
  byDay: { day: string; cost: number; tokens: number; calls: number; tokensEstimados?: number; modelos?: { model: string; provider: string; calls: number; tokens: number; estimados: number }[] }[];
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

export type ProjectSkill = { name: string; content: string; source: string | null };
export type GitConfig = {
  remote: string | null;
  repository: string | null;
  author_name: string;
  base_branch: string;
  inicializado: boolean;
  ocupado: boolean;
  token: boolean;
  tokenProyecto?: boolean;
  tokenGlobal?: boolean;
  prToken: boolean;
  ssh: boolean;
  github: GithubCuenta;
};
export type RepositoryAction = {
  message_id: string | null;
  id: string;
  action: string;
  payload: string;
  state: string;
  result: string | null;
  task_id: string | null;
};

export type VerificacionConflictos = {
  verificado: boolean;
  estado: string;
  mensaje: string;
  pr_url?: string;
  pr_number?: number;
};
