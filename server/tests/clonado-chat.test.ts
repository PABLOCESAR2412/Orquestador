import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal compartida por todos los archivos de prueba (ver proyectos.test.ts).
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { itemDeComando, textoDeError, textoDeExito } = await import("../src/clonado-chat");
const { ErrorClonado } = await import("../src/clonado");

describe("pasos del clonado en el chat", () => {
  test("un comando correcto es un paso hecho, con el comando y su salida", () => {
    const item = itemDeComando({
      comando: "git clone --no-recurse-submodules https://github.com/acme/app .",
      codigo: 0,
      salida: "Cloning into '<carpeta>'...",
    });
    expect(item).toMatchObject({ tipo: "accion", herramienta: "bash", estado: "hecha" });
    expect(item.tipo === "accion" && item.titulo).toContain("git clone --no-recurse-submodules");
    expect(item.tipo === "accion" && item.detalle).toContain("$ git clone");
    expect(item.tipo === "accion" && item.detalle).toContain("Cloning into '<carpeta>'");
  });

  test("un comando fallido es un paso con error y su motivo visible", () => {
    const item = itemDeComando({ comando: "git ls-remote --heads https://github.com/acme/x", codigo: 128, salida: "" });
    expect(item).toMatchObject({ estado: "error" });
    expect(item.tipo === "accion" && item.detalle).toContain("El comando falló");
  });
});

describe("mensajes finales del clonado", () => {
  test("el éxito dice la rama, el último commit y cómo se clonó, sin tecnicismos", () => {
    const texto = textoDeExito(
      { visibilidad: "privado", credencial: "app", rama: "main", ultimo_commit: "a1b2c3d Inicio" },
      "app",
    );
    expect(texto.startsWith("Listo. app está clonado en la carpeta del proyecto, en la rama main.")).toBe(true);
    expect(texto).toContain("Último commit: a1b2c3d Inicio.");
    expect(texto).toContain("GitHub App");
  });

  test("cada error tiene su motivo en español, con el paso siguiente cuando hace falta", () => {
    expect(textoDeError(new ErrorClonado("clave_no_encontrada", 409))).toContain("Vincula la GitHub App");
    expect(textoDeError(new ErrorClonado("sin_red_github", 503))).toContain("no llega a GitHub");
    expect(textoDeError(new Error("algo interno"))).toBe(
      "No pude clonar el repositorio. Git no pudo clonarlo. Intenta de nuevo.",
    );
  });
});
