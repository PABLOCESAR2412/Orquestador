import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Skills: ámbito global (HOME/.config/opencode/skills) y por proyecto (carpeta/.opencode/skills).
// Pruebas de rutas acotadas, enlaces, escritura atómica y secretos. HOME y DATA_DIR son temporales.
const RAIZ = mkdtempSync(join(tmpdir(), `telo-skills-${randomUUID()}-`));
const HOME_PRUEBA = join(RAIZ, "home");
const FUERA = join(RAIZ, "fuera");
mkdirSync(HOME_PRUEBA, { recursive: true });
mkdirSync(FUERA, { recursive: true });
process.env.HOME = HOME_PRUEBA;
process.env.DATA_DIR = join(RAIZ, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ, "proyectos");

const { db } = await import("../src/db");
const { skillsRoute } = await import("../src/routes/skills");
const { guardarSkill, listarSkills, leerFrontmatter, prepararCarpetaGlobal, SKILL_GAUNTLET_CONTENIDO } = await import("../src/skills");

const GLOBAL = join(HOME_PRUEBA, ".config", "opencode", "skills");
const PROYECTO = join(RAIZ, "proyecto-a");
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function skillTexto(nombre: string, descripcion = "Úsala cuando la persona pida un informe.") {
  return `---\nname: ${nombre}\ndescription: ${descripcion}\n---\n\n# ${nombre}\n\nPasos.\n`;
}

async function put(ruta: string, contenido: string) {
  return skillsRoute.request(ruta, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contenido }),
  });
}

beforeAll(() => {
  mkdirSync(PROYECTO, { recursive: true });
  db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run("p-skills", "Proyecto A", PROYECTO);
});

afterAll(() => {
  db.close();
  rmSync(RAIZ, { recursive: true, force: true });
});

describe("frontmatter", () => {
  test("lee nombre, descripción y bloques de descripción plegada", () => {
    const campos = leerFrontmatter("---\nname: a-b\ndescription: >\n  primera\n  segunda\n---\nCuerpo");
    expect(campos?.name).toBe("a-b");
    expect(campos?.description).toBe("primera segunda");
    expect(leerFrontmatter("# sin cabecera")).toBeNull();
  });
});

