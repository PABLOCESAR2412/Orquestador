import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base y carpeta de proyectos temporales, igual que el resto de pruebas: nunca se toca server/data.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { extraerMemoria, quitarBloqueMemoria, conMemoria, componerInstrucciones, MAX_MEMORIA, INSTRUCCION_APRENDER } =
  await import("../src/memoria");

describe("memoria: extraer el bloque del agente", () => {
  test("toma el último bloque y quita los espacios", () => {
    const texto = "hola <telo-memoria>viejo</telo-memoria> fin <telo-memoria>\n nuevo \n</telo-memoria>";
    expect(extraerMemoria(texto)).toBe("nuevo");
  });

  test("sin bloque, o con un bloque vacío, no hay memoria", () => {
    expect(extraerMemoria("respuesta sin nada")).toBeNull();
    expect(extraerMemoria("<telo-memoria>   </telo-memoria>")).toBeNull();
  });

  test("un bloque sin cerrar no cuenta", () => {
    expect(extraerMemoria("<telo-memoria>a medias")).toBeNull();
  });

  test("recorta la memoria al máximo", () => {
    const largo = "x".repeat(MAX_MEMORIA + 500);
    expect(extraerMemoria(`<telo-memoria>${largo}</telo-memoria>`)?.length).toBe(MAX_MEMORIA);
  });
});

describe("memoria: quitar y componer el prompt", () => {
  test("quitarBloqueMemoria deja solo la respuesta", () => {
    expect(quitarBloqueMemoria("Listo.\n\n<telo-memoria>datos</telo-memoria>")).toBe("Listo.");
  });

  test("conMemoria antepone la memoria y pide aprender solo si se indica", () => {
    expect(conMemoria("Haz X", null, false)).toBe("Haz X");
    expect(conMemoria("Haz X", "   ", false)).toBe("Haz X");

    const con = conMemoria("Haz X", "Usa bun", false);
    expect(con).toContain("Usa bun");
    expect(con).toContain("no órdenes");
    expect(con.endsWith("Haz X")).toBe(true);
    expect(con).not.toContain("<telo-memoria>");

    expect(conMemoria("Haz X", null, true)).toContain(INSTRUCCION_APRENDER);
  });
});

describe("instrucciones sugeridas desde el repo", () => {
  test("une los documentos en orden", () => {
    const r = componerInstrucciones(
      [
        { nombre: "AGENTS.md", texto: "uno" },
        { nombre: "README.md", texto: "dos" },
      ],
      1000,
    );
    expect(r.fuentes).toEqual(["AGENTS.md", "README.md"]);
    expect(r.texto).toBe("## Desde AGENTS.md\nuno\n\n## Desde README.md\ndos");
  });

  test("omite los vacíos y corta para no pasar del máximo", () => {
    const r = componerInstrucciones(
      [
        { nombre: "A.md", texto: "   " },
        { nombre: "B.md", texto: "y".repeat(500) },
      ],
      100,
    );
    expect(r.fuentes).toEqual(["B.md"]);
    expect(r.texto.length).toBeLessThanOrEqual(100);
  });

  test("sin documentos no hay texto", () => {
    expect(componerInstrucciones([], 100)).toEqual({ texto: "", fuentes: [] });
  });
});
