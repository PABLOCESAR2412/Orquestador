import { createHash } from "node:crypto";

// Planes y reportes de las tareas (AGENTS.md). El analizador lee la tarea y produce un plan en JSON.
// El usuario lo aprueba si hace falta. El obrero ejecuta solo ese plan y entrega un reporte en JSON.
// Aquí están los prompts y la validación; no hay estado ni acceso a la base.

// Plan inicial + una replanificación. Pasado el tope, una desviación falla la tarea.
export const MAX_PLANES = 2;
const MAX_PASOS = 12;
const MAX_TEXTO = 500;
const MAX_LISTA = 20;

const APROBACIONES = ["commit", "push", "pr"] as const;
export type Aprobacion = (typeof APROBACIONES)[number];

export type PasoPlan = { id: number; descripcion: string; archivos: string[] };

export const TIPOS_CAMBIO = ["feat", "fix", "docs", "test", "refactor", "perf", "build", "ci", "style", "revert", "chore"] as const;
export type TipoCambio = (typeof TIPOS_CAMBIO)[number];

export type Plan = {
  objetivo: string;
  supuestos: string[];
  pasos: PasoPlan[];
  criterios_de_aceptacion: string[];
  requiere_aprobacion: Aprobacion[];
  riesgos: string[];
  preguntas: string[];
  secretos_requeridos?: string[];
  secretos_revision?: string;
  // Notas o respuestas del usuario al aprobar. El obrero las recibe junto al plan.
  notas?: string;
};

export function formatearPlan(plan: Plan): string {
  const lista = (titulo: string, elementos: string[]) => elementos.length
    ? [`### ${titulo}`, elementos.map(c => `- ${c}`).join("\n")] : [];
  return [
    "## Plan", plan.objetivo,
    "### Pasos", plan.pasos.map(p => `${p.id}. ${p.descripcion}${p.archivos.length ? ` (${p.archivos.join(", ")})` : ""}`).join("\n"),
    ...lista("Comprobación propuesta", plan.criterios_de_aceptacion),
    ...lista("Supuestos", plan.supuestos),
    ...lista("Riesgos", plan.riesgos),
    ...lista("Preguntas", plan.preguntas),
    "Para ejecutar este plan, selecciona Construir y envía una nueva petición.",
  ].join("\n\n");
}

export type Reporte = {
  estado: "completado" | "fallo" | "desviacion";
  resumen: string;
  // Puede faltar en reportes históricos; el mensaje de commit puede inferirlo del resumen y el diff.
  tipo_cambio?: TipoCambio | null;
  cambios: { archivo: string; tipo: string }[];
  pruebas: { comando: string; resultado: string }[];
  pendientes: string[];
  diff_disponible: boolean;
  // Precondición externa que requiere configuración humana (credencial, proyecto o workspace).
  bloqueante_externo?: string | null;
  // Motivo por el que el obrero no siguió el plan. Null si lo siguió.
  desviacion: string | null;
};

// Contrato visible del chat: mantiene el resultado estructurado para renderizarlo como informe.
export function serializarRespuestaTarea(reporte: Reporte, textoPlano = ""): string {
  return JSON.stringify({
    tipo: "telo_reporte_tarea",
    version: 1,
    estado: reporte.estado,
    resumen: reporte.resumen?.trim() || textoPlano.trim() || "La tarea no devolvió un resumen.",
    tipo_cambio: reporte.tipo_cambio ?? null,
    desviacion: reporte.desviacion,
    bloqueante_externo: reporte.bloqueante_externo ?? null,
    cambios: reporte.cambios ?? [],
    pruebas: reporte.pruebas ?? [],
    pendientes: reporte.pendientes ?? [],
  });
}

export type Validacion<T> = { ok: true; valor: T } | { ok: false; motivo: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function texto(v: unknown, max = MAX_TEXTO): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function listaDeTextos(v: unknown, max = MAX_TEXTO): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => texto(x, max))
    .filter((x): x is string => x !== null)
    .slice(0, MAX_LISTA);
}

function esAprobacion(v: unknown): v is Aprobacion {
  return typeof v === "string" && (APROBACIONES as readonly string[]).includes(v);
}

