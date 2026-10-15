import { createHash } from "node:crypto";

export type Plan = {
  objetivo: string;
  supuestos: string[];
  pasos: { id: number; descripcion: string; archivos: string[] }[];
  criterios_de_aceptacion: string[];
  requiere_aprobacion: ("init" | "commit" | "push" | "pr")[];
  riesgos: string[];
  preguntas: string[];
};

export function leerPlan(texto: string): Plan {
  const limpio = texto
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  let p: Plan;
  try {
    p = JSON.parse(limpio);
  } catch {
    throw new Error("El analizador no devolvió un plan JSON válido. Reintenta la tarea.");
  }
  const textos = (a: unknown): a is string[] =>
    Array.isArray(a) && a.length <= 50 && a.every((v) => typeof v === "string" && v.length <= 4000);
  if (
    !p ||
    typeof p.objetivo !== "string" ||
    !p.objetivo.trim() ||
    p.objetivo.length > 4000 ||
    !textos(p.supuestos) ||
    !textos(p.criterios_de_aceptacion) ||
    !p.criterios_de_aceptacion.length ||
    !textos(p.riesgos) ||
    !textos(p.preguntas) ||
    !textos(p.requiere_aprobacion) ||
    p.requiere_aprobacion.some((a) => !["init", "commit", "push", "pr"].includes(a)) ||
    !Array.isArray(p.pasos) ||
    p.pasos.length < 1 ||
    p.pasos.length > 8 ||
    p.pasos.some(
      (s, i) =>
        !s ||
        s.id !== i + 1 ||
        typeof s.descripcion !== "string" ||
        !s.descripcion.trim() ||
        s.descripcion.length > 4000 ||
        !textos(s.archivos) ||
        s.archivos.some(
          (r) => !r.trim() || /(^[\\/]|^[A-Za-z]:|(^|[\\/])(?:\.\.|\.git)([\\/]|$)|\0)/i.test(r),
        ),
    )
  ) {
    throw new Error(
      "El plan tiene un formato inválido o pide archivos fuera del workspace. Reintenta la tarea.",
    );
  }
  return p;
}

export const hashPlan = (plan: Plan) =>
  createHash("sha256").update(JSON.stringify(plan)).digest("hex");

export type Reporte = {
  resumen: string;
  cambios: { archivo: string; tipo: "crear" | "editar" | "borrar" }[];
  pruebas: { comando: string; resultado: "ok" | "fallo" | "no_aplica" }[];
  pendientes: string[];
  diff_disponible: boolean;
  memoria?: string;
};
export function leerReporte(texto: string): Reporte | { requiere_revision: string } {
  let r;
  try {
    r = JSON.parse(
      texto
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error(
      "El obrero no devolvió un reporte JSON válido. Revisa los cambios antes de reintentar.",
    );
  }
  const textoValido = (v: unknown): v is string => typeof v === "string" && v.length <= 8000;
  if (r && textoValido(r.requiere_revision) && r.requiere_revision.trim())
    return { requiere_revision: r.requiere_revision };
  if (
    !r ||
    !textoValido(r.resumen) ||
    !r.resumen.trim() ||
    !Array.isArray(r.cambios) ||
    r.cambios.length > 200 ||
    r.cambios.some(
      (c: any) =>
        !c ||
        !textoValido(c.archivo) ||
        !c.archivo.trim() ||
        /(^[\\/]|^[A-Za-z]:|(^|[\\/])(?:\.\.|\.git)([\\/]|$)|\0)/i.test(c.archivo) ||
        !["crear", "editar", "borrar"].includes(c.tipo),
    ) ||
    !Array.isArray(r.pruebas) ||
    r.pruebas.length > 100 ||
    r.pruebas.some(
      (p: any) =>
        !p || !textoValido(p.comando) || !["ok", "fallo", "no_aplica"].includes(p.resultado),
    ) ||
    !Array.isArray(r.pendientes) ||
    r.pendientes.length > 100 ||
    !r.pendientes.every(textoValido) ||
    typeof r.diff_disponible !== "boolean" ||
    (r.memoria !== undefined && (!textoValido(r.memoria) || r.memoria.length > 4000))
  )
    throw new Error(
      "El reporte del obrero está incompleto o tiene valores inválidos. Revisa el diff.",
    );
  return r as Reporte;
}

export const instruccionAnalizador = (
  prompt: string,
) => `Actúa SOLO como analizador. La carpeta es de solo lectura. No ejecutes comandos que cambien estado, ni llames servicios para modificar datos. Lee el contexto y devuelve SOLO JSON con este formato:
{"objetivo":"...","supuestos":[],"pasos":[{"id":1,"descripcion":"...","archivos":[]}],"criterios_de_aceptacion":["..."],"requiere_aprobacion":[],"riesgos":[],"preguntas":[]}
Entre 1 y 8 pasos; rutas relativas al workspace. Lista cada archivo nuevo; solo lista un directorio completo si ya existe y necesitas editar su contenido. requiere_aprobacion solo acepta init, commit, push, pr. Si falta información crítica, inclúyela en preguntas. Git y PR los ejecuta el servidor después de otra aprobación: el obrero solo prepara archivos y prueba.
Tarea del usuario:\n${prompt}`;

export const instruccionObrero = (
  plan: Plan,
  prompt: string,
) => `Ejecuta exclusivamente este plan aprobado dentro del workspace. No hagas git init, commit, push ni PR: el servidor solicita autorización al usuario para esas acciones. No edites .git. Si necesitas desviarte o falta información, DETENTE y devuelve JSON {"requiere_revision":"explicación"}. No cambies otros archivos. Prueba lo modificado. Al terminar devuelve SOLO JSON {"resumen":"...","cambios":[{"archivo":"...","tipo":"crear | editar | borrar"}],"pruebas":[{"comando":"...","resultado":"ok | fallo | no_aplica"}],"pendientes":[],"diff_disponible":true}.
Elige un solo valor para tipo y resultado, no copies la lista de alternativas. Puedes incluir memoria como texto de hasta 4000 caracteres con los datos estables del proyecto aprendidos o actualizados; conserva la memoria útil anterior.
Plan aprobado:\n${JSON.stringify(plan)}\nTarea:\n${prompt}`;
