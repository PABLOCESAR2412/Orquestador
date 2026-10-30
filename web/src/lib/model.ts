import {
  ApiError,
  type CostTier,
  type ModelInfo,
  type TaskEventKind,
  type TaskStatus,
} from "../api";

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export const effortLabel = (value: string) => EFFORT_LABELS[value] ?? value;

// El prefijo del modelo identifica el catálogo o la API que lo sirve.
const PROVEEDOR_LABEL: Record<string, string> = {
  opencode: "OpenCode",
  anthropic: "Anthropic",
  openai: "OpenAI API",
  google: "Google API",
  deepseek: "DeepSeek",
  github: "GitHub Copilot",
  openrouter: "OpenRouter",
  groq: "Groq API",
  nvidia: "NVIDIA API",
};

export const nombreProveedor = (id: string) =>
  PROVEEDOR_LABEL[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Otro");

export function proveedorDeModelo(modelo: string | null): string {
  if (!modelo) return "google";
  const m = modelo.toLowerCase();
  if (m.startsWith("google/") || m.includes("/google/") || m.includes("gemini") || m.includes("argon")) return "google";
  if (m.startsWith("codex/") || m === "codex" || m.includes("/codex/")) return "codex";
  if (m.startsWith("openai/") || m.includes("/openai/")) return "openai";
  if (m.startsWith("anthropic/") || m.includes("claude")) return "anthropic";
  if (m.startsWith("groq/") || m.includes("/groq/")) return "groq";
  if (m.startsWith("nvidia/") || m.includes("/nvidia/")) return "nvidia";
  if (m.startsWith("deepseek/") || m.includes("deepseek")) return "deepseek";
  if (m.includes("/")) return m.split("/")[0];
  return "google";
}

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
  analyzing: "Analizando",
  waiting_approval: "Espera tu aprobación",
  running: "Corriendo",
  done: "Lista",
  interrupted: "Interrumpida",
  sin_cuota: "Sin cuota",
  failed: "Falló",
  cancelled: "Cancelada",
};

// Historial de una tarea (tabla task_events del servidor).
export const EVENT_LABEL: Record<TaskEventKind, string> = {
  comprobacion_fallida: "Comprobación previa fallida",
  comprobacion_aviso: "Aviso de preparación",
  creada: "Creada",
  iniciada: "Iniciada",
  sesion_asignada: "Sesión del agente asignada",
  cancelacion_pedida: "Cancelación pedida",
  interrumpida: "Interrumpida",
  reanudada: "Reanudada",
  reintento_creado: "Reintento creado",
  terminada: "Terminada",
  modelo_respaldo: "Modelo de respaldo",
  sin_cuota: "Se acabó la cuota del modelo",
  seguida: "Seguida con otro modelo",
  clon_creado: "Copia de trabajo creada",
  commit_aprobado: "Commit aprobado",
  push_aprobado: "Rama subida al remoto",
  push_fallido: "Falló la subida al remoto",
  push_reintegrado: "Reintegrado con la punta del remoto",
  plan_creado: "Plan del analizador",
  plan_pendiente: "Plan listo, espera tu aprobación",
  plan_aprobado: "Plan aprobado",
  plan_rechazado: "Plan rechazado",
  plan_revision: "El plan necesita revisión",
  replanificada: "Replanificada por desviación",
  obrero_iniciado: "Obrero ejecutando el plan",
  correccion_iniciada: "Corrección del obrero (iniciativa)",
  clasificacion_jev: "Clasificación sugerida por Jev",
  memoria_evaluada: "Propuesta de memoria evaluada por Jev",
  memoria_propuesta: "Propuesta de memoria guardada para revisión",
  conflictos_pr_preparados: "PR preparado: conflictos por resolver",
};

// Montos en dólares: centavos normales; cifras menores a un centavo con cuatro decimales.
export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `US$ ${n.toFixed(4)}` : `US$ ${n.toFixed(2)}`;
}

