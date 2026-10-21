import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-resolucion-skills-"));
const homePrueba = join(raiz, "home");
mkdirSync(homePrueba, { recursive: true });
process.env.HOME = homePrueba;
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { detectarMencionesSkills, inyectarSkillsEnPrompt, resolverSkillsInvocadas } = await import("../src/resolucion-skills");
const carpetaProyecto = join(raiz, "proyectos", "resolucion-test");

function escribirSkill(ambito: "global" | "proyecto", nombre: string, contenido: string) {
  const base = ambito === "global"
    ? join(homePrueba, ".config", "opencode", "skills")
    : join(carpetaProyecto, ".opencode", "skills");
  const carpeta = join(base, nombre);
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, "SKILL.md"), contenido);
}

afterAll(() => {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
});

afterEach(() => {
  db.query("DELETE FROM projects WHERE id = ?").run("p-res");
  rmSync(carpetaProyecto, { recursive: true, force: true });
});

function setupProyecto() {
  mkdirSync(carpetaProyecto, { recursive: true });
  db.query("INSERT OR IGNORE INTO projects (id, name, repo_path) VALUES (?, ?, ?)")
    .run("p-res", "ResTest", carpetaProyecto);
  return "p-res";
}

test("detectarMencionesSkills detecta $, @, / y skill: correctamente", () => {
  const texto = "Quiero que uses $playwright, @caveman y @skill:impeccable para revisar el flujo, o también /context7 y skill:frontend-design";
  const menciones = detectarMencionesSkills(texto);
  expect(menciones).toContain("playwright");
  expect(menciones).toContain("caveman");
  expect(menciones).toContain("impeccable");
  expect(menciones).toContain("context7");
  expect(menciones).toContain("frontend-design");
  expect(menciones).toHaveLength(5);
});

test("detectarMencionesSkills ignora símbolos monetarios o rutas normales", () => {
  expect(detectarMencionesSkills("El costo es $50 o $100 dólares")).toEqual([]);
  expect(detectarMencionesSkills("Visita https://ejemplo.com/ruta/archivo")).toEqual([]);
  expect(detectarMencionesSkills("El usuario es user@email.com")).toEqual([]);
});

test("resolver e inyectar skills en el prompt", () => {
  const id = setupProyecto();
  // Guardar una skill en el proyecto
  escribirSkill(
    "proyecto",
    "playwright",
    "---\nname: playwright\ndescription: Pruebas end-to-end\n---\n\nUsa page.goto y espera selectores.",
  );

  const res = inyectarSkillsEnPrompt("Ejecuta $playwright en este proyecto", id);
  expect(res.skillsInvocadas).toEqual(["playwright"]);
  expect(res.promptFinal).toContain("[SKILLS ACTIVADAS POR EL USUARIO]");
  expect(res.promptFinal).toContain("Usa page.goto y espera selectores.");
  expect(res.promptFinal).toContain("Ejecuta $playwright en este proyecto");
});

test("prioriza la skill global de Telo y conserva las skills únicas del proyecto", () => {
  const id = setupProyecto();
  escribirSkill(
    "global",
    "playwright",
    "---\nname: playwright\ndescription: Guía global de Telo\n---\n\nUsa el navegador compartido de Telo.",
  );
  escribirSkill(
    "proyecto",
    "playwright",
    "---\nname: playwright\ndescription: Guía del repo\n---\n\nSobrescribe la guía global.",
  );
  escribirSkill(
    "proyecto",
    "validar-datos",
    "---\nname: validar-datos\ndescription: Guía específica\n---\n\nValida el formato de datos del repo.",
  );

  const global = resolverSkillsInvocadas(["playwright"], id);
  expect(global).toHaveLength(1);
  expect(global[0]).toMatchObject({ nombre: "playwright", ambito: "global" });
  expect(global[0]?.contenido).toContain("Usa el navegador compartido de Telo.");
  expect(global[0]?.contenido).not.toContain("Sobrescribe la guía global.");

  const especifica = resolverSkillsInvocadas(["validar-datos"], id);
  expect(especifica).toHaveLength(1);
  expect(especifica[0]).toMatchObject({ nombre: "validar-datos", ambito: "proyecto" });
});

test("activa skills globales por tipo de tarea en el prompt compartido por todos los runners", () => {
  for (const nombre of ["frontend-design", "playwright", "ponytail"]) {
    escribirSkill(
      "global",
      nombre,
      `---\nname: ${nombre}\ndescription: Instrucciones globales de prueba.\n---\n\nInstrucciones ${nombre}.`,
    );
  }

  // La resolución no depende del runner ni del modelo: el mismo prompt enriquecido se usa para Codex y OpenCode.
  const resultado = inyectarSkillsEnPrompt("Arregla el responsive del chat y verifica su aspecto en el navegador.");
  expect(resultado.skillsInvocadas).toEqual(["frontend-design", "playwright", "ponytail"]);
  expect(resultado.promptFinal).toContain("Instrucciones frontend-design.");
  expect(resultado.promptFinal).toContain("Instrucciones playwright.");
  expect(resultado.promptFinal).toContain("Instrucciones ponytail.");
});

test("activa la guía visual para crear imágenes e infografías, no para analizarlas", () => {
  const carpeta = join(homePrueba, ".config", "opencode", "skills", "image-design");
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, "SKILL.md"), "---\nname: image-design\ndescription: Guía de imágenes.\n---\n\nUsa texto vectorial legible.");

  const creacion = inyectarSkillsEnPrompt("Crea una infografía 3D con los datos de esta cronología.");
  expect(creacion.skillsInvocadas).toContain("image-design");
  expect(creacion.promptFinal).toContain("Usa texto vectorial legible.");

  const mejora = inyectarSkillsEnPrompt("Ayúdame a mejorar la creación de imágenes para el agente.");
  expect(mejora.skillsInvocadas).toContain("image-design");

  const analisis = inyectarSkillsEnPrompt("Analiza esta imagen adjunta y dime qué contiene.");
  expect(analisis.skillsInvocadas).not.toContain("image-design");
});