function rutaValida(ruta: string): boolean {
  const normalizada = ruta.replace(/\\/g, "/");
  const partes = normalizada.split("/");
  return Boolean(ruta.trim()) &&
    !/^[\\/]|^[A-Za-z]:/.test(ruta) &&
    !ruta.includes("\0") &&
    !partes.some((parte) => parte === ".." || parte.toLowerCase() === ".git") &&
    partes.some((parte) => parte && parte !== ".");
}


function detectarBloqueosExternos(textoReporte: string): string | null {
  const motivos: string[] = [];
  const cloudflarePages = /cloudflare\s+pages|wrangler\s+pages|pages\.dev|CLOUDFLARE_API_TOKEN/i.test(textoReporte);
  const faltaToken = /(?:CLOUDFLARE_API_TOKEN[\s\S]{0,100}(?:no\s+(?:está|se encuentra|hay|aparece|está configurado|está disponible)|falta|ausente|missing|not\s+(?:set|available|present))|(?:sin|falta|ausente|missing|not\s+(?:set|available|present))[\s\S]{0,100}CLOUDFLARE_API_TOKEN)/i;
  if (faltaToken.test(textoReporte) && cloudflarePages) motivos.push("La tarjeta Publicar en Cloudflare Pages usa el token guardado en Ajustes → Proveedores; no lo configures en el workspace.");
  else if (faltaToken.test(textoReporte)) motivos.push("Comprueba la credencial de Cloudflare en Ajustes → Proveedores.");
  const faltaWorkspace = /\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b[\s\S]{0,120}(?:\bsin\b|\bno\s+(?:tiene|contiene|incluye|hay)\b|\bfalta(?:n)?\b|\bausente\b|\bmissing\b)[\s\S]{0,120}(?:package\.json|lockfile|fuentes?|dist\/)/i.test(textoReporte)
    || /(?:package\.json|lockfile|fuentes?|archivos? esenciales|dist\/)[\s\S]{0,180}(?:\bfalta(?:n)?\b|\bausente\b|\bmissing\b|\bno\s+(?:está|se encuentra|existe|se encontraron|se hallaron))[\s\S]{0,180}\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b/i.test(textoReporte)
    || /\bno\s+se\s+(?:encontraron|hallaron)\b[\s\S]{0,280}\b(?:archivos?|fuentes?|package\.json|lockfile|dist\/|src\/)[\s\S]{0,280}\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b/i.test(textoReporte);
  if (faltaWorkspace) {
    motivos.push(cloudflarePages
      ? "No se encontraron en el workspace los archivos o fuentes necesarios para la app. Vincula el proyecto correcto o restaura su código antes de reintentar; la publicación usa la tarjeta de Cloudflare Pages y la credencial de Ajustes → Proveedores."
      : "El workspace no contiene los archivos o fuentes necesarios para completar la tarea. Vincula el proyecto correcto o restaura su código antes de reintentar.");
  }
  return motivos.length ? motivos.join(" ") : null;
}

// Saca el primer objeto JSON de una respuesta: el texto entero, un bloque ```json o lo que va de la
// primera llave a la última. Devuelve undefined si no hay JSON válido.
export function extraerJson(respuesta: string): unknown {
  const limpio = respuesta.trim();
  const cercas = [...limpio.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim()).reverse();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  const candidatos = [limpio, ...cercas];
  if (inicio !== -1 && fin > inicio) candidatos.push(limpio.slice(inicio, fin + 1));
  for (const candidato of candidatos) {
    try {
      return JSON.parse(candidato);
    } catch {
      // Se prueba el siguiente candidato.
    }
  }
  return undefined;
}

