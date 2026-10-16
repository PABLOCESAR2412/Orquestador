import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { detectarMencionesSkills, inyectarSkillsEnPrompt, resolverSkillsInvocadas } from "../src/resolucion-skills";
import { guardarSkill } from "../src/skills";

const raiz = join(import.meta.dir, ".test-data-resolucion-skills");
rmSync(raiz, { recursive: true, force: true });
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const carpetaProyecto = join(raiz, "proyectos", "resolucion-test");

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

test("detectarMencionesSkills detecta $ y / correctamente", () => {
  const texto = "Quiero que uses $playwright y $caveman para revisar el flujo, o también /impeccable";
  const menciones = detectarMencionesSkills(texto);
  expect(menciones).toContain("playwright");
  expect(menciones).toContain("caveman");
  expect(menciones).toContain("impeccable");
  expect(menciones).toHaveLength(3);
});

test("detectarMencionesSkills ignora símbolos monetarios o rutas normales", () => {
  expect(detectarMencionesSkills("El costo es $50 o $100 dólares")).toEqual([]);
  expect(detectarMencionesSkills("Visita https://ejemplo.com/ruta/archivo")).toEqual([]);
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
