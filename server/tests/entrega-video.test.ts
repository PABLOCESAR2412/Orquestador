import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-entrega-video-"));
mkdirSync(join(raiz, "renders"), { recursive: true });
writeFileSync(join(raiz, "renders", "final.mp4"), "0000ftypisom");
writeFileSync(join(raiz, "renders", "falso.mp4"), "no es video");

const { anexarEnlaceVideo, buscarVideoVerificado, promptRecuperarEntregaVideo, requiereEntregaVideo } = await import("../src/entrega-video");

afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("entrega verificable de videos", () => {
  test("reconoce creación, edición y entrega, no una consulta informativa", () => {
    expect(requiereEntregaVideo("Hazme un video vertical de 15 segundos")).toBe(true);
    expect(requiereEntregaVideo("Pon voz y subtítulos en el video")).toBe(true);
    expect(requiereEntregaVideo("Dame el resultado del video que te pedí")).toBe(true);
    expect(requiereEntregaVideo("¿Cómo se edita un video?")).toBe(false);
    expect(requiereEntregaVideo("Revisa el video y dime qué formato tiene")).toBe(false);
  });

  test("solo valida rutas relativas existentes con firma MP4", () => {
    expect(buscarVideoVerificado("Archivo: `renders/final.mp4`", [raiz])).toBe("renders/final.mp4");
    expect(buscarVideoVerificado("[Ver](renders/falso.mp4)", [raiz])).toBeNull();
    expect(buscarVideoVerificado("Archivo: `../fuera.mp4`", [raiz])).toBeNull();
    expect(buscarVideoVerificado("No incluí la ruta del archivo.", [raiz])).toBeNull();
  });

  test("añade enlace al resultado y el prompt de recuperación evita repetir el render", () => {
    expect(anexarEnlaceVideo("El video quedó listo.", "renders/final.mp4")).toBe(
      "El video quedó listo.\n\n## Video entregado\n[Ver o descargar el video](renders/final.mp4)",
    );
    const recuperacion = promptRecuperarEntregaVideo("Crea un video", "Ahora lo copio a entregables.");
    expect(recuperacion).toContain("No repitas trabajo ni render si el archivo ya existe");
    expect(recuperacion).toContain("no afirmes que el video fue entregado");
  });
});
