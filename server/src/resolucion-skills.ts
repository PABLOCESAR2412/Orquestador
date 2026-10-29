import { db } from "./db";
import { leerSkill, type AmbitoSkills } from "./skills";

// Detecta menciones explícitas de skills con sintaxis $nombre-skill, @nombre-skill, /nombre-skill o skill:nombre
// (ej: $playwright, @impeccable, $caveman, /playwright, @skill:playwright)
export function detectarMencionesSkills(texto: string): string[] {
  if (!texto || typeof texto !== "string") return [];
  // Token que empieza por $, @ o / (opcionalmente seguido de 'skill:')
  const regex = /(?:^|[\s([{"'`])([$@/])(?:skill:)?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=$|[\s)\]}"'`,:;.!?])/gi;
  const encontrados = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(texto)) !== null) {
    const prefijo = match[1];
    const nombre = match[2]?.toLowerCase();
    // Si fue con /, verificar que no forme parte de una ruta (ej: /a/b o https://...)
    if (prefijo === "/") {
      const indice = match.index;
      if (indice > 0 && texto[indice - 1] === "/") continue;
      const fin = match.index + match[0].length;
      if (fin < texto.length && texto[fin] === "/") continue;
    }
    if (nombre && nombre.length <= 64) {
      encontrados.add(nombre);
    }
  }

  // Token directo "skill:nombre" sin prefijo especial
  const regexDirecto = /(?:^|[\s([{"'`])skill:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=$|[\s)\]}"'`,:;.!?])/gi;
  while ((match = regexDirecto.exec(texto)) !== null) {
    const nombre = match[1]?.toLowerCase();
    if (nombre && nombre.length <= 64) {
      encontrados.add(nombre);
    }
  }

  return [...encontrados];
}

function ambitoProyecto(projectId: string): AmbitoSkills | null {
  const proyecto = db.query<{ repo_path: string | null }, [string]>(
    "SELECT repo_path FROM projects WHERE id = ?",
  ).get(projectId);
  return proyecto?.repo_path ? { ambito: "proyecto", carpeta: proyecto.repo_path } : null;
}

export type SkillInvocada = {
  nombre: string;
  contenido: string;
  ambito: "proyecto" | "global";
};

export function requiereContext7(texto: string): boolean {
  const normalizado = texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\bcontext\s*7\b|\bcontext7\b/.test(normalizado)) return true;
  const tecnologia = /\b(?:react|vue|next(?:\.js)?|svelte|angular|vite|bun|node(?:\.js)?|hono|fastify|express|prisma|drizzle|convex|cloudflare|aws|azure|google cloud|tailwind|typescript|python|rust|go|sdk|api|framework|libreria|biblioteca|library|dependencia|paquete|package|cli)\b/.test(normalizado);
  const consulta = /\b(?:documentacion|docs?|api|sdk|ejemplo|configurar|configuracion|instalar|integrar|migrar|actualizar|version|implementar|programar|codigo|code|depurar|debug|corregir|arreglar|error|como|how)\b/.test(normalizado);
  return tecnologia && consulta;
}

function skillsAutomaticas(texto: string): string[] {
  const resultado: string[] = [];
  const textoNormalizado = texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const accionesAutoria = "(?:crea|crear|creacion|redacta|redactar|mejora|mejorar|optimiza|optimizar|revisa|revisar|evalua|evaluar|convierte|convertir|deriva|derivar|disena|disenar|probar|prueba)";
  const autoriaSkill = new RegExp(
    `\\b${accionesAutoria}\\b[\\s\\S]{0,48}\\b(?:skills?|habilidades?)\\b|\\b(?:skills?|habilidades?)\\b[\\s\\S]{0,48}\\b${accionesAutoria}\\b`,
    "i",
  ).test(textoNormalizado);
  if (autoriaSkill) resultado.push("skill-authoring");
  if (requiereContext7(texto)) resultado.push("context7");

  const interfaz = /\b(frontend|interfaz|ui|css|componente|responsive|diseño|diseño visual|pantalla|formulario|estilo)\b/i.test(texto);
  if (interfaz) resultado.push("frontend-design", "playwright");
  else if (/\b(playwright|navegador|browser|prueba visual|e2e)\b/i.test(texto)) resultado.push("playwright");

  const mencionaImagen = /\b(im[aá]gen(?:es)?|ilustraci[oó]n(?:es)?|infograf[ií]a(?:s)?|p[oó]ster(?:es)?|poster(?:s)?|gr[aá]fico(?:s)?|arte visual)\b/i.test(texto);
  const creaImagen = /\b(crea(?:r|ci[oó]n)?|gener(?:a|ar|aci[oó]n)|haz(?:me)?|diseñ(?:a|ar|o)|ilustra(?:r)?|dibuja(?:r)?|produce|compon(?:er|e)|mejora(?:r)?)\b/i.test(texto);
  if (mencionaImagen && creaImagen) resultado.push("image-design");

  const mencionaMovimiento = /\b(animaci[oó]n(?:es)?|animad[oa]s?|movimiento|video(?:s)?|v[ií]deo(?:s)?|mp4|gif|webp animad[oa]|motion design)\b/i.test(texto);
  const creaMovimiento = /\b(crea(?:r|ci[oó]n)?|gener(?:a|ar|aci[oó]n)|haz(?:me)?|hacer|diseñ(?:a|ar|o)|anima(?:r)?|edita(?:r)?|convierte|produce|mejora(?:r)?|corrige|arregla|revisa)\b/i.test(texto);
  const pideMovimiento = /\b(?:quiero|quisiera|necesito|me gustar[ií]a|puedes|podr[ií]as)\b[\s\S]{0,100}\b(?:hacer|crear|generar|producir|editar|animar|convertir)\b[\s\S]{0,100}\b(?:animaci[oó]n|video|v[ií]deo|mp4|gif)\b|\b(?:quiero|quisiera|necesito|me gustar[ií]a)\b[\s\S]{0,80}\b(?:un|una)\s+(?:video|v[ií]deo|animaci[oó]n)\b/i.test(texto);
  if (mencionaMovimiento && (creaMovimiento || pideMovimiento)) resultado.push("motion-design", "hyperframes-video");

  const cambioAcotado = texto.length <= 4_000 &&
    /\b(corrige|arregla|fix|bug|error|implementa|añade|agrega|actualiza|cambia|refactoriza)\b/i.test(texto) &&
    !/\b(análisis completo|migración|rediseña todo|reescribe|desde cero|varios proyectos)\b/i.test(texto);
  if (cambioAcotado) resultado.push("ponytail");
  return resultado;
}

// Las skills globales de Telo definen el comportamiento común. Las del proyecto solo
// completan una skill que no exista globalmente, para que un repo no sustituya la guía del sistema.
export function resolverSkillsInvocadas(
  nombres: string[],
  projectId?: string | null,
): SkillInvocada[] {
  const resueltas: SkillInvocada[] = [];
  const ambitoProy = projectId ? ambitoProyecto(projectId) : null;

  for (const nombre of nombres) {
    let encontrada = false;
    // 1. Intentar en global: las instrucciones compartidas de Telo tienen prioridad.
    try {
      const detalle = leerSkill({ ambito: "global" }, nombre);
      resueltas.push({ nombre, contenido: detalle.contenido, ambito: "global" });
      encontrada = true;
    } catch {
      // No está instalada globalmente; se buscará en el proyecto.
    }
    // 2. Usar la del proyecto solo como complemento cuando falta la global.
    if (!encontrada && ambitoProy) {
      try {
        const detalle = leerSkill(ambitoProy, nombre);
        resueltas.push({ nombre, contenido: detalle.contenido, ambito: "proyecto" });
        encontrada = true;
      } catch {
        // No está en el proyecto.
      }
    }
  }
  return resueltas;
}

// Inyecta las instrucciones completas de las skills invocadas en el prompt que recibe el agente
export function inyectarSkillsEnPrompt(
  prompt: string,
  projectId?: string | null,
): { promptFinal: string; skillsInvocadas: string[] } {
  const menciones = detectarMencionesSkills(prompt);
  const nombres = [...new Set([...menciones, ...skillsAutomaticas(prompt)])];
  if (nombres.length === 0) return { promptFinal: prompt, skillsInvocadas: [] };

  const skills = resolverSkillsInvocadas(nombres, projectId);
  if (skills.length === 0) return { promptFinal: prompt, skillsInvocadas: [] };

  const bloques = skills.map((s) => {
    return [
      `--- INICIO SKILL: $${s.nombre} (${s.ambito === "proyecto" ? "del proyecto" : "global del servidor"}) ---`,
      s.contenido.trim(),
      `--- FIN SKILL: $${s.nombre} ---`,
    ].join("\n");
  });

  const encabezado = [
    "[SKILLS ACTIVADAS POR EL USUARIO]",
    "Aplica estas skills, seleccionadas por el usuario o por el tipo de tarea:",
    "",
    bloques.join("\n\n"),
    "",
    "DIRECTIVA OBLIGATORIA: Aplica y respeta estrictamente los principios, workflows, herramientas y buenas prácticas descritas en las skills activadas arriba para responder y resolver esta petición.",
    "---",
  ].join("\n");

  return {
    promptFinal: `${encabezado}\n\n${prompt}`,
    skillsInvocadas: skills.map((s) => s.nombre),
  };
}
