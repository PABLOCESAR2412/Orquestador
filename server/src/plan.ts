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
    pasos.push({ id, descripcion, archivos: listaDeTextos(datos.archivos, 300) });
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
    return {
      estado: "completado",
      resumen: textoPlano.slice(0, 4000),
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

  return {
    estado,
    resumen: texto(valor.resumen, 4000) ?? "Sin resumen.",
    cambios: cambios.slice(0, MAX_LISTA),
    pruebas: pruebas.slice(0, MAX_LISTA),
    pendientes: listaDeTextos(valor.pendientes),
    diff_disponible: valor.diff_disponible === true,
    desviacion: estado === "desviacion" ? (motivo ?? "Sin motivo indicado.") : null,
  };
}

// Plan sin las notas del usuario: el analizador no las necesita y el obrero las recibe aparte.
function sinNotas(plan: Plan): Omit<Plan, "notas"> {
  const { notas: _notas, ...resto } = plan;
  return resto;
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
  "- De 3 a 8 pasos, concretos y comprobables. Nunca más de 12.",
  "- Cada paso nombra los archivos que toca, si ya los conoces.",
  '- "requiere_aprobacion": incluye "commit", "push" o "pr" solo si el plan necesita alguna de esas acciones. Si no, [].',
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
    "Responde de nuevo solo con el objeto JSON corregido, sin texto antes ni después.",
  ].join("\n");
}

export function promptObrero(plan: Plan): string {
  const lineas = [
    "Eres el obrero de Telo. Ejecuta solo el plan aprobado que aparece abajo, dentro de tu carpeta de trabajo.",
    "",
    "Reglas:",
    '- Haz únicamente los pasos del plan. Si necesitas algo que el plan no cubre, o algo fuera de tu carpeta de trabajo, no lo hagas: responde con "estado": "desviacion" y explica el motivo en "desviacion".',
    "- No hagas commit, push ni PR. Deja los cambios listos para revisión.",
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
    "Al terminar, responde solo con un objeto JSON, sin texto antes ni después, con esta forma:",
    '{ "estado": "completado", "resumen": "...", "cambios": [{ "archivo": "ruta", "tipo": "crear | editar | borrar" }], "pruebas": [{ "comando": "...", "resultado": "ok | fallo | no_aplica" }], "pendientes": ["..."], "diff_disponible": true, "desviacion": null }',
  );
  return lineas.join("\n");
}