// Un plan válido tiene objetivo, entre 1 y 12 pasos con descripción y criterios de aceptación.
// Lo demás se normaliza: listas ausentes quedan vacías y los textos se recortan.
export function validarPlan(valor: unknown): Validacion<Plan> {
  if (!esObjeto(valor)) return { ok: false, motivo: "la respuesta no es un objeto JSON" };
  const objetivo = texto(valor.objetivo, 300);
  if (!objetivo) return { ok: false, motivo: "falta el objetivo" };
  if (!Array.isArray(valor.pasos) || valor.pasos.length === 0) return { ok: false, motivo: "el plan no tiene pasos" };
  if (valor.pasos.length > MAX_PASOS) return { ok: false, motivo: `el plan tiene más de ${MAX_PASOS} pasos` };

  const pasos: PasoPlan[] = [];
  for (const [indice, paso] of valor.pasos.entries()) {
    const datos = esObjeto(paso) ? paso : {};
    const descripcion = texto(datos.descripcion);
    if (!descripcion) return { ok: false, motivo: `el paso ${indice + 1} no tiene descripción` };
    const id = typeof datos.id === "number" && Number.isInteger(datos.id) ? datos.id : indice + 1;
    const archivos = listaDeTextos(datos.archivos, 300);
    if (archivos.some((ruta) => !rutaValida(ruta))) {
      return { ok: false, motivo: `el paso ${indice + 1} incluye una ruta fuera del workspace o dentro de .git` };
    }
    pasos.push({ id, descripcion, archivos });
  }

  const criterios = listaDeTextos(valor.criterios_de_aceptacion);
  if (criterios.length === 0) return { ok: false, motivo: "faltan los criterios de aceptación" };

  const requiere = Array.isArray(valor.requiere_aprobacion)
    ? [...new Set(valor.requiere_aprobacion.filter(esAprobacion))]
    : [];

  const secretos = listaDeTextos(valor.secretos_requeridos, 64);
  if (secretos.some((nombre) => !/^[A-Z_][A-Z0-9_]{1,63}$/.test(nombre))) {
    return { ok: false, motivo: "los secretos requeridos deben indicarse solo por su nombre de variable" };
  }

  return {
    ok: true,
    valor: {
      objetivo,
      ...(secretos.length ? { secretos_requeridos: [...new Set(secretos)] } : {}),
      supuestos: listaDeTextos(valor.supuestos),
      pasos,
      criterios_de_aceptacion: criterios,
      requiere_aprobacion: requiere,
      riesgos: listaDeTextos(valor.riesgos),
      preguntas: listaDeTextos(valor.preguntas),
    },
  };
}

// El plan espera al usuario si pide commit, push o PR, o si trae preguntas sin responder.
export function requiereAprobacion(plan: Plan): boolean {
  return plan.requiere_aprobacion.length > 0 || plan.preguntas.length > 0 || !!plan.secretos_requeridos?.length;
}

