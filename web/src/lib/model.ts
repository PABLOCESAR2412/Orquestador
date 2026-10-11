import { ApiError, type CostTier, type ModelInfo, type TaskEventKind, type TaskStatus } from "../api";

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export const effortLabel = (value: string) => EFFORT_LABELS[value] ?? value;

export const TIER_LABEL: Record<CostTier, string> = {
  gratis: "Gratis",
  economico: "Económico",
  medio: "Medio",
  alto: "Alto",
  premium: "Premium",
};

// Barras encendidas del medidor de costo (de 0 a 5).
const TIER_BARS: Record<CostTier, number> = {
  gratis: 0,
  economico: 1,
  medio: 2,
  alto: 4,
  premium: 5,
};

export const tierBars = (tier: CostTier) => TIER_BARS[tier];

export function formatPrice(m: ModelInfo): string {
  if (m.free) return "Sin costo";
  return `$${m.inputUsd} / $${m.outputUsd} por M`;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "En cola",
  running: "Corriendo",
  done: "Lista",
  interrupted: "Interrumpida",
  failed: "Falló",
  cancelled: "Cancelada",
};

// Historial de una tarea (tabla task_events del servidor).
export const EVENT_LABEL: Record<TaskEventKind, string> = {
  creada: "Creada",
  iniciada: "Iniciada",
  sesion_asignada: "Sesión del agente asignada",
  cancelacion_pedida: "Cancelación pedida",
  interrumpida: "Interrumpida",
  reanudada: "Reanudada",
  reintento_creado: "Reintento creado",
  terminada: "Terminada",
};

// Montos en dólares: centavos normales; cifras menores a un centavo con cuatro decimales.
export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `US$ ${n.toFixed(4)}` : `US$ ${n.toFixed(2)}`;
}

// SQLite guarda la fecha en UTC sin zona: "2026-10-09 04:50:16".
export function formatWhen(sqlDate: string): string {
  const date = new Date(sqlDate.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const shorten = (text: string) => text.replace(/^Error:\s*/, "").slice(0, 160);

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "insufficient_funds":
        return "Saldo insuficiente en el proveedor. Usa un modelo gratuito o recarga saldo.";
      case "runner_failed":
        return err.detail
          ? `El modelo no respondió: ${shorten(err.detail)}`
          : "El modelo no respondió. Intenta de nuevo.";
      case "invalid_content":
      case "invalid_prompt":
        return "El texto está vacío o supera los 10 000 caracteres.";
      case "task_not_cancellable":
        return "Esta tarea ya terminó.";
      case "task_not_resumable":
        return "Solo se pueden reanudar tareas interrumpidas o fallidas.";
      case "task_without_session":
        return "Esta tarea no llegó a iniciar una sesión. Puedes reintentarla.";
      case "task_not_retryable":
        return "Esta tarea no se puede reintentar en este estado.";
      case "task_not_found":
        return "Esta tarea ya no existe.";
      case "conversation_busy":
        return "Este chat todavía está respondiendo. Espera a que termine.";
      case "aislamiento_no_disponible":
        return "El servidor no tiene bubblewrap, así que el agente no puede correr aislado. Pide instalarlo en el VM.";
      case "carpeta_no_permitida":
        return "Esa carpeta no está permitida para un agente.";
      case "invalid_title":
        return "El título debe tener entre 1 y 80 caracteres.";
      case "invalid_provider":
        return "El proveedor solo puede tener letras minúsculas, números y guiones.";
      case "invalid_label":
        return "Escribe un nombre para la cuenta de 60 caracteres o menos.";
      case "quota_not_found":
        return "Esa cuenta ya no existe.";
      case "invalid_amount":
        return "El saldo debe ser un número igual o mayor que cero.";
      case "invalid_budget":
        return "El presupuesto debe ser un número igual o mayor que cero.";
      case "invalid_alert_percent":
        return "El aviso debe estar entre 50 % y 100 %.";
      case "unknown_field":
        return "Hay un campo que la app no reconoce. Recarga la página.";
      case "conversation_not_found":
        return "Este chat ya no existe.";
      case "model_not_found":
        return "Ese modelo ya no está disponible.";
      case "effort_not_supported":
        return "Ese modelo no admite ese nivel de esfuerzo.";
      case "effort_requires_model":
        return "Elige un modelo antes de ajustar el esfuerzo.";
      case "models_unavailable":
        return "No se pudo cargar la lista de modelos.";
      case "projects_root_not_configured":
        return "Los proyectos aún no están configurados en el servidor.";
      case "invalid_project_path":
        return "Escribe la carpeta del proyecto.";
      case "project_path_not_found":
        return "Esa carpeta no existe dentro de la carpeta de proyectos del servidor.";
      case "project_path_outside_root":
        return "La carpeta debe estar dentro de la carpeta de proyectos del servidor.";
      case "project_path_not_directory":
        return "Esa ruta es un archivo, no una carpeta.";
      case "project_exists":
        return "Ese proyecto ya está registrado.";
      case "project_not_found":
        return "Ese proyecto ya no existe.";
      case "invalid_project_name":
        return "El nombre del proyecto no puede tener más de 60 caracteres.";
      case "clave_incorrecta":
        return "La clave no es correcta.";
      case "demasiados_intentos":
        return "Demasiados intentos. Espera 15 minutos antes de volver a intentar.";
      case "login_required":
        return "Tu sesión terminó. Vuelve a entrar.";
    }
  }
  return "Algo salió mal. Intenta de nuevo.";
}
