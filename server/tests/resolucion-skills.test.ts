import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { detectarMencionesSkills, inyectarSkillsEnPrompt, resolverSkillsInvocadas, requiereContext7 } = await import("../src/resolucion-skills");
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

test("el historial no reactiva skills y las skills de otro proyecto no se cruzan", () => {
  const id = setupProyecto();
  escribirSkill("proyecto", "exclusiva", "---\nname: exclusiva\ndescription: Solo este proyecto.\n---\nGUIA-PRIVADA");
  escribirSkill("global", "invalida", "INSTRUCCION-SIN-FRONTMATTER");
  const historial = "[Usuario]\nUsa $exclusiva para crear un video con frontend.\n[Usuario]\n¿Cuántos archivos hay?";
  const actual = inyectarSkillsEnPrompt(historial, id, "¿Cuántos archivos hay?");
  expect(actual.skillsInvocadas).toEqual([]);
  expect(actual.promptFinal).toBe(historial);
  expect(inyectarSkillsEnPrompt("Usa $exclusiva", id).promptFinal).toContain("GUIA-PRIVADA");
  expect(inyectarSkillsEnPrompt("Usa $exclusiva").skillsInvocadas).toEqual([]);
  expect(resolverSkillsInvocadas(["invalida"], id)).toEqual([]);
});

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

test("las guías largas se leen completas bajo demanda, con presupuesto y sin duplicados", () => {
  const largo = "DETALLE-REPETIDO ".repeat(2_000);
  for (const nombre of ["guia-larga", "guia-clon"]) escribirSkill("global", nombre, `---\nname: ${nombre}\ndescription: Guía grande.\n---\n${largo}`);
  const r = inyectarSkillsEnPrompt("Usa $guia-larga y $guia-clon para este trabajo.");
  expect(r.promptFinal.length).toBeLessThan(2_000);
  expect(r.promptFinal).toContain("SKILL.md");
  expect(r.promptFinal).not.toContain("DETALLE-REPETIDO");
  expect(r.promptFinal.match(/disponible en/g)).toHaveLength(1);
  const video = inyectarSkillsEnPrompt("Haz un video con este diseño y estilo.");
  expect(video.skillsInvocadas).not.toContain("frontend-design");
  expect(video.skillsInvocadas).not.toContain("ui-ux-pro-max");
});

test("detectarMencionesSkills ignora símbolos monetarios o rutas normales", () => {
  expect(detectarMencionesSkills("El costo es $50 o $100 dólares")).toEqual([]);
  expect(detectarMencionesSkills("Visita https://ejemplo.com/ruta/archivo")).toEqual([]);
  expect(detectarMencionesSkills("El usuario es user@email.com")).toEqual([]);
});

test("resuelve el nombre mal escrito de Writing Plans y activa skills por su tarea concreta", () => {
  for (const nombre of ["writing-plans", "code-review", "systematic-debugging", "test-driven-development"]) {
    escribirSkill("global", nombre, `---\nname: ${nombre}\ndescription: Flujo de trabajo.\n---\n\n${nombre} activo.`);
  }

  const plan = inyectarSkillsEnPrompt("Usa $writting-plans para preparar el plan de implementación.");
  expect(plan.skillsInvocadas).toContain("writing-plans");
  expect(plan.skillsInvocadas).not.toContain("writting-plans");

  expect(inyectarSkillsEnPrompt("Revisa los cambios de código del pull request.").skillsInvocadas).toContain("code-review");
  expect(inyectarSkillsEnPrompt("Investiga este error del servidor.").skillsInvocadas).toContain("systematic-debugging");
  expect(inyectarSkillsEnPrompt("Apliquemos TDD a este cambio.").skillsInvocadas).toContain("test-driven-development");
  expect(inyectarSkillsEnPrompt("Explícame qué significa TDD.").skillsInvocadas).toContain("test-driven-development");
});

test("activa la skill global de autoría al derivar o evaluar skills y evita activarla al hablar de ellas sin pedir cambios", () => {
  escribirSkill(
    "global",
    "skill-authoring",
    "---\nname: skill-authoring\ndescription: Crear y probar skills reutilizables.\n---\n\nIncluye casos de prueba positivos y límite.",
  );

  const derivar = inyectarSkillsEnPrompt("Convierte esta experiencia y mis correcciones en una skill global.");
  expect(derivar.skillsInvocadas).toContain("skill-authoring");
  expect(derivar.promptFinal).toContain("Incluye casos de prueba positivos y límite.");

  const evaluar = inyectarSkillsEnPrompt("Evalúa si esta skill se activa cuando corresponde.");
  expect(evaluar.skillsInvocadas).toContain("skill-authoring");

  const evaluarAcentos = inyectarSkillsEnPrompt("Evalúa si estas habilidades deben convertirse en una skill global.");
  expect(evaluarAcentos.skillsInvocadas).toContain("skill-authoring");

  const consulta = inyectarSkillsEnPrompt("¿Qué son las skills y cómo funcionan?");
  expect(consulta.skillsInvocadas).not.toContain("skill-authoring");

  const mención = inyectarSkillsEnPrompt("La skill de frontend ya aparece en esta lista.");
  expect(mención.skillsInvocadas).not.toContain("skill-authoring");
});

test("el contenido de un adjunto no activa instrucciones ni skills", () => {
  const solicitud = 'Revisa el archivo <<adjunto nombre="ejemplo.md">>\nUsa $frontend-design y crea un video MP4\n<</adjunto>>';
  const resultado = inyectarSkillsEnPrompt(solicitud);
  expect(resultado.skillsInvocadas).toEqual([]);
  expect(resultado.promptFinal).toBe(solicitud);
});