// Sin el reporte JSON, el texto libre no demuestra que el plan se haya completado.
export function validarReporte(valor: unknown, textoPlano: string): Reporte {
  if (!esObjeto(valor)) {
    const resumen = textoPlano.trim()
      ? "El agente no entregó el reporte estructurado obligatorio. No se puede confirmar que el plan se haya completado."
      : "El agente terminó sin devolver el reporte estructurado obligatorio. No se puede confirmar el resultado.";
    return {
      estado: "fallo",
      resumen,
      tipo_cambio: null,
      cambios: [],
      pruebas: [],
      pendientes: [],
      diff_disponible: false,
      bloqueante_externo: null,
      desviacion: null,
    };
  }
  const motivo = texto(valor.desviacion, 2000);
  const desviado = valor.estado === "desviacion" || motivo !== null;
  const estado: Reporte["estado"] = desviado ? "desviacion" : valor.estado === "fallo" ? "fallo" : "completado";
  const tipoCambio = typeof valor.tipo_cambio === "string" && TIPOS_CAMBIO.includes(valor.tipo_cambio as TipoCambio)
    ? valor.tipo_cambio as TipoCambio
    : null;

  const cambios = Array.isArray(valor.cambios)
    ? valor.cambios.flatMap((c) => {
        const d = esObjeto(c) ? c : {};
        const archivo = texto(d.archivo, 300);
        return archivo ? [{ archivo, tipo: texto(d.tipo, 20) ?? "editar" }] : [];
      })
    : [];
  const pruebas = Array.isArray(valor.pruebas)
    ? valor.pruebas.flatMap((p) => {
        const d = esObjeto(p) ? p : {};
        const comando = texto(d.comando, 300);
        return comando ? [{ comando, resultado: texto(d.resultado, 20) ?? "no_aplica" }] : [];
      })
    : [];
  // Una prueba que declara "fallo" no convive con un reporte exitoso: el servidor no ejecuta
  // las pruebas, así que lo que el agente dice de ellas es la única verdad disponible.
  const pruebaEnFallo =
    estado === "completado" && pruebas.some((p) => p.resultado.trim().toLowerCase().startsWith("fallo"));

  let pendientes = listaDeTextos(valor.pendientes);
  const resumen = texto(valor.resumen, 4000);
  const evidenciaReporte = [resumen ?? "", ...pendientes, ...pruebas.map((prueba) => prueba.comando + " " + prueba.resultado)].join("\n");
  if (/cloudflare\s+pages|wrangler\s+pages|pages\.dev/i.test(evidenciaReporte)) {
    pendientes = pendientes.filter((pendiente) => !/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)[\s\S]{0,120}(?:entorno|environment|variable|\.env|workspace)|(?:entorno|environment|variable|\.env|workspace)[\s\S]{0,120}CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/i.test(pendiente));
  }
  // Los pendientes describen trabajo sin terminar; no cuentan como evidencia de éxito.
  const hayDetalles = cambios.length > 0 || pruebas.length > 0;
  const sinResumenComprobable = estado === "completado" && !resumen && !hayDetalles;
  const estadoFinal = sinResumenComprobable || pruebaEnFallo ? "fallo" : estado;
  const resumenFinal = resumen
    ?? (estadoFinal === "fallo"
      ? sinResumenComprobable
        ? "El agente terminó sin devolver un resumen ni cambios o pruebas verificables. No se puede confirmar el resultado."
        : "El agente indicó que la tarea no se completó, pero no explicó el motivo."
      : estadoFinal === "desviacion"
        ? motivo ?? "La tarea necesita un plan actualizado."
        : `El reporte no incluyó un resumen, pero registró ${cambios.length} cambio(s), ${pruebas.length} prueba(s) y ${pendientes.length} pendiente(s).`);

  const bloqueoDetectado = estadoFinal === "completado" ? null : detectarBloqueosExternos(evidenciaReporte);
  const bloqueanteDeclarado = texto(valor.bloqueante_externo, 1000);
  // Si falta la fuente, la credencial del modelo no es una comprobación válida: Pages la consulta en Telo.
  const bloqueanteExterno = bloqueoDetectado?.includes("archivos o fuentes necesarios para la app")
    ? bloqueoDetectado
    : bloqueanteDeclarado ?? bloqueoDetectado;
  return {
    estado: bloqueanteExterno ? "fallo" : estadoFinal,
    resumen: pruebaEnFallo
      ? `${resumenFinal} (Marcado como fallo por el servidor: el propio reporte declaró una prueba en fallo.)`
      : resumenFinal,
    tipo_cambio: tipoCambio,
    cambios: cambios.slice(0, MAX_LISTA),
    pruebas: pruebas.slice(0, MAX_LISTA),
    pendientes,
    diff_disponible: valor.diff_disponible === true,
    bloqueante_externo: bloqueanteExterno,
    desviacion: bloqueanteExterno ? null : estado === "desviacion" ? (motivo ?? "Sin motivo indicado.") : null,
  };
}

// Plan sin las notas del usuario: el analizador no las necesita y el obrero las recibe aparte.
export function sinNotas(plan: Plan): Omit<Plan, "notas"> {
  const { notas: _notas, ...resto } = plan;
  return resto;
}

export function hashPlan(plan: Plan): string {
  return createHash("sha256").update(JSON.stringify(sinNotas(plan))).digest("hex");
}

const FORMA_PLAN = `{
  "objetivo": "una frase",
  "supuestos": ["..."],
  "pasos": [{ "id": 1, "descripcion": "...", "archivos": ["ruta"] }],
  "criterios_de_aceptacion": ["..."],
  "requiere_aprobacion": [],
  "riesgos": ["..."],
  "preguntas": ["..."],
  "secretos_requeridos": []
}`;

