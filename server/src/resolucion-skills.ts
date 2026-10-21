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

function skillsAutomaticas(texto: string): string[] {
  const resultado: string[] = [];
  const interfaz = /\b(frontend|interfaz|ui|css|componente|responsive|diseño|diseño visual|pantalla|formulario|estilo)\b/i.test(texto);
  if (interfaz) resultado.push("frontend-design", "playwright");
  else if (/\b(playwright|navegador|browser|prueba visual|e2e)\b/i.test(texto)) resultado.push("playwright");

  const mencionaImagen = /\b(im[aá]gen(?:es)?|ilustraci[oó]n(?:es)?|infograf[ií]a(?:s)?|p[oó]ster(?:es)?|poster(?:s)?|gr[aá]fico(?:s)?|arte visual)\b/i.test(texto);
  const creaImagen = /\b(crea(?:r|ci[oó]n)?|gener(?:a|ar|aci[oó]n)|haz(?:me)?|diseñ(?:a|ar|o)|ilustra(?:r)?|dibuja(?:r)?|produce|compon(?:er|e)|mejora(?:r)?)\b/i.test(texto);
  if (mencionaImagen && creaImagen) resultado.push("image-design");

  const cambioAcotado = texto.length <= 4_000 &&
    /\b(corrige|arregla|fix|bug|error|implementa|añade|agrega|actualiza|cambia|refactoriza)\b/i.test(texto) &&
    !/\b(análisis completo|migración|rediseña todo|reescribe|desde cero|varios proyectos)\b/i.test(texto);
  if (cambioAcotado) resultado.push("ponytail");
  return resultado;
}

// Resuelve las skills invocadas priorizando el proyecto activo y cayendo al ámbito global
export function resolverSkillsInvocadas(
  nombres: string[],
  projectId?: string | null,
): SkillInvocada[] {
  const resueltas: SkillInvocada[] = [];
  const ambitoProy = projectId ? ambitoProyecto(projectId) : null;

  for (const nombre of nombres) {
    let encontrada = false;
    // 1. Intentar en el proyecto si existe
    if (ambitoProy) {
      try {
        const detalle = leerSkill(ambitoProy, nombre);
        resueltas.push({ nombre, contenido: detalle.contenido, ambito: "proyecto" });
        encontrada = true;
      } catch {
        // No está en el proyecto; se buscará en global
      }
    }
    // 2. Intentar en global
    if (!encontrada) {
      try {
        const detalle = leerSkill({ ambito: "global" }, nombre);
        resueltas.push({ nombre, contenido: detalle.contenido, ambito: "global" });
      } catch {
        // Skill no instalada o no encontrada
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