describe("skills globales", () => {
  test("instala las skills comunes sin reemplazar Gauntlet personalizado", () => {
    guardarSkill({ ambito: "global" }, "gauntlet", SKILL_GAUNTLET_CONTENIDO + "\nPersonalización conservada.\n");
    const frontend = join(GLOBAL, "frontend-design");
    mkdirSync(frontend, { recursive: true });
    writeFileSync(join(frontend, "SKILL.md"), "Skill existente con formato pendiente de corregir.\n");
    prepararCarpetaGlobal();

    expect(readFileSync(join(GLOBAL, "gauntlet", "SKILL.md"), "utf8")).toContain("Personalización conservada.");
    expect(readFileSync(join(frontend, "SKILL.md"), "utf8")).toBe("Skill existente con formato pendiente de corregir.\n");
    for (const nombre of ["playwright", "ponytail", "image-design", "motion-design", "skill-authoring"]) {
      expect(readFileSync(join(GLOBAL, nombre, "SKILL.md"), "utf8")).toContain(`name: ${nombre}`);
    }
    for (const nombre of ["context7-mcp", "hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use", "using-superpowers", "strategic-compact"]) {
      expect(readFileSync(join(GLOBAL, nombre, "SKILL.md"), "utf8")).toContain(`name: ${nombre}`);
    }
    expect(readFileSync(join(GLOBAL, "motion-design", "SKILL.md"), "utf8")).toContain("No dibujes sobre el fotograma anterior");
    expect(readFileSync(join(GLOBAL, "skill-authoring", "SKILL.md"), "utf8")).toContain("no presentes ejemplos hipotéticos como pruebas ejecutadas");
    expect(() => readFileSync(join(GLOBAL, "context7", "SKILL.md"), "utf8")).toThrow();
  });

  test("conserva una skill antigua que el usuario haya personalizado", () => {
    const legado = join(GLOBAL, "context7");
    mkdirSync(legado, { recursive: true });
    writeFileSync(join(legado, "SKILL.md"), [
      "---",
      "name: context7",
      "description: Consulta documentación actual y ejemplos de bibliotecas, frameworks, SDK, APIs y herramientas de línea de comandos al implementarlos, configurarlos, migrarlos o depurarlos.",
      "---",
      "",
      "# Adaptación propia",
      "",
      "Este contenido lo modificó la persona.",
      "",
    ].join("\n"));

    prepararCarpetaGlobal();

    expect(readFileSync(join(legado, "SKILL.md"), "utf8")).toContain("Este contenido lo modificó la persona.");
  });

  test("guarda una skill válida y la lista con su descripción", async () => {
    const res = await put("/skills/informe-semanal", skillTexto("informe-semanal"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { creada: boolean }).creada).toBe(true);
    expect(readFileSync(join(GLOBAL, "informe-semanal", "SKILL.md"), "utf8")).toContain("name: informe-semanal");

    const lista = await skillsRoute.request("/skills");
    const cuerpo = (await lista.json()) as { skills: { nombre: string; valida: boolean; descripcion: string }[] };
    const fila = cuerpo.skills.find((s) => s.nombre === "informe-semanal");
    expect(fila?.valida).toBe(true);
    expect(fila?.descripcion).toBe("Úsala cuando la persona pida un informe.");
  });

  test("rechaza nombres que no cumplen el patrón de OpenCode", async () => {
    for (const nombre of ["Mayusculas", "con_guion_bajo", "doble--guion", "-inicio", "../fuera", "a".repeat(65)]) {
      const res = await skillsRoute.request(`/skills/${encodeURIComponent(nombre)}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("skill_nombre_invalido");
    }
  });

  test("rechaza contenido que OpenCode no cargaría", async () => {
    const casos: [string, string][] = [
      ["sin-cabecera", "# Solo texto"],
      ["nombre-distinto", skillTexto("otro-nombre")],
      ["sin-descripcion", "---\nname: sin-descripcion\n---\nCuerpo"],
      ["descripcion-larga", skillTexto("descripcion-larga", "x".repeat(1025))],
    ];
    for (const [nombre, texto] of casos) {
      const res = await put(`/skills/${nombre}`, texto);
      expect(res.status).toBe(400);
    }
    expect(existsSync(join(GLOBAL, "sin-cabecera"))).toBe(false);
  });

  test("rechaza un archivo de más de 64 KB", async () => {
    const grande = skillTexto("muy-grande") + "x".repeat(64 * 1024);
    const res = await put("/skills/muy-grande", grande);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("skill_demasiado_grande");
  });

  test("no guarda un secreto conocido: rechaza en vez de redactar", async () => {
    const res = await put("/skills/con-token", skillTexto("con-token") + `\nToken: ${TOKEN}\n`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("skill_contiene_secreto");
    expect(existsSync(join(GLOBAL, "con-token"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("no sigue enlaces: un SKILL.md que apunta fuera no se lee", async () => {
    writeFileSync(join(FUERA, "secreto.md"), skillTexto("enlazada"));
    mkdirSync(join(GLOBAL, "enlazada"), { recursive: true });
    symlinkSync(join(FUERA, "secreto.md"), join(GLOBAL, "enlazada", "SKILL.md"));
    const res = await skillsRoute.request("/skills/enlazada");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("skill_ruta_no_permitida");
    const lista = (await (await skillsRoute.request("/skills")).json()) as { skills: { nombre: string }[] };
    expect(lista.skills.some((s) => s.nombre === "enlazada")).toBe(false);
  });

  test.skipIf(process.platform === "win32")("no escribe a través de una carpeta enlazada", async () => {
    symlinkSync(FUERA, join(GLOBAL, "salida"));
    const res = await put("/skills/salida", skillTexto("salida"));
    expect(res.status).toBe(400);
    expect(readdirSync(FUERA).some((n) => n.startsWith("SKILL"))).toBe(false);
  });

  test("si el destino no se puede reemplazar, no queda archivo temporal ni a medias", async () => {
    mkdirSync(join(GLOBAL, "bloqueada", "SKILL.md"), { recursive: true });
    writeFileSync(join(GLOBAL, "bloqueada", "SKILL.md", "aguja.txt"), "x");
    const res = await put("/skills/bloqueada", skillTexto("bloqueada"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("skill_ruta_no_permitida");
    const contenido = readdirSync(join(GLOBAL, "bloqueada"));
    expect(contenido.some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  test("borrar: quita la skill; con otros archivos responde 409 y no toca nada", async () => {
    await put("/skills/para-borrar", skillTexto("para-borrar"));
    writeFileSync(join(GLOBAL, "para-borrar", "notas.txt"), "a mano");
    const conflicto = await skillsRoute.request("/skills/para-borrar", { method: "DELETE" });
    expect(conflicto.status).toBe(409);
    expect(existsSync(join(GLOBAL, "para-borrar", "SKILL.md"))).toBe(true);

    await put("/skills/limpia", skillTexto("limpia"));
    const res = await skillsRoute.request("/skills/limpia", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(existsSync(join(GLOBAL, "limpia"))).toBe(false);
  });

  test("una skill sin frontmatter aparece en la lista como no válida", () => {
    mkdirSync(join(GLOBAL, "rota"), { recursive: true });
    writeFileSync(join(GLOBAL, "rota", "SKILL.md"), "sin cabecera");
    const fila = listarSkills({ ambito: "global" }).find((s) => s.nombre === "rota");
    expect(fila?.valida).toBe(false);
  });
});

describe("skills por proyecto", () => {
  test("se guardan en la carpeta del proyecto, en .opencode/skills", async () => {
    const res = await put("/projects/p-skills/skills/guia-proyecto", skillTexto("guia-proyecto"));
    expect(res.status).toBe(200);
    expect(existsSync(join(PROYECTO, ".opencode", "skills", "guia-proyecto", "SKILL.md"))).toBe(true);
    expect(existsSync(join(PROYECTO, ".agents", "skills", "guia-proyecto", "SKILL.md"))).toBe(false);
    const lista = (await (await skillsRoute.request("/projects/p-skills/skills")).json()) as { skills: { nombre: string }[] };
    expect(lista.skills.map((s) => s.nombre)).toContain("guia-proyecto");
  });

  test("proyecto inexistente responde 404", async () => {
    const res = await skillsRoute.request("/projects/no-existe/skills");
    expect(res.status).toBe(404);
  });

  test.skipIf(process.platform === "win32")("si .opencode es un enlace fuera del proyecto, no escribe fuera", async () => {
    const proyectoB = join(RAIZ, "proyecto-b");
    mkdirSync(proyectoB, { recursive: true });
    symlinkSync(FUERA, join(proyectoB, ".opencode"));
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run("p-enlace", "Enlace", proyectoB);
    const res = await put("/projects/p-enlace/skills/escapa", skillTexto("escapa"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("skill_ruta_no_permitida");
    expect(existsSync(join(FUERA, "skills"))).toBe(false);
  });
});