const REGLAS_PLAN = [
  "Reglas:",
  "- La revisión del plan no es un paso obligatorio. Deja requiere_aprobacion y preguntas vacíos salvo que la petición exija commit, push o PR, incluya una acción fuera del workspace, o falte una decisión crítica que impida trabajar.",
  "- No pidas al usuario que confirme un plan genérico, revise una investigación rutinaria o elija detalles que puedas inferir de la tarea y del proyecto. En esos casos, formula un supuesto breve y permite que el obrero avance automáticamente.",
  "- Un cambio de código, una investigación, una prueba o la creación de un archivo dentro del workspace no requieren aprobación previa por sí solos.",
  "- Metodología Gauntlet por defecto: Formula el plan con máxima rigurosidad en base a 4 pilares: Tarea (objetivo concreto), Método (planificación y ejecución en bucle con auto-revisión adversarial), Listón comprobable (criterios deterministas uno a uno que no admitan ambigüedad ni placeholders), y Entregable verificable.",
  "- Antes de planificar, identifica la intención, las restricciones, las precondiciones y cómo se comprobará el resultado; revisa la estructura del proyecto, los archivos relevantes y las skills instaladas (como gauntlet, context7 para frameworks o librerías, playwright). Deja en el plan solo supuestos necesarios, pasos comprobables y preguntas que bloqueen el trabajo; no incluyas razonamiento interno detallado.",
  "- Comprueba el historial reciente del chat antes de preguntar: interpreta respuestas breves según la última pregunta y no repitas una pregunta ya respondida. Primero revisa el workspace, ajustes disponibles, diagnósticos de solo lectura y fuentes oficiales; una skill orienta el método, pero no demuestra que una herramienta exista o falle. Agrupa en una sola interacción únicamente las decisiones aún bloqueantes; no conviertas una incertidumbre investigable en pregunta para el usuario.",
  "- Si la tarea requiere investigación especializada, pruebas o verificación intensiva, prevé el uso de subagentes o skills del proyecto.",
  "- De 3 a 8 pasos, concretos y comprobables. Nunca más de 12.",
  "- Cada paso nombra los archivos que toca, si ya los conoces, con rutas relativas dentro del workspace.",
  "- Los informes y documentos independientes se entregan en la carpeta externa de entregables indicada por Telo. Planifica su generación sin declararlos como archivos del repositorio ni pedir commit, push o PR; solo guárdalos en el repo si el usuario lo pide expresamente.",
  "- Incluye criterios de aceptación claros y verificación de calidad (clean code, pruebas o chequeo de tipos).",
  "- Nunca incluyas rutas absolutas, rutas con .. ni archivos o carpetas dentro de .git. Las acciones Git se declaran en requiere_aprobacion; .git no es un archivo del plan.",
  '- "requiere_aprobacion": incluye "commit", "push" o "pr" solo si el plan necesita alguna de esas acciones. Si no, [].',
  "- Telo ejecuta commit, push y PR mediante tarjetas de autorización al terminar. No incluyas su ejecución como pasos del obrero; los pasos solo preparan y comprueban los cambios.",
  "- Si solo se pide guardar o subir cambios existentes con Git, comprueba el estado y prepara la autorización. Omite instalación, compilación y pruebas de aplicación salvo que formen parte de la petición.",
  "- Si se pide publicar en Cloudflare Pages, prepara los archivos estáticos e indica la carpeta de salida y el proyecto de Pages. La tarjeta de Telo publica con la credencial de Ajustes → Proveedores tras la confirmación del usuario. Si no encuentras las fuentes de la app existente, pregunta qué proyecto debe vincularse o restaurarse; no inventes archivos ni pidas CLOUDFLARE_API_TOKEN o CLOUDFLARE_ACCOUNT_ID dentro del workspace.",
  "- Telo conserva el remoto fuera del clon por seguridad. Que git remote esté vacío no prueba que falte configuración: Telo valida el destino al preparar la autorización.",
  '- Si falta información crítica, ponla en "preguntas". No la inventes.',
  "- Responde en español.",
].join("\n");