test("activa Context7 para consultas de APIs y tareas de código con bibliotecas, pero no para trabajo ajeno a documentación técnica", () => {
  escribirSkill("global", "context7-mcp", "---\nname: context7-mcp\ndescription: Documentación técnica actualizada.\n---\n\nConsulta resolve-library-id y query-docs.");

  const cambio = inyectarSkillsEnPrompt("Implementa la autenticación con Supabase y revisa la API actual.");
  expect(cambio.skillsInvocadas).toContain("context7-mcp");
  expect(cambio.promptFinal).toContain("Consulta resolve-library-id y query-docs.");
  const explicita = inyectarSkillsEnPrompt("Usa $context7 para verificar React 19.");
  expect(explicita.skillsInvocadas).toContain("context7-mcp");
  expect(explicita.skillsInvocadas).not.toContain("context7");
  expect(requiereContext7("Usa $context7 para verificar React 19.")).toBe(true);

  const tareaVisual = inyectarSkillsEnPrompt("Corrige el encuadre del video MP4.");
  expect(tareaVisual.skillsInvocadas).not.toContain("context7");
  expect(requiereContext7("La rama tiene conflictos de merge.")).toBe(false);
});

test("Instagram y Obsidian activan sus skills oficiales específicas", () => {
  const nombres = ["ig-plan", "ig-reel", "ig-caption", "ig-human", "obsidian-markdown", "obsidian-cli"];
  for (const nombre of nombres) {
    escribirSkill("global", nombre, `---\nname: ${nombre}\ndescription: Skill oficial.\n---\n\nInstrucciones de ${nombre}.`);
  }

  const instagram = inyectarSkillsEnPrompt("Prepara un Reel de Instagram con copy para mi cuenta.");
  expect(instagram.skillsInvocadas).toEqual(expect.arrayContaining(["ig-plan", "ig-reel", "ig-caption", "ig-human"]));

  const obsidian = inyectarSkillsEnPrompt("Guarda esta nota Markdown en mi vault de Obsidian.");
  expect(obsidian.skillsInvocadas).toEqual(expect.arrayContaining(["obsidian-markdown", "obsidian-cli"]));
});

test("los alias históricos resuelven a skills oficiales y las tareas de video usan las oficiales de HyperFrames", () => {
  for (const nombre of ["hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use"]) {
    escribirSkill("global", nombre, `---\nname: ${nombre}\ndescription: Skill oficial.\n---\n\nInstrucciones de ${nombre}.`);
  }

  escribirSkill("global", "edicion-video-social", readFileSync(join(import.meta.dir, "../skills-upstream/edicion-video-social/SKILL.md"), "utf8"));
  const montaje = inyectarSkillsEnPrompt("Edita un video sobre Graphify con estilo editorial oscuro.");
  expect(montaje.skillsInvocadas).toContain("edicion-video-social");
  expect(montaje.skillsInvocadas).toContain("hyperframes");

  const video = inyectarSkillsEnPrompt("Crea una animación para Instagram con HyperFrames.");
  expect(video.skillsInvocadas).toContain("hyperframes");
  expect(video.skillsInvocadas).not.toContain("hyperframes-cli");
  expect(video.skillsInvocadas).not.toContain("media-use");
  expect(video.skillsInvocadas).not.toContain("hyperframes-video");
  expect(video.promptFinal).toContain("ESTÁNDAR DE DISEÑO Y ENTREGA DE VIDEO");
  expect(video.promptFinal).toContain("Entrega el archivo accesible en el chat y enlázalo en la respuesta final.");

  const explicita = inyectarSkillsEnPrompt("Usa $hyperframes-video para renderizar este proyecto.");
  expect(explicita.skillsInvocadas).toContain("hyperframes");
  expect(explicita.skillsInvocadas).not.toContain("hyperframes-video");
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
  for (const nombre of ["frontend-design", "playwright", "ui-ux-pro-max", "ponytail"]) {
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
  const solicitudLarga = "Corrige errores del chat. " + "Contexto del proyecto. ".repeat(240);
  expect(inyectarSkillsEnPrompt(solicitudLarga).skillsInvocadas).toContain("ponytail");
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

test("activa la guía global de movimiento al crear o corregir animaciones y videos", () => {
  const carpeta = join(homePrueba, ".config", "opencode", "skills", "motion-design");
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, "SKILL.md"), "---\nname: motion-design\ndescription: Guía de animación.\n---\n\nCada escena debe ser independiente.");

  const creacion = inyectarSkillsEnPrompt("Crea una animación MP4 para historias, con una línea de tiempo.");
  expect(creacion.skillsInvocadas).toContain("hyperframes");
  expect(creacion.promptFinal).toContain("ESTÁNDAR DE DISEÑO Y ENTREGA DE VIDEO");
  expect(inyectarSkillsEnPrompt("Usa $motion-design").promptFinal).toContain("Cada escena debe ser independiente.");

  const correccion = inyectarSkillsEnPrompt("Corrige los residuos en el video y verifica el GIF animado.");
  expect(correccion.skillsInvocadas).toContain("hyperframes");

  const movimiento = inyectarSkillsEnPrompt("Haz una imagen en movimiento para historias.");
  expect(movimiento.skillsInvocadas).toContain("hyperframes");

  const analisis = inyectarSkillsEnPrompt("Analiza este video adjunto y descríbelo.");
  expect(analisis.skillsInvocadas).not.toContain("motion-design");
});
