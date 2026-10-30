import { expect, test } from "bun:test";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-skills-"));

// config se inicializa al importar: se apunta a un temporal para no tocar la base real.
process.env.DATA_DIR = join(raiz, "datos");
const { copiarCarpetaSana, prepararCopia } = await import("../src/workspace");
const { db } = await import("../src/db");
const { gitOk } = await import("../src/git");

function enlazarCarpeta(origen: string, destino: string) {
  symlinkSync(origen, destino, process.platform === "win32" ? "junction" : "dir");
}

test("la copia de skills se salta los enlaces simbólicos y copia lo demás", () => {
  const origen = join(raiz, "skills");
  mkdirSync(origen, { recursive: true });
  mkdirSync(join(origen, "sub"), { recursive: true });
  writeFileSync(join(origen, "util.md"), "hola");
  writeFileSync(join(origen, "sub", "interna.txt"), "dentro");

  // Los enlaces nacen tolerantes: en Windows pueden fallar sin modo desarrollador, y el test
  // solo afirma lo relativo a enlaces si realmente se pudieron crear.
  let enlaceArchivo = false;
  try {
    symlinkSync(join(tmpdir(), "fuera.txt"), join(origen, "atajo.txt"));
    enlaceArchivo = true;
  } catch {
    // Sin permiso para enlaces: no hay nada que afirmar sobre ellos.
  }
  let enlaceCarpeta = false;
  try {
    symlinkSync(join(raiz, "otra"), join(origen, "sub-link"), "dir");
    enlaceCarpeta = true;
  } catch {
    // idem
  }

  const destino = join(raiz, "clon", "skills");
  copiarCarpetaSana(origen, destino);

  expect(readFileSync(join(destino, "util.md"), "utf8")).toBe("hola");
  expect(readFileSync(join(destino, "sub", "interna.txt"), "utf8")).toBe("dentro");
  if (enlaceArchivo) {
    expect(() => lstatSync(join(destino, "atajo.txt"))).toThrow();
  }
  if (enlaceCarpeta) {
    expect(() => lstatSync(join(destino, "sub-link"))).toThrow();
  }
});

for (const tipo of ["raiz", "ancestro", "subcarpeta"] as const) {
  test(`la copia de skills rechaza un enlace en el destino: ${tipo}`, () => {
    const caso = mkdtempSync(join(raiz, "destino-"));
    const origen = join(caso, "origen");
    const fuera = join(caso, "fuera");
    const destino = join(caso, "clon", "skills");
    mkdirSync(join(origen, "sub"), { recursive: true });
    mkdirSync(fuera);
    writeFileSync(join(origen, "sub", "SKILL.md"), "contenido de la skill");
    writeFileSync(join(fuera, "SKILL.md"), "conservar");
    if (tipo === "ancestro") enlazarCarpeta(fuera, join(caso, "clon"));
    else {
      mkdirSync(join(caso, "clon"));
      if (tipo === "raiz") enlazarCarpeta(fuera, destino);
      else {
        mkdirSync(destino);
        enlazarCarpeta(fuera, join(destino, "sub"));
      }
    }

    expect(() => copiarCarpetaSana(origen, destino)).toThrow();
    expect(readFileSync(join(fuera, "SKILL.md"), "utf8")).toBe("conservar");
    expect(existsSync(join(fuera, "sub"))).toBe(false);
    expect(existsSync(join(fuera, "skills"))).toBe(false);
  });
}

test("la copia de skills no sobrescribe el destino externo de un enlace duro", () => {
  const caso = mkdtempSync(join(raiz, "archivo-destino-"));
  const origen = join(caso, "origen");
  const destino = join(caso, "destino");
  mkdirSync(origen);
  mkdirSync(destino);
  const fuera = join(caso, "fuera.md");
  writeFileSync(fuera, "conservar");
  writeFileSync(join(origen, "SKILL.md"), "contenido nuevo");
  linkSync(fuera, join(destino, "SKILL.md"));

  copiarCarpetaSana(origen, destino);

  expect(readFileSync(fuera, "utf8")).toBe("conservar");
  expect(readFileSync(join(destino, "SKILL.md"), "utf8")).toBe("contenido nuevo");
});

test("al reanudar, .opencode enlazado no recibe escrituras fuera del clon", async () => {
  const caso = mkdtempSync(join(raiz, "reanudar-"));
  const proyecto = join(caso, "proyecto");
  const fuera = join(caso, "fuera");
  mkdirSync(proyecto);
  mkdirSync(join(fuera, "skills", "demo"), { recursive: true });
  writeFileSync(join(fuera, "skills", "demo", "SKILL.md"), "conservar");
  await gitOk(["init", "-b", "main"], { cwd: proyecto });
  await gitOk(["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Base"], { cwd: proyecto });
  const skill = join(proyecto, ".opencode", "skills", "demo");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "contenido de la skill");
  const id = crypto.randomUUID();
  db.query("INSERT INTO tasks(id,title,prompt,model,status) VALUES (?,'Skills','Prueba','prueba','queued')").run(id);
  try {
    const copia = await prepararCopia(id, proyecto, null);
    const opencode = join(copia.cwd, ".opencode");
    rmSync(opencode, { recursive: true, force: true });
    enlazarCarpeta(fuera, opencode);

    await prepararCopia(id, proyecto, null);

    expect(existsSync(join(fuera, ".gitignore"))).toBe(false);
    expect(readFileSync(join(fuera, "skills", "demo", "SKILL.md"), "utf8")).toBe("conservar");
    expect(lstatSync(opencode).isSymbolicLink()).toBe(true);
  } finally {
    db.query("DELETE FROM tasks WHERE id=?").run(id);
  }
});