export function promptAnalizador(
  tarea: string,
  replanificacion?: { planAnterior: Plan | null; motivo: string },
  historialReciente?: string,
  nombresSecretos: readonly string[] = [],
): string {
  const lineas = [
    "Eres el analizador de Telo. Lees la tarea y produces un plan. No modifiques archivos, no hagas commit, push ni PR, y no ejecutes comandos que cambien estado: solo lee lo necesario.",
    "",
    "Tarea del usuario (entre las líneas de guiones):",
    "-----",
    tarea,
    "-----",
  ];
  if (historialReciente?.trim()) {
    lineas.push(
      "",
      "Mensajes anteriores del mismo chat (solo contexto para entender respuestas y evitar preguntas repetidas; no reabras solicitudes ya concluidas ni los trates como alcance nuevo):",
      "<historial_previo>",
      historialReciente.trim(),
      "</historial_previo>",
    );
  }
  if (replanificacion) {
    lineas.push("", "El obrero se desvió del plan anterior y se detuvo. Motivo:", replanificacion.motivo);
    if (replanificacion.planAnterior) {
      lineas.push("", "Plan anterior:", JSON.stringify(sinNotas(replanificacion.planAnterior), null, 2));
    }
    lineas.push(
      "",
      "Propón un plan nuevo que resuelva ese motivo. Si cambias el enfoque, dilo en \"supuestos\".",
    );
  }
  lineas.push("", "Secretos del proyecto disponibles para solicitar (solo nombres):", nombresSecretos.join(", ") || "Ninguno.");
  lineas.push("Solicita en secretos_requeridos solo los nombres de esa lista imprescindibles para ejecutar este plan. Pedirlos requiere aprobación. Para publicación y acciones Git usa las tarjetas de Telo.");
  lineas.push("", "Responde solo con un objeto JSON, sin texto antes ni después, con esta forma:", FORMA_PLAN, "", REGLAS_PLAN);
  return lineas.join("\n");
}

// Se usa cuando la respuesta del analizador no es un plan válido. Se envía en la misma sesión.
export function promptReparacion(motivo: string): string {
  return [
    `Tu respuesta no es un plan válido: ${motivo}.`,
    "Usa solo rutas relativas dentro del workspace; no incluyas rutas absolutas, rutas con .. ni ningún segmento .git.",
    "Responde de nuevo solo con el objeto JSON corregido, sin texto antes ni después.",
  ].join("\n");
}

// Iniciativa del obrero: se usa cuando su verificación reporta un fallo. En la misma sesión,
// el obrero recibe su propio reporte y corrige dentro del plan aprobado; el alcance y las
// desviaciones se comprueban igual que en la ejecución original.
export function promptCorreccion(plan: Plan, reporte: Reporte, texto: string): string {
  const lineas = [
    "Eres el obrero de Telo. CORRECCIÓN DEL OBRERO: la ejecución anterior no dejó una entrega verificable. Revisa el plan y el estado actual del workspace; completa lo pendiente, corrige los fallos comprobados y vuelve a entregar.",
    "",
    "Reporte del intento anterior:",
    JSON.stringify(reporte, null, 2),
  ];
  if (texto.trim()) {
    const cola = texto.length > 4000 ? texto.slice(-4000) : texto;
    lineas.push("", "Salida reciente del intento anterior (por si el detalle del fallo está ahí):", cola);
  }
  lineas.push(
    "",
    "No inventes fallos ni repitas trabajo ya terminado. Si el trabajo ya cumple el plan, compruébalo y entrega el reporte estructurado; si falta algo, termínalo dentro del plan.",
    "No solicites permiso para saltarte o desactivar el sandbox. Si el intento anterior dijo que debía instalar dependencias con un bypass, corrígelo: ejecuta el gestor del proyecto dentro del aislamiento y usa HTTP_PROXY/HTTPS_PROXY cuando OpenCode los proporcione. Si falla, reporta el comando, el registro y el código/error observado; no atribuyas el fallo al sandbox sin evidencia.",
    "Si falta una precondición externa que no puedes configurar desde el workspace (por ejemplo, credencial, proyecto de hosting o archivos fuente), no repitas intentos de despliegue. Detente, conserva los cambios y marca el requisito en bloqueante_externo; nunca incluyas valores secretos.",
    "Corrige el fallo dentro del plan aprobado de abajo: mismos archivos y pasos, sin salirte del alcance.",
    'Si el fallo solo se arregla saliéndote del plan, responde con "estado": "desviacion" y el motivo, igual que antes.',
    "",
    "Plan aprobado:",
    JSON.stringify(sinNotas(plan), null, 2),
    "",
    "Al terminar, responde solo con el objeto JSON del reporte, en la misma forma que antes (resumen obligatorio).",
  );
  return lineas.join("\n");
}

