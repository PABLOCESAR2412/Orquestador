import { ApiError, type CostTier, type ModelInfo, type TaskStatus } from "../api";

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