// SQLite guarda la fecha en UTC sin zona: "2026-10-09 04:50:16", o ISO con Z.
export function formatWhen(sqlDate: string): string {
  if (!sqlDate) return "";
  const iso = sqlDate.includes("T")
    ? sqlDate.endsWith("Z")
      ? sqlDate
      : sqlDate + "Z"
    : sqlDate.replace(" ", "T") + "Z";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return sqlDate;
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
    .replace(
      /\b([\w-]*(?:token|secret|password|passwd|clave|api[_-]?key|credential)[\w-]*)(\s*[=:]\s*)\S+/gi,
      "$1$2[oculto]",
    )
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/g, "[oculto]")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[oculto]")
    .replace(/[A-Za-z]:\\[^\s'"]+/g, "[ruta]")
    .replace(/(^|[\s'"`(=])\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, "$1[ruta]")
    .slice(0, maximo);
}

// Errores que el servidor guarda en tasks.error como código puro (ErrorTarea): los frases
// en español en vez de mostrarlos crudos. Cualquier otro mensaje (del runtime o del agente)
// pasa por sanearDetalle, que también deja su redacción segura.
const CODIGO_TAREA_TEXTO: Record<string, string> = {
  task_not_found: "La tarea ya no existe.",
  task_running: "La tarea ya está en ejecución.",
  task_without_repo: "El proyecto de esta tarea no tiene repositorio Git.",
  proyecto_sin_git: "El proyecto no es un repositorio Git.",
  rama_fuente_invalida: "La rama fuente del PR preparado ya no es válida.",
  rama_base_invalida: "La rama base del PR ya no es válida.",
  rama_fuente_no_preparable: "No se pudieron resolver los conflictos de la rama fuente.",
  invalid_mensaje: "El mensaje de commit no es válido.",
  sin_cambios: "El agente no dejó cambios que guardar.",
  cambios_cambiaron: "Los cambios aprobados ya no son los mismos; revisa de nuevo el diff.",
  archivo_sensible: "Un archivo modificado está marcado como sensible y no se puede guardar.",
  secreto_detectado: "El agente intentó guardar un secreto conocido; el commit fue rechazado.",
  sin_remoto: "No hay un remoto de GitHub configurado en el proyecto.",
  remoto_no_permitido: "El remoto del proyecto no apunta a GitHub.",
  credenciales_git_faltantes: "Faltan credenciales de GitHub para subir la rama.",
  commit_requerido: "Para subir la rama hace falta un commit aprobado antes.",
  push_fallido: "Falló la subida de la rama al remoto.",
  merge_conflicts: "Al preparar el PR quedaron conflictos sin resolver.",
};

export function textoErrorTarea(error: string): string {
  const codigo = error.trim().split("\n")[0];
  if (CODIGO_TAREA_TEXTO[codigo]) return CODIGO_TAREA_TEXTO[codigo];
  return sanearDetalle(error, 600);
}

// Motivos que el servidor devuelve dentro de una respuesta correcta (instalación y login), no como error HTTP.
export function motivoTexto(motivo: string | null): string | null {
  if (!motivo) return null;
  switch (motivo) {
    case "npm_fallo":
      return "npm no pudo instalar OpenCode. Revisa la salida de abajo.";
    case "no_visible_tras_instalar":
      return "La instalación terminó, pero el CLI no aparece en el servidor. Revisa la salida de abajo.";
    case "tiempo_agotado":
      return "La operación tardó demasiado y se detuvo.";
    case "login_no_completado":
      return "El inicio de sesión no se completó. Vuelve a intentarlo.";
    case "cancelado":
      return "Inicio de sesión cancelado.";
    default:
      return "No se pudo completar la operación.";
  }
}

function textoErrorConAyuda(
  causa: string,
  detalle: string | undefined,
  siguientePaso: string,
): string {
  const detalleVisible = detalle ? sanearDetalle(detalle, 420).trim() : "";
  return `${causa}${detalleVisible ? ` Detalle: ${detalleVisible}.` : ""} Por dónde empezar: ${siguientePaso}`;
}

function siguientePasoProveedor(detalle?: string): string | null {
  const texto = detalle?.toLowerCase() ?? "";
  if (/429|rate.?limit|quota|cuota|insufficient.?funds|credit balance/.test(texto)) {
    return "comprueba la cuota del proveedor, cambia a otro modelo o espera a que se renueve el límite.";
  }
  if (/401|unauthorized|invalid api.?key|authentication|api key/.test(texto)) {
    return "revisa en Ajustes que la sesión o clave del proveedor siga activa.";
  }
  if (/403|forbidden|permission|access denied/.test(texto)) {
    return "comprueba que la cuenta conectada tenga permiso para usar ese modelo.";
  }
  if (/timeout|timed out|etimedout|econnreset/.test(texto)) {
    return "vuelve a intentarlo y, si se repite, prueba otro modelo o proveedor.";
  }
  if (/failed to fetch|fetch failed|network|enotfound|econnrefused|connection/.test(texto)) {
    return "comprueba que el servidor tenga conexión con el proveedor y vuelve a intentarlo.";
  }
  if (/server error|internal error|service unavailable|bad gateway|unexpected server/.test(texto)) {
    return "el proveedor tuvo un error temporal en sus servidores; espera unos momentos o cambia a otro modelo.";
  }
  return null;
}

function explicacionHttp(status: number): { causa: string; siguientePaso: string } {
  switch (status) {
    case 401:
      return { causa: "La sesión ya no es válida.", siguientePaso: "vuelve a iniciar sesión y repite la acción." };
    case 403:
      return { causa: "La cuenta conectada no tiene permiso para esta acción.", siguientePaso: "comprueba la cuenta, el repositorio y los permisos necesarios." };
    case 404:
      return { causa: "Lo que pediste ya no está disponible en el servidor: pudo moverse, borrarse o haber terminado.", siguientePaso: "vuelve a abrir el elemento desde la lista de chats o tareas; si era un archivo del chat, pide al agente que lo genere otra vez." };
    case 409:
      return { causa: "El estado cambió y la acción ya no coincide con lo que está pendiente.", siguientePaso: "recarga la pantalla y revisa si la tarea o autorización ya se resolvió." };
    case 413:
      return { causa: "El contenido enviado supera el tamaño permitido.", siguientePaso: "reduce el texto o los archivos adjuntos e inténtalo otra vez." };
    case 422:
      return { causa: "El servidor recibió la solicitud, pero no pudo procesarla con esos datos.", siguientePaso: "revisa el detalle y confirma que la información siga vigente." };
    case 429:
      return { causa: "Se hicieron demasiadas solicitudes en poco tiempo.", siguientePaso: "espera un momento y vuelve a intentarlo." };
    case 502:
    case 503:
    case 504:
      return { causa: "Telo no pudo completar la solicitud porque falló un servicio del servidor o del proveedor.", siguientePaso: "comprueba el estado del proveedor o del servidor y vuelve a intentarlo." };
    default:
      if (status >= 500) {
        return { causa: "El servidor encontró un error al procesar la solicitud.", siguientePaso: "vuelve a intentarlo; si persiste, comparte este detalle para revisar los registros del servidor." };
      }
      return { causa: "El servidor no aceptó la solicitud.", siguientePaso: "recarga la pantalla y comprueba los datos antes de repetir la acción." };
  }
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "conexion_nombre_invalido":
        return "Escribe un nombre de hasta 64 caracteres para la conexión.";
      case "conexion_url_invalida":
        return "Usa una URL HTTPS sin credenciales ni parámetros en la dirección.";
      case "conexion_token_invalido":
        return "La credencial no es válida o supera el límite permitido.";
      case "conexion_nombre_duplicado":
        return "Ya existe una conexión con ese nombre. Elige otro.";
      case "conexion_estado_invalido":
        return "No se pudo cambiar el estado de la conexión. Vuelve a intentarlo.";
      case "conexion_not_found":
        return "La conexión ya no existe. Actualiza la lista e inténtalo de nuevo.";
      case "secretos_no_disponibles":
        return "El servidor no puede cifrar credenciales. Revisa TELO_CLAVE_CIFRADO en su configuración.";
      case "credenciales_git_faltantes":
        return "Inicia sesión con GitHub en Ajustes o configura una clave SSH antes de subir cambios.";
      case "invalid_git_config":
        return "Revisa el repositorio de GitHub, el nombre y la rama destino.";
      case "repositorio_inmutable":
        return "Este proyecto ya tiene un repositorio configurado y no se puede cambiar desde aquí.";
      case "proyecto_ocupado":
        return "El proyecto está ocupado por una tarea. Intenta de nuevo cuando termine.";
      case "subagent_read_only":
        return "Este subchat solo permite revisar la actividad. Vuelve al chat principal para dar instrucciones.";
      case "github_access":
        return textoErrorConAyuda(
          "GitHub no concedió acceso al repositorio.",
          err.detail,
          "confirma que la GitHub App esté instalada en ese repo y tenga el permiso requerido, y vuelve a autorizar la acción.",
        );
      case "git_action":
        return textoErrorConAyuda(
          "La acción de GitHub no se pudo completar.",
          err.detail,
          "revisa el repo, la rama y el estado de la autorización; si los cambios cambiaron, vuelve a revisarlos y prepara otra autorización.",
        );
      case "github_error":
        return textoErrorConAyuda("GitHub rechazó la solicitud.", err.detail, "revisa el acceso de la cuenta y vuelve a comprobarlo en Ajustes.");
      case "conexion_fallida":
        return textoErrorConAyuda("Telo no pudo conectar con GitHub.", err.detail, "comprueba la conexión del servidor y vuelve a intentarlo.");
      case "token_invalido":
        return textoErrorConAyuda("GitHub rechazó la credencial guardada.", err.detail, "vuelve a conectar la cuenta con una credencial vigente en Ajustes.");
      case "token_requerido":
        return "Falta la credencial para conectar GitHub. Pega una credencial válida en Ajustes y vuelve a guardar.";
      case "action_already_decided":
        return "Esta autorización ya no está pendiente. Revisa el estado actualizado en el chat.";
      case "action_not_found":
        return "Esta autorización ya no está disponible.";
      case "plan_con_preguntas":
        return "Responde las preguntas y solicita revisar el plan antes de aprobarlo.";
      case "plan_needs_revision":
        return "El obrero pidió revisar el plan. Indica las aclaraciones y solicita una nueva versión antes de ejecutar.";
      case "invalid_skill_name":
        return "Usa un nombre en minúsculas, números y guiones, de hasta 64 caracteres.";
      case "invalid_skill_content":
        return "Pega las instrucciones de la skill, hasta 16 000 caracteres.";
      case "invalid_skill_url":
        return "Usa una URL HTTPS de un archivo SKILL.md en GitHub.";
      case "invalid_skill_command":
        return "Pega el comando completo de skills.sh con el formato npx skills add <repositorio> --skill <nombre>.";
      case "skill_command_ambiguous":
        return "El repositorio tiene más de una skill con ese nombre. Elige un repositorio que contenga una sola.";
      case "skill_no_encontrada":
        return "No se encontró esa skill en el repositorio indicado.";
      case "invalid_skill_query":
        return "Escribe el nombre de la skill que quieres buscar.";
      case "skill_too_large":
        return "El SKILL.md supera el tamaño permitido. Pega solo las instrucciones que necesitas.";
      case "skill_catalog_failed":
        return "No se pudo consultar GitHub. Revisa la conexión o inténtalo de nuevo.";
      case "skill_download_failed":
        return "No se pudo descargar el SKILL.md. Comprueba que el repositorio sea público y que el comando sea correcto.";
      case "insufficient_funds":
        return "Saldo insuficiente en el proveedor. Usa un modelo gratuito o recarga saldo.";
      case "runner_failed":
        return textoErrorConAyuda(
          "El agente no pudo generar una respuesta.",
          err.detail,
          siguientePasoProveedor(err.detail) ?? "abre «Ver proceso» en el chat o la tarea y revisa el último paso y el proveedor elegido.",
        );
      case "invalid_content":
      case "invalid_prompt":
        return "El texto está vacío o supera los 30 000 caracteres.";
      case "documento_no_generado":
        return "No se pudo crear el documento con ese formato. Prueba con otro o revisa el texto.";
      case "documento_muy_grande":
        return "El documento es demasiado grande para guardarlo.";
      case "documento_no_encontrado":
        return "Este documento ya no existe.";
      case "vista_no_disponible":
        return "No se pudo generar la vista previa de este documento.";
      case "formato_invalido":
        return "Ese formato de documento no está disponible.";
      case "mensaje_no_encontrado":
        return "El mensaje ya no existe en el chat.";
      case "task_not_cancellable":
        return "Esta tarea ya terminó.";
      case "task_not_resumable":
        return "Solo se pueden reanudar tareas interrumpidas o fallidas.";
      case "task_without_session":
        return "Esta tarea no llegó a iniciar una sesión. Puedes reintentarla.";
      case "cuota_agotada":
        return "Se acabó la cuota de este modelo. Cambia de modelo y pulsa Seguir.";
      case "modelo_sin_cambio":
        return "Ese modelo ya no tiene cuota. Elige otro para seguir.";
      case "task_not_continuable":
        return "Solo se pueden seguir tareas detenidas por falta de cuota.";
      case "chat_sin_cuota":
        return "Este chat no está detenido por falta de cuota.";
      case "chat_quota_pending":
        return "Este chat está detenido por falta de cuota. Cambia de modelo y pulsa Seguir antes de enviar otro mensaje.";
      case "task_not_retryable":
        return "Esta tarea no se puede reintentar en este estado.";
      case "task_not_found":
        return "Esta tarea ya no existe.";
      case "task_not_waiting_plan":
        return "Esta tarea no está esperando la aprobación de un plan.";
      case "invalid_notas":
        return "Las notas son demasiado largas. El máximo es de 2000 caracteres.";
      case "conversation_busy":
        return "Este chat todavía está respondiendo. Espera a que termine.";
      case "no_esta_en_cola":
        return "Ese mensaje ya no está en cola: su turno arrancó o se retiró.";
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
      case "conversacion_requerida":
        return "Elige un chat antes de crear un documento.";
      case "mensaje_requerido":
        return "Selecciona una respuesta del agente antes de crear un documento.";
      case "model_not_found":
        return "Ese modelo ya no está disponible.";
      case "effort_not_supported":
        return "Ese modelo no admite ese nivel de esfuerzo.";
      case "effort_requires_model":
        return "Elige un modelo antes de ajustar el esfuerzo.";
      case "models_unavailable":
        return textoErrorConAyuda(
          "Telo no pudo consultar la lista de modelos.",
          err.detail,
          siguientePasoProveedor(err.detail) ?? "comprueba la conexión del proveedor y vuelve a cargar la lista.",
        );
      case "codex_models_unavailable":
        return "Telo no pudo cargar los modelos de Codex. Por dónde empezar: confirma la sesión de Codex en Ajustes y revisa la salida del inicio de sesión si el problema continúa.";
      case "codex_no_conectado":
        return "No hay una sesión de Codex activa en el servidor. Por dónde empezar: inicia sesión con Codex en Ajustes y vuelve a cargar los modelos.";
      case "projects_root_not_configured":
        return "Los proyectos aún no están configurados en el servidor.";
      case "invalid_project_path":
        return "La ruta no es válida.";
      case "project_path_not_found":
        return "No encontramos esa ruta en la versión actual del proyecto. Puede haberse movido, cambiado de nombre o eliminado.";
      case "archivo_chat_no_encontrado":
        return "Este archivo ya no está en el espacio de trabajo del chat. Puede haberse movido o eliminado; vuelve a generarlo para abrirlo.";
      case "formato_pdf_invalido":
        return "El archivo no contiene un PDF válido o está dañado. Comprueba que el agente terminó de generarlo e inténtalo de nuevo.";
      case "formato_imagen_invalido":
        return "El archivo no contiene una imagen compatible o está dañado. Comprueba que el agente terminó de generarla e inténtalo de nuevo.";
      case "archivo_muy_grande":
        return "El archivo supera el límite de vista previa de 50 MB. Pide al agente una versión más pequeña para abrirlo.";
      case "project_path_ambiguous":
        return "Hay varios archivos con ese nombre. Elige la ruta correcta para abrirlo.";
      case "project_search_incomplete":
        return "No pudimos revisar todas las carpetas del proyecto. Abre el archivo desde la ruta completa o vuelve a intentarlo más tarde.";
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
      case "confirmacion_requerida":
        return "Confirma la instalación para continuar.";
      case "instalacion_en_curso":
        return "Ya hay una instalación en marcha. Espera a que termine.";
      case "npm_no_disponible":
        return "No encuentro npm en el servidor. Hace falta Node.js (que trae npm) instalado en el VM.";
      case "ya_instalada":
        return "OpenCode ya está instalado en el servidor.";
      case "herramienta_desconocida":
        return "Esa herramienta no se puede instalar desde Telo.";
      case "codex_no_instalado":
        return "Codex no está instalado en el servidor, así que no se puede iniciar sesión desde aquí.";
      case "login_en_curso":
        return "Ya hay un inicio de sesión en curso. Termínalo o cancélalo antes de empezar otro.";
      case "skill_nombre_invalido":
        return "El nombre usa solo minúsculas, números y guiones, sin guiones seguidos ni al principio o al final, y hasta 64 caracteres.";
      case "skill_sin_frontmatter":
        return "La skill necesita una cabecera entre tres guiones con name y description.";
      case "skill_nombre_no_coincide":
        return "El name de la cabecera debe ser igual al nombre de la skill.";
      case "skill_sin_descripcion":
        return "La cabecera necesita una description con lo que hace la skill y cuándo usarla.";
      case "skill_descripcion_larga":
        return "La description puede tener hasta 1 024 caracteres.";
      case "skill_demasiado_grande":
        return "La skill puede pesar hasta 64 KB.";
      case "skill_contiene_secreto":
        return "La skill contiene un secreto del servidor o una credencial. Quítalo y vuelve a guardar.";
      case "skill_ruta_no_permitida":
        return "La carpeta de la skill es un enlace o no es una carpeta normal, así que Telo no la toca.";
      case "skill_no_encontrada":
        return "Esa skill ya no existe.";
      case "skill_no_guardada":
        return "No se pudo guardar la skill. El archivo anterior sigue igual.";
      case "skill_con_archivos":
        return "La carpeta tiene otros archivos además de SKILL.md. Bórralos en tu equipo y vuelve a intentarlo.";
      case "skill_contenido_invalido":
        return "Falta el contenido de la skill.";
      case "memoria_demasiado_larga":
        return "La memoria puede tener hasta 4 000 caracteres. Acórtala y vuelve a guardar.";
      case "registros_no_disponibles":
        return "Los registros solo se leen en el servidor, con systemd (el VM). Aquí no hay un servicio que leer.";
      case "sin_permiso_diario":
        return "El usuario del servidor no puede leer el diario del sistema. En el VM hay que añadirlo al grupo systemd-journal.";
      case "invalid_instrucciones":
        return "Las instrucciones pueden tener hasta 8 000 caracteres.";
      case "archivo_binario":
        return "Ese archivo no es de texto, así que no se puede mostrar.";
      case "secretos_no_configurados":
        return "Falta la clave de cifrado de secretos en el servidor. Los secretos no se pueden guardar.";
      case "invalid_secret_name":
        return "El nombre usa solo mayúsculas, números y guion bajo, y no empieza con TELO_.";
      case "github_token_por_proyecto":
        return "Conecta la GitHub App desde Ajustes; las credenciales de GitHub ya no se guardan por proyecto.";
      case "invalid_secret_value":
        return "El valor debe tener entre 1 y 8 192 caracteres.";
      case "secret_not_found":
        return "Ese secreto ya no existe.";
      case "proveedor_desconocido":
        return "Ese proveedor no existe en Telo.";
      case "clave_proveedor_invalida":
        return "La clave no tiene el formato esperado. Pégala completa, sin espacios ni saltos de línea.";
      case "jev_sin_clave":
        return "Guarda una clave de Jev en Ajustes antes de probar la conexión.";
      case "jev_clave_invalida":
        return "Jev rechazó la clave. Comprueba que esté activa y vuelve a guardarla.";
      case "jev_temporalmente_no_disponible":
        return "Jev está ocupado o limitó las solicitudes. Espera un momento y vuelve a probar.";
      case "jev_sin_conexion":
        return "Telo no pudo conectarse con Jev. Comprueba la conexión del servidor y vuelve a intentarlo.";
      case "jev_respuesta_invalida":
        return "Jev respondió en un formato inesperado. Intenta de nuevo más tarde.";
      case "jev_error":
        return "No se pudo completar la prueba de Jev. Revisa la clave y vuelve a intentarlo.";
      case "proveedor_sin_clave":
        return "Este proveedor no tiene una clave guardada en Telo.";
      case "clave_existente":
        return "Este proyecto ya tiene una clave de GitHub. Bórrala antes de crear otra.";
      case "clave_sin_cifrado":
        return "Falta la clave de cifrado del servidor; configúrala antes de guardar credenciales de GitHub.";
      case "clave_no_generada":
        return "No se pudo crear la clave de GitHub en el servidor. Intenta de nuevo.";
      case "clave_no_encontrada":
        return "Este proyecto no tiene clave de GitHub.";
      case "invalid_github_url":
        return "Pega la dirección de un repositorio de GitHub, por ejemplo https://github.com/dueño/repo.";
      case "url_no_valida":
        return "Esa dirección no es un repositorio de GitHub.";
      case "project_sin_origen":
        return "Este proyecto no viene de GitHub, así que no hay nada que clonar.";
      case "project_ya_clonado":
        return "Este proyecto ya está clonado.";
      case "clonado_en_curso":
        return "Ya se está clonando este proyecto. Espera a que termine.";
      case "carpeta_no_vacia":
        return "La carpeta del proyecto ya tiene archivos, así que no se puede clonar encima.";
      case "clave_no_autorizada":
        return "GitHub no acepta la clave de este proyecto. Agrégala en el repositorio (Settings → Deploy keys) y vuelve a intentar.";
      case "repo_no_encontrado":
        return "GitHub no encuentra ese repositorio, o la clave no tiene acceso a él. Revisa la dirección y la clave.";
      case "host_no_verificado":
        return "La identidad de GitHub no coincide con la fijada en Telo. No se clonó nada.";
      case "sin_red_github":
        return "El servidor no llega a GitHub por SSH. Revisa su conexión e intenta de nuevo.";
      case "verificacion_fallo":
        return "No se pudo revisar el repositorio. Revisa la dirección y la conexión del servidor, y vuelve a intentarlo.";
      case "clonado_fallo":
        return "No se pudo clonar el repositorio. Intenta de nuevo; si sigue fallando, revisa que la clave esté en GitHub.";
      case "clave_ilegible":
        return "La clave de GitHub de este proyecto no se puede leer. Bórrala y crea otra.";
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
        return "No hay un commit aprobado para esta tarea. Revisa sus cambios y prepara una nueva autorización.";
      case "archivo_sensible":
        return "Hay archivos que parecen secretos (claves o variables .env). Quítalos de la tarea antes de guardar el commit.";
      case "sin_remoto":
        return "El proyecto no tiene un remoto al que subir los cambios.";
      case "invalid_accion":
        return "Elige inicializar Git, crear commit, subir rama o crear PR.";
      case "invalid_mensaje":
        return "El mensaje del commit debe tener entre 1 y 200 caracteres.";
      case "push_fallido":
        return textoErrorConAyuda(
          "No se pudo subir la rama al remoto.",
          err.detail,
          "comprueba que el remoto sea el repositorio correcto, que la credencial tenga permiso de escritura y que la rama destino permita subidas directas. Si GitHub exige Pull Request, sube la rama de la tarea y ábrelo desde ahí.",
        );
      case "git_failed":
        return textoErrorConAyuda(
          "Git no pudo completar la operación.",
          err.detail,
          "abre «Ver proceso» para revisar el comando que falló y comprueba el remoto, la rama y los permisos.",
        );
      case "git_timeout":
        return "Git tardó demasiado y se canceló. Por dónde empezar: revisa la conexión al remoto y vuelve a intentar cuando termine cualquier otra operación de Git.";
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
        return textoErrorConAyuda(
          "La tarea se detuvo antes de completarse.",
          err.detail,
          "abre «Ver proceso» en la tarea y localiza el último paso completado para decidir qué corregir o reintentar.",
        );
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
      case "origen_no_permitido":
        return "Esta solicitud viene de otra dirección. Abre Telo desde su dirección habitual y vuelve a intentar.";
    }
    // Los códigos de archivos y adjuntos pueden llegar por mutaciones (abrir adjuntos, revisar
    // entregables); sin su caso esta vista cae al aviso genérico de 404 que empuja a recargar sin motivo.
    switch (err.code) {
      case "attachment_not_found":
        return "La imagen adjunta ya no está disponible (pudo limpiarse con el chat). Vuelve a adjuntarla si la necesitas.";
      case "project_path_not_found":
        return "No encontramos esa ruta en la versión actual del proyecto. Puede haberse movido, cambiado de nombre o eliminado.";
      case "archivo_chat_no_encontrado":
        return "Este archivo ya no está en el espacio de trabajo del chat. Puede haberse movido o eliminado; vuelve a generarlo para abrirlo.";
      case "project_path_ambiguous":
        return "Hay varios archivos con ese nombre. Elige la ruta correcta para abrirlo.";
      case "project_search_incomplete":
        return "No pudimos revisar todas las carpetas del proyecto. Abre el archivo desde la ruta completa o vuelve a intentarlo más tarde.";
      case "formato_pdf_invalido":
        return "El archivo no contiene un PDF válido o está dañado. Comprueba que el agente terminó de generarlo e inténtalo de nuevo.";
      case "formato_imagen_invalido":
        return "El archivo no contiene una imagen compatible o está dañada. Comprueba que el agente terminó de generarla e inténtalo de nuevo.";
      case "archivo_muy_grande":
        return "El archivo supera el límite de vista previa de 50 MB. Pide al agente una versión más pequeña para abrirlo.";
    }
    const { causa, siguientePaso } = explicacionHttp(err.status);
    const siguientePasoConDetalle = siguientePasoProveedor(err.detail) ?? siguientePaso;
    return textoErrorConAyuda(causa, err.detail, `${siguientePasoConDetalle} Referencia: HTTP ${err.status}.`);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return "La solicitud se canceló antes de terminar. Por dónde empezar: repite la acción y espera a que termine.";
  }
  if (err instanceof TypeError && /failed to fetch|network|load failed/i.test(err.message)) {
    return "Telo no pudo conectarse con el servidor. Por dónde empezar: comprueba la conexión y que el servidor siga activo; después vuelve a intentarlo.";
  }
  const detalle = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return textoErrorConAyuda(
    "La aplicación encontró un error inesperado al procesar esta acción.",
    detalle || undefined,
    "recarga la pantalla y repite la acción; si vuelve a fallar, comparte este mensaje para localizar el problema.",
  );
}