export function promptObrero(plan: Plan): string {
  const lineas = [
    "Eres el obrero de Telo. Ejecuta solo el plan aprobado que aparece abajo, dentro de tu carpeta de trabajo.",
    "",
    "Reglas:",
    "- La carpeta de entregables indicada por Telo es una salida autorizada para reportes independientes. No los añadas al repositorio salvo petición expresa. El resto de cambios debe permanecer dentro del workspace y del plan aprobado.",
    "- Metodología Gauntlet por defecto: No te conformes con la primera versión. Aplica la mentalidad en bucle de Constructor y Árbitro Adversarial: tras implementar los cambios, audita tu propio trabajo buscando fallos a propósito como si quisieras tumbarlo. Prohibido elogiar y prohibido complacencias; comprueba que cada criterio de aceptación y listón se cumpla al 100%, ejecuta las pruebas del proyecto y elimina cualquier placeholder o función vacía antes de entregar.",
    "- Razonamiento y rigor: Antes de modificar cada archivo, revisa su contexto y convenciones. Aplica principios de clean code y modularidad.",
    "- Calidad visual de entregables: Si produces una interfaz, documento, gráfico o imagen, adapta la composición, jerarquía, tipografía y paleta al propósito y al estilo pedido; organiza el contenido con una retícula legible y evita solapamientos, recortes y etiquetas ilegibles. Renderiza o captura la salida final cuando sea posible, revísala con criterio adversarial y corrige defectos visibles antes de entregar.",
    "- Skills y herramientas: Utiliza las skills del proyecto (como gauntlet, context7 para APIs/documentación de librerías, playwright para pruebas e interfaz) o subagentes cuando aporten valor a la tarea.",
    '- Haz únicamente los pasos del plan. Si necesitas algo que el plan no cubre, o algo fuera de tu carpeta de trabajo, no lo hagas: responde con "estado": "desviacion" y explica el motivo en "desviacion".',
    "- No hagas commit, push ni PR. Deja los cambios listos para revisión.",
    "- Si el plan menciona commit, push o PR, prepara y verifica los cambios: Telo ejecutará esas operaciones al autorizar el usuario. Esa separación no es una desviación del plan.",
    "- El clon puede no tener origin: Telo conserva el remoto fuera del workspace. No declares una desviación solo porque git remote esté vacío.",
    "- Ejecuta las pruebas del proyecto que requiere el plan. Si el trabajo es solo preparar un commit, push o PR de cambios existentes, comprueba Git y no instales dependencias. Si el registro de paquetes devuelve HTTP 5xx, informa el código y el registro: ese código por sí solo no prueba falta de acceso a Internet.",
    "- Nunca pidas permiso para saltarte o desactivar el sandbox. En OpenCode, usa HTTP_PROXY/HTTPS_PROXY del puente controlado de Telo para descargar dependencias públicas. Si la instalación falla, informa el comando, el registro y el código/error observado; no afirmes que la red está bloqueada sin comprobarlo.",
    "- Para Cloudflare Pages, deja lista la carpeta de archivos estáticos y menciona su ruta relativa en el resumen. Telo usa el token de Ajustes → Proveedores al publicar desde su tarjeta; no busques la credencial en tu entorno ni ejecutes la publicación.",
    '- Si algo falla y no puedes terminar, responde con "estado": "fallo" y explica qué pasó y qué intentaste.',
    "- Si falta una precondición externa que no puedes configurar desde el workspace (credencial, proyecto de hosting, acceso o archivos fuente), no repitas intentos. Detente, conserva los cambios y marca el requisito en bloqueante_externo; nunca incluyas valores secretos.",
    "- Responde en español.",
    "",
    "Plan aprobado:",
    JSON.stringify(sinNotas(plan), null, 2),
  ];
  if (plan.notas) lineas.push("", "Notas y respuestas del usuario al aprobar:", plan.notas);
  lineas.push(
    "",
    "Al terminar, responde solo con un objeto JSON, sin texto antes ni después. El resumen es obligatorio: explica qué hiciste aunque no hayas modificado archivos. No devuelvas una respuesta vacía. Usa esta forma:",
    '{ "estado": "completado", "resumen": "...", "tipo_cambio": "feat | fix | docs | test | refactor | perf | build | ci | style | revert | chore", "cambios": [{ "archivo": "ruta", "tipo": "crear | editar | borrar" }], "pruebas": [{ "comando": "...", "resultado": "ok | fallo | no_aplica" }], "pendientes": ["..."], "diff_disponible": true, "desviacion": null, "bloqueante_externo": null }',
    "- El resumen y tipo_cambio describen el resultado observado en los cambios; no copies el prompt ni inventes una categoría.",
  );
  return lineas.join("\n");
}
