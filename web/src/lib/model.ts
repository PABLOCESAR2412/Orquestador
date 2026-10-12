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
  modelo_respaldo: "Modelo de respaldo",
  clon_creado: "Copia de trabajo creada",
  commit_aprobado: "Commit aprobado",
  push_aprobado: "Rama subida al remoto",
  push_fallido: "Falló la subida al remoto",
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

// Detalle de un error del servidor o del agente, listo para mostrar como texto.
// Quita credenciales de URLs, valores de secretos, rutas del servidor y cadenas con forma de token.
// Si el servidor cambia de formato, esta limpieza sigue siendo la última barrera antes de la pantalla.
export function sanearDetalle(texto: string, maximo = 160): string {
  return texto
    .replace(/^Error:\s*/, "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1")
    .replace(/\b([\w-]*(?:token|secret|password|passwd|clave|api[_-]?key|credential)[\w-]*)(\s*[=:]\s*)\S+/gi, "$1$2[oculto]")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/g, "[oculto]")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[oculto]")
    .replace(/[A-Za-z]:\\[^\s'"]+/g, "[ruta]")
    .replace(/(^|[\s'"`(=])\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, "$1[ruta]")
    .slice(0, maximo);
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "insufficient_funds":
        return "Saldo insuficiente en el proveedor. Usa un modelo gratuito o recarga saldo.";
      case "runner_failed":
        return err.detail
          ? `El modelo no respondió: ${sanearDetalle(err.detail)}`
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
        return "La ruta no es válida.";
      case "project_path_not_found":
        return "Esa ruta no existe en el servidor.";
      case "project_path_outside_root":
        return "La ruta queda fuera de la carpeta permitida.";
      case "project_path_not_directory":
        return "Esa ruta es un archivo, no una carpeta.";
      case "project_exists":
        return "Ese proyecto ya está registrado.";
      case "sin_guias":
        return "El repo no tiene AGENTS.md, CLAUDE.md ni README.md para sugerir instrucciones.";
      case "project_folder_exists":
        return "Ya existe una carpeta con ese nombre en la carpeta de proyectos.";
      case "project_not_found":
        return "Ese proyecto ya no existe.";
      case "invalid_project_name":
        return "El nombre del proyecto debe tener entre 1 y 60 caracteres.";
      case "invalid_instrucciones":
        return "Las instrucciones pueden tener hasta 8 000 caracteres.";
      case "archivo_binario":
        return "Ese archivo no es de texto, así que no se puede mostrar.";
      case "secretos_no_configurados":
        return "Falta la clave de cifrado de secretos en el servidor. Los secretos no se pueden guardar.";
      case "invalid_secret_name":
        return "El nombre usa solo mayúsculas, números y guion bajo, y no empieza con TELO_.";
      case "invalid_secret_value":
        return "El valor debe tener entre 1 y 8 192 caracteres.";
      case "secret_not_found":
        return "Ese secreto ya no existe.";
      case "invalid_schedule":
        return "Revisa la frecuencia: entre 1 y 168 horas, o una hora en formato HH:MM.";
      case "task_without_repo":
        return "Esta tarea no tiene copia de Git, así que no hay cambios que revisar.";
      case "task_running":
        return "La tarea sigue corriendo. Revisa los cambios cuando termine.";
      case "sin_cambios":
        return "No hay cambios que guardar.";
      case "cambios_cambiaron":
        return "Los cambios cambiaron desde que los revisaste. Revísalos de nuevo antes de aprobar.";
      case "commit_requerido":
        return "Primero aprueba el commit de estos cambios.";
      case "archivo_sensible":
        return "Hay archivos que parecen secretos (claves o variables .env). Quítalos de la tarea antes de guardar el commit.";
      case "sin_remoto":
        return "El proyecto no tiene un remoto al que subir los cambios.";
      case "invalid_accion":
        return "La acción debe ser commit o push.";
      case "invalid_mensaje":
        return "El mensaje del commit debe tener entre 1 y 200 caracteres.";
      case "push_fallido":
        return "No se pudo subir la rama al remoto. Revisa el detalle en la tarea.";
      case "git_failed":
        return err.detail
          ? `Git no pudo completar la operación: ${sanearDetalle(err.detail)}`
          : "Git no pudo completar la operación.";
      case "git_timeout":
        return "Git tardó demasiado y se canceló.";
      case "invalid_model":
        return "Ese modelo no es válido.";
      case "invalid_effort":
        return "Ese nivel de esfuerzo no es válido.";
      case "secreto_detectado":
        return err.detail
          ? `Se encontró un secreto en estos archivos, así que no se guardó el commit: ${err.detail}. Quítalo y vuelve a revisar.`
          : "Se encontró un secreto en los cambios, así que no se guardó el commit. Quítalo y vuelve a revisar.";
      case "proyecto_ocupado":
        return "Otro chat de este proyecto está trabajando. Espera a que termine.";
      case "programada_en_curso":
        return "La última ejecución de esta programada todavía no termina. Espera a que acabe.";
      case "demasiadas_conexiones":
        return "Hay demasiadas pantallas abiertas en el servidor. Cierra algunas y vuelve a intentar.";
      case "tarea_error":
        return "La tarea no pudo completarse. Revisa el detalle en la tarea.";
      case "clave_no_configurada":
        return "El servidor no tiene configurada la clave de acceso. Revisa su archivo de entorno.";
      case "body_too_large":
        return "El contenido es demasiado grande para enviarlo.";
      case "not_found":
        return "Esa pantalla o recurso ya no existe.";
      case "invalid_hash":
        return "La revisión de los cambios no es válida. Vuelve a abrir la revisión.";
      case "remoto_no_permitido":
        return "Solo se puede subir a GitHub por HTTPS. Revisa el remoto del proyecto.";
      case "invalid_body":
        return "La información enviada no es válida. Intenta de nuevo.";
      case "project_path_not_file":
        return "Esa ruta es una carpeta, no un archivo.";
      case "programada_not_found":
        return "Esa tarea programada ya no existe.";
      case "too_many_programadas":
        return "Ya tienes 50 tareas programadas. Elimina alguna para crear otra.";
      case "tarea_no_creada":
        return "No se pudo crear la tarea. Intenta de nuevo.";
      case "clave_incorrecta":
        return "La clave no es correcta.";
      case "demasiados_intentos":
        return "Demasiados intentos. Espera 15 minutos antes de volver a intentar.";
      case "login_required":
        return "Tu sesión terminó. Vuelve a entrar.";
      case "google_no_configurado":
        return "Google no está configurado en el servidor. Revisa las variables que faltan en esta pantalla.";
      case "google_estado_invalido":
        return "El inicio de sesión con Google caducó o ya se usó. Vuelve a conectar la cuenta.";
      case "google_cancelado":
        return "Cancelaste el inicio de sesión con Google.";
      case "google_sin_refresh":
        return "Google no dio permiso para mantener la conexión. Quita el acceso de Telo en tu cuenta de Google y vuelve a conectar.";
      case "google_fallido":
        return "Google no completó el inicio de sesión. Intenta de nuevo.";
    }
  }
  return "Algo salió mal. Intenta de nuevo.";
}
