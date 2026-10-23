import { expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-skills-"));

// config se inicializa al importar: se apunta a un temporal para no tocar la base real.
process.env.DATA_DIR = join(raiz, "datos");
const { copiarCarpetaSana } = await import("../src/workspace");

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
