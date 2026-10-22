import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = mkdtempSync(join(tmpdir(), "telo-skills-proyecto-"));
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../src/db");
const { guardarSkill, listarSkills, borrarSkill, importarSkill, buscarSkills, parsearComandoSkill } = await import(
  "../src/skills-proyecto"
);
const { skillsRoute } = await import("../src/routes/skills");
const app = new Hono().route("/", skillsRoute);
const fetchOriginal = globalThis.fetch;
const carpetaProyecto = join(raiz, "proyectos", "skills-importador");
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  db.query("DELETE FROM projects WHERE id = ?").run("skills-test");
  rmSync(carpetaProyecto, { recursive: true, force: true });
});
afterAll(() => {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
});
function proyecto() {
  mkdirSync(carpetaProyecto, { recursive: true });
  db.query("INSERT OR IGNORE INTO projects (id, name, repo_path) VALUES (?, ?, ?)")
    .run("skills-test", "Skills", carpetaProyecto);
  return "skills-test";
}
const URL_SKILL = "https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md";

test("guardar y reemplazar instrucciones pegadas, aisladas por proyecto y sin secretos", () => {
  const id = proyecto();
  guardarSkill(id, { name: "mi-skill", content: "Instrucción ghp_" + "abcdefghijklmnopqrstuvwx" });
  expect(listarSkills(id)[0].content).toContain("Instrucción ***");
  const guardada = guardarSkill(id, { name: "mi-skill", content: "Nueva instrucción" });
  expect(guardada.content).toContain("name: mi-skill\ndescription:");
  expect(guardada.content).toContain("Nueva instrucción");
  expect(listarSkills(id)).toEqual([guardada]);
  const archivo = join(carpetaProyecto, ".opencode", "skills", "mi-skill", "SKILL.md");
  expect(readFileSync(archivo, "utf8")).toBe(guardada.content);
  expect(() => listarSkills("otro")).toThrow("project_not_found");
  expect(() => borrarSkill("otro", "mi-skill")).toThrow("project_not_found");
  expect(borrarSkill(id, "mi-skill")).toBe(true);
  expect(existsSync(archivo)).toBe(false);
  expect(borrarSkill(id, "mi-skill")).toBe(false);
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
  db.query("UPDATE projects SET repo_path = NULL WHERE id = ?").run(id);
  expect(() => guardarSkill(id, { name: "skill", content: "texto" })).toThrow("project_not_found");
});

test("conserva el frontmatter y exige nombre y descripción válidos", () => {
  const id = proyecto();
  const content = "---\nname: mi-skill\ndescription: Mi instrucción\nlicense: MIT\n---\nContenido";
  expect(guardarSkill(id, { name: "mi-skill", content }).content).toBe(content);
  expect(() => guardarSkill(id, { name: "otra", content })).toThrow("skill_nombre_no_coincide");
  expect(() => guardarSkill(id, { name: "mi-skill", content: "---\nname: mi-skill\n---\nTexto" }))
    .toThrow("skill_sin_descripcion");
});

test("rechaza hosts, credenciales, puertos, redirecciones de ruta y query antes de fetch", async () => {
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    return new Response("texto");
  }) as unknown as typeof fetch;
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
  expect(skill).toMatchObject({ name: "pdf", source: URL_SKILL });
  expect(skill.content).toContain("# PDF\nInstrucciones");
  expect(skill.content).toContain(`source: ${URL_SKILL}`);
  expect(listarSkills("skills-test")).toEqual([skill]);
});

