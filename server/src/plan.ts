import { createHash } from "node:crypto";

// Planes y reportes de las tareas (AGENTS.md). El analizador lee la tarea y produce un plan en JSON.
// El usuario lo aprueba si hace falta. El obrero ejecuta solo ese plan y entrega un reporte en JSON.
// Aquí están los prompts y la validación; no hay estado ni acceso a la base.

// Plan inicial + dos replanificaciones. Pasado el tope, una desviación falla la tarea.
export const MAX_PLANES = 3;
const MAX_PASOS = 12;
const MAX_TEXTO = 500;
const MAX_LISTA = 20;

const APROBACIONES = ["commit", "push", "pr"] as const;
export type Aprobacion = (typeof APROBACIONES)[number];

export type PasoPlan = { id: number; descripcion: string; archivos: string[] };

export type Plan = {
  objetivo: string;
  supuestos: string[];
  pasos: PasoPlan[];
  criterios_de_aceptacion: string[];
  requiere_aprobacion: Aprobacion[];
  riesgos: string[];
  preguntas: string[];
  // Notas o respuestas del usuario al aprobar. El obrero las recibe junto al plan.
  notas?: string;
};

export type Reporte = {
  estado: "completado" | "fallo" | "desviacion";
  resumen: string;
  cambios: { archivo: string; tipo: string }[];
  pruebas: { comando: string; resultado: string }[];
  pendientes: string[];
  diff_disponible: boolean;
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
    desviacion: reporte.desviacion,
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

  return {
    ok: true,
    valor: {
      objetivo,
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
  return plan.requiere_aprobacion.length > 0 || plan.preguntas.length > 0;
}

// Un reporte sin JSON no se pierde: el texto del agente pasa a ser el resumen.
export function validarReporte(valor: unknown, textoPlano: string): Reporte {
  if (!esObjeto(valor)) {
    const resumen = textoPlano.trim().slice(0, 4000);
    return {
      estado: resumen ? "completado" : "fallo",
      resumen: resumen || "El agente terminó sin devolver un resumen ni cambios o pruebas verificables. No se puede confirmar el resultado.",
      cambios: [],
      pruebas: [],
      pendientes: [],
      diff_disponible: false,
      desviacion: null,
    };
  }
  const motivo = texto(valor.desviacion, 2000);
  const desviado = valor.estado === "desviacion" || motivo !== null;
  const estado: Reporte["estado"] = desviado ? "desviacion" : valor.estado === "fallo" ? "fallo" : "completado";

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

  const pendientes = listaDeTextos(valor.pendientes);
  const resumen = texto(valor.resumen, 4000);
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

  return {
    estado: estadoFinal,
    resumen: pruebaEnFallo
      ? `${resumenFinal} (Marcado como fallo por el servidor: el propio reporte declaró una prueba en fallo.)`
      : resumenFinal,
    cambios: cambios.slice(0, MAX_LISTA),
    pruebas: pruebas.slice(0, MAX_LISTA),
    pendientes,
    diff_disponible: valor.diff_disponible === true,
    desviacion: estado === "desviacion" ? (motivo ?? "Sin motivo indicado.") : null,
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
  "preguntas": ["..."]
}`;

const REGLAS_PLAN = [
  "Reglas:",
  "- La revisión del plan no es un paso obligatorio. Deja requiere_aprobacion y preguntas vacíos salvo que la petición exija commit, push o PR, incluya una acción fuera del workspace, o falte una decisión crítica que impida trabajar.",
  "- No pidas al usuario que confirme un plan genérico, revise una investigación rutinaria o elija detalles que puedas inferir de la tarea y del proyecto. En esos casos, formula un supuesto breve y permite que el obrero avance automáticamente.",
  "- Un cambio de código, una investigación, una prueba o la creación de un archivo dentro del workspace no requieren aprobación previa por sí solos.",
  "- Metodología Gauntlet por defecto: Formula el plan con máxima rigurosidad en base a 4 pilares: Tarea (objetivo concreto), Método (planificación y ejecución en bucle con auto-revisión adversarial), Listón comprobable (criterios deterministas uno a uno que no admitan ambigüedad ni placeholders), y Entregable verificable.",
  "- Antes de planificar, identifica la intención, las restricciones, las precondiciones y cómo se comprobará el resultado; revisa la estructura del proyecto, los archivos relevantes y las skills instaladas (como gauntlet, context7 para frameworks o librerías, playwright). Deja en el plan solo supuestos necesarios, pasos comprobables y preguntas que bloqueen el trabajo; no incluyas razonamiento interno detallado.",
  "- Si la tarea requiere investigación especializada, pruebas o verificación intensiva, prevé el uso de subagentes o skills del proyecto.",
  "- De 3 a 8 pasos, concretos y comprobables. Nunca más de 12.",
  "- Cada paso nombra los archivos que toca, si ya los conoces, con rutas relativas dentro del workspace.",
  "- Los informes y documentos independientes se entregan en la carpeta externa de entregables indicada por Telo. Planifica su generación sin declararlos como archivos del repositorio ni pedir commit, push o PR; solo guárdalos en el repo si el usuario lo pide expresamente.",
  "- Incluye criterios de aceptación claros y verificación de calidad (clean code, pruebas o chequeo de tipos).",
  "- Nunca incluyas rutas absolutas, rutas con .. ni archivos o carpetas dentro de .git. Las acciones Git se declaran en requiere_aprobacion; .git no es un archivo del plan.",
  '- "requiere_aprobacion": incluye "commit", "push" o "pr" solo si el plan necesita alguna de esas acciones. Si no, [].',
  "- Telo ejecuta commit, push y PR mediante tarjetas de autorización al terminar. No incluyas su ejecución como pasos del obrero; los pasos solo preparan y comprueban los cambios.",
  "- Telo conserva el remoto fuera del clon por seguridad. Que git remote esté vacío no prueba que falte configuración: Telo valida el destino al preparar la autorización.",
  '- Si falta información crítica, ponla en "preguntas". No la inventes.',
  "- Responde en español.",
].join("\n");

export function promptAnalizador(tarea: string, replanificacion?: { planAnterior: Plan | null; motivo: string }): string {
  const lineas = [
    "Eres el analizador de Telo. Lees la tarea y produces un plan. No modifiques archivos, no hagas commit, push ni PR, y no ejecutes comandos que cambien estado: solo lee lo necesario.",
    "",
    "Tarea del usuario (entre las líneas de guiones):",
    "-----",
    tarea,
    "-----",
  ];
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
    "Eres el obrero de Telo. CORRECCIÓN DEL OBRERO: tu verificación reportó un fallo. Corrígelo y vuelve a entregar.",
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
    "- Ejecuta las pruebas del proyecto. Si no hay pruebas, dilo en el reporte.",
    '- Si algo falla y no puedes terminar, responde con "estado": "fallo" y explica qué pasó y qué intentaste.',
    "- Responde en español.",
    "",
    "Plan aprobado:",
    JSON.stringify(sinNotas(plan), null, 2),
  ];
  if (plan.notas) lineas.push("", "Notas y respuestas del usuario al aprobar:", plan.notas);
  lineas.push(
    "",
    "Al terminar, responde solo con un objeto JSON, sin texto antes ni después. El resumen es obligatorio: explica qué hiciste aunque no hayas modificado archivos. No devuelvas una respuesta vacía. Usa esta forma:",
    '{ "estado": "completado", "resumen": "...", "cambios": [{ "archivo": "ruta", "tipo": "crear | editar | borrar" }], "pruebas": [{ "comando": "...", "resultado": "ok | fallo | no_aplica" }], "pendientes": ["..."], "diff_disponible": true, "desviacion": null }',
  );
  return lineas.join("\n");
}
