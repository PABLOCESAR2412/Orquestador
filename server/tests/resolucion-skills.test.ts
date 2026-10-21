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
const { guardarSkill } = await import("../src/skills");
const carpetaProyecto = join(raiz, "proyectos", "resolucion-test");

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
  guardarSkill(
    { ambito: "proyecto", carpeta: carpetaProyecto },
    "playwright",
    "---\nname: playwright\ndescription: Pruebas end-to-end\n---\n\nUsa page.goto y espera selectores.",
  );

  const res = inyectarSkillsEnPrompt("Ejecuta $playwright en este proyecto", id);
  expect(res.skillsInvocadas).toEqual(["playwright"]);
  expect(res.promptFinal).toContain("[SKILLS ACTIVADAS POR EL USUARIO]");
  expect(res.promptFinal).toContain("Usa page.goto y espera selectores.");
  expect(res.promptFinal).toContain("Ejecuta $playwright en este proyecto");
});

test("activa skills globales por tipo de tarea en el prompt compartido por todos los runners", () => {
  for (const nombre of ["frontend-design", "playwright", "ponytail"]) {
    guardarSkill(
      { ambito: "global" },
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
