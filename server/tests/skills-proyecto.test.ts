import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../src/db");
const { guardarSkill, listarSkills, borrarSkill, importarSkill, buscarSkills } = await import(
  "../src/skills-proyecto"
);
const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  db.query("DELETE FROM projects WHERE id = ?").run("skills-test");
});
function proyecto() {
  db.query("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run("skills-test", "Skills");
  return "skills-test";
}
const URL_SKILL = "https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md";

test("guardar y reemplazar instrucciones pegadas, aisladas por proyecto y sin secretos", () => {
  const id = proyecto();
  guardarSkill(id, { name: "mi-skill", content: "Instrucción ghp_" + "abcdefghijklmnopqrstuvwx" });
  expect(listarSkills(id)[0].content).toBe("Instrucción ***");
  guardarSkill(id, { name: "mi-skill", content: "Nueva instrucción" });
  expect(listarSkills(id)).toEqual([
    { name: "mi-skill", content: "Nueva instrucción", source: null },
  ]);
  expect(listarSkills("otro")).toEqual([]);
  expect(borrarSkill("otro", "mi-skill")).toBe(false);
  expect(borrarSkill(id, "mi-skill")).toBe(true);
});

test("valida nombres, contenido y existencia del proyecto", () => {
  const id = proyecto();
  for (const name of ["", "../skill", "Mi Skill", "-skill", "skill-", "a".repeat(65)]) {
    expect(() => guardarSkill(id, { name, content: "texto" })).toThrow("invalid_skill_name");
  }
  for (const content of ["", " \n", "a".repeat(16_001)]) {
    expect(() => guardarSkill(id, { name: "skill", content })).toThrow("invalid_skill_content");
  }
  expect(() => guardarSkill("inexistente", { name: "skill", content: "texto" })).toThrow(
    "project_not_found",
  );
});

test("rechaza hosts, credenciales, puertos, redirecciones de ruta y query antes de fetch", async () => {
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    return new Response("texto");
  }) as typeof fetch;
  for (const url of [
    "http://github.com/a/b/blob/main/skills/pdf/SKILL.md",
    URL_SKILL + "?token=secreto",
    URL_SKILL + "#fragmento",
    URL_SKILL.replace("github.com", "github.com.evil.test"),
    URL_SKILL.replace("github.com", "user:pass@github.com"),
    URL_SKILL.replace("github.com", "github.com:443"),
    URL_SKILL.replace("skills/pdf", "skills/../pdf"),
    URL_SKILL.replace("skills/pdf", "skills/%2e%2e/pdf"),
    URL_SKILL.replace("SKILL.md", "install.sh"),
    "https://localhost/a/SKILL.md",
  ])
    await expect(importarSkill(proyecto(), url)).rejects.toThrow("invalid_skill_url");
  expect(llamadas).toBe(0);
});

test("importa Markdown de GitHub sin ejecutar scripts ni seguir redirects", async () => {
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe(
      "https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md",
    );
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response("# PDF\nInstrucciones");
  }) as typeof fetch;
  const skill = await importarSkill(proyecto(), URL_SKILL);
  expect(skill).toEqual({ name: "pdf", content: "# PDF\nInstrucciones", source: URL_SKILL });
  expect(listarSkills("skills-test")).toEqual([skill]);
});

test("limita la descarga y no guarda documentos truncados o fallidos", async () => {
  const id = proyecto();
  globalThis.fetch = (async () => new Response("a".repeat(16_001))) as typeof fetch;
  await expect(importarSkill(id, URL_SKILL)).rejects.toThrow("skill_too_large");
  globalThis.fetch = (async () => new Response("error", { status: 404 })) as typeof fetch;
  await expect(importarSkill(id, URL_SKILL)).rejects.toThrow("skill_download_failed");
  expect(listarSkills(id)).toEqual([]);
});

test("busca solo SKILL.md de los catálogos oficiales y reutiliza caché", async () => {
  let llamadas = 0;
  globalThis.fetch = (async (url) => {
    llamadas++;
    const openai = String(url).includes("openai/skills");
    const prefix = openai ? "skills/.curated/" : "skills/";
    return Response.json({
      tree: [
        { type: "blob", path: `${prefix}pdf/SKILL.md` },
        { type: "blob", path: `${prefix}pdf/install.sh` },
        { type: "blob", path: "otro/pdf/SKILL.md" },
      ],
    });
  }) as typeof fetch;
  expect((await buscarSkills("pdf")).map((s) => s.name)).toEqual(["pdf", "pdf"]);
  expect(await buscarSkills("ninguna")).toEqual([]);
  expect(llamadas).toBe(2);
});