test("limita la descarga y no guarda documentos truncados o fallidos", async () => {
  const id = proyecto();
  globalThis.fetch = (async () => new Response("a".repeat(16_001))) as unknown as typeof fetch;
  await expect(importarSkill(id, URL_SKILL)).rejects.toThrow("skill_too_large");
  globalThis.fetch = (async () => new Response("error", { status: 404 })) as unknown as typeof fetch;
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

test("interpreta el comando oficial sin ejecutarlo y rechaza argumentos adicionales", () => {
  expect(parsearComandoSkill("npx skills add openai/skills --skill playwright")).toEqual({
    owner: "openai",
    repo: "skills",
    name: "playwright",
  });
  expect(parsearComandoSkill("$ bunx skills add https://github.com/vercel-labs/agent-skills.git --skill frontend-design"))
    .toEqual({ owner: "vercel-labs", repo: "agent-skills", name: "frontend-design" });
  expect(() => parsearComandoSkill("npx skills add openai/skills --skill playwright; rm -rf ."))
    .toThrow("invalid_skill_command");
  expect(() => parsearComandoSkill("npx skills add attacker.example/a --skill playwright"))
    .toThrow("invalid_skill_command");
});

test("instala solo SKILL.md desde el repositorio indicado por el comando", async () => {
  const id = proyecto();
  const urls: string[] = [];
  globalThis.fetch = (async (url) => {
    const destino = String(url);
    urls.push(destino);
    if (destino.endsWith("/repos/vercel-labs/agent-skills")) {
      return Response.json({ default_branch: "main" });
    }
    if (destino.includes("/git/trees/main?recursive=1")) {
      return Response.json({ tree: [
        { type: "blob", path: "skills/frontend-design/SKILL.md" },
        { type: "blob", path: "skills/frontend-design/install.sh" },
      ] });
    }
    expect(destino).toBe("https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/frontend-design/SKILL.md");
    return new Response("---\nname: frontend-design\ndescription: Diseña interfaces\n---\n\n# Diseño");
  }) as typeof fetch;

  const respuesta = await app.request("/projects/skills-test/skills/instalar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comando: "npx skills add vercel-labs/agent-skills --skill frontend-design" }),
  });
  expect(respuesta.status).toBe(201);
  const skill = await respuesta.json() as { name: string; content: string; source: string };
  expect(skill.name).toBe("frontend-design");
  expect(skill.content).toContain("source: https://github.com/vercel-labs/agent-skills/blob/main/skills/frontend-design/SKILL.md");
  expect(urls).toHaveLength(3);
  expect(listarSkills(id)[0]?.name).toBe("frontend-design");
});

test("instala skills conocidas y desempata rutas múltiples (playwright, caveman, impeccable)", async () => {
  const id = proyecto();
  expect(parsearComandoSkill("playwright")).toEqual({ owner: "openai", repo: "skills", name: "playwright" });
  expect(parsearComandoSkill("npx skills add caveman")).toEqual({ owner: "JuliusBrussee", repo: "caveman", name: "caveman" });
  expect(parsearComandoSkill("npx skills add pbakaus/impeccable")).toEqual({ owner: "pbakaus", repo: "impeccable", name: "impeccable" });
  expect(parsearComandoSkill("context7")).toEqual({ owner: "upstash", repo: "context7", name: "context7-mcp" });

  globalThis.fetch = (async (url) => {
    const destino = String(url);
    if (destino.endsWith("/repos/pbakaus/impeccable")) {
      return Response.json({ default_branch: "main" });
    }
    if (destino.includes("/git/trees/main?recursive=1")) {
      // Múltiples rutas como en el repo real de impeccable
      return Response.json({
        tree: [
          { type: "blob", path: "tests/oracle/workspaces/ctx-pin/.claude/skills/impeccable/SKILL.md" },
          { type: "blob", path: ".agent/skills/impeccable/SKILL.md" },
          { type: "blob", path: ".opencode/skills/impeccable/SKILL.md" },
          { type: "blob", path: "plugin/skills/impeccable/SKILL.md" },
        ],
      });
    }
    if (destino.includes("/.opencode/skills/impeccable/SKILL.md")) {
      return new Response("---\nname: impeccable\ndescription: Design taste\n---\n\n# Impeccable rules");
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const respuesta = await app.request("/projects/skills-test/skills/instalar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comando: "npx skills add pbakaus/impeccable" }),
  });
  expect(respuesta.status).toBe(201);
  const data = (await respuesta.json()) as { name: string; content: string };
  expect(data.name).toBe("impeccable");
  expect(data.content).toContain("# Impeccable rules");

  // Verifica que se guardó en .opencode/skills/ y también sincronizó en skills/ visible
  const rutaOpencode = join(carpetaProyecto, ".opencode", "skills", "impeccable", "SKILL.md");
  const rutaVisible = join(carpetaProyecto, "skills", "impeccable", "SKILL.md");
  expect(existsSync(rutaOpencode)).toBe(true);
  expect(existsSync(rutaVisible)).toBe(true);
});

test("usa fallback global o directo si la API de GitHub devuelve rate-limit o 502", async () => {
  const id = proyecto();
  // Simular que GitHub API falla con 403 Rate Limit en /repos/
  globalThis.fetch = (async (url) => {
    const destino = String(url);
    if (destino.includes("api.github.com")) {
      return new Response("API rate limit exceeded", { status: 403 });
    }
    // Pero el CDN raw funciona
    if (destino.endsWith("/plugins/agent-plugins/context7/skills/context7-mcp/SKILL.md")) {
      return new Response("---\nname: context7-mcp\ndescription: Frameworks docs\n---\n\nDocs actualizadas");
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const respuesta = await app.request("/projects/skills-test/skills/instalar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comando: "context7" }),
  });
  expect(respuesta.status).toBe(201);
  const data = (await respuesta.json()) as { name: string; content: string };
  expect(data.name).toBe("context7-mcp");
  expect(data.content).toContain("Docs actualizadas");
});

