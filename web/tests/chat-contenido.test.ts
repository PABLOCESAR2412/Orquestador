import { describe, expect, test } from "bun:test";
import { esRutaArchivo, separarReferenciaArchivo } from "../src/components/chat-contenido";

describe("referencias de archivos del chat", () => {
  test("separa rangos de líneas de la ruta antes de pedir el archivo", () => {
    expect(separarReferenciaArchivo("src/app.ts:30-298")).toEqual({ ruta: "src/app.ts", linea: 30 });
    expect(separarReferenciaArchivo("src/app.ts:30:12")).toEqual({ ruta: "src/app.ts", linea: 30 });
    expect(separarReferenciaArchivo("src/app.ts#L30-L298")).toEqual({ ruta: "src/app.ts", linea: 30 });
  });

  test("conserva referencias sin línea y rangos de una línea", () => {
    expect(separarReferenciaArchivo("src/app.ts")).toEqual({ ruta: "src/app.ts" });
    expect(separarReferenciaArchivo("src/app.ts:30")).toEqual({ ruta: "src/app.ts", linea: 30 });
  });

  test("reconoce PDFs con espacios sin convertir frases en rutas", () => {
    expect(esRutaArchivo("segunda guerra mundial v2.pdf")).toBe(true);
    expect(separarReferenciaArchivo("segunda guerra mundial v2.pdf")).toEqual({ ruta: "segunda guerra mundial v2.pdf" });
    expect(esRutaArchivo("un documento que se llama informe")).toBe(false);
    expect(esRutaArchivo("carpeta/informe de prueba.ts")).toBe(false);
  });

  test("reconoce imágenes raster con espacios para abrirlas desde el chat", () => {
    expect(esRutaArchivo("infografía final.png")).toBe(true);
    expect(separarReferenciaArchivo("infografía final.png")).toEqual({ ruta: "infografía final.png" });
    expect(esRutaArchivo("captura.webp")).toBe(true);
    expect(esRutaArchivo("una imagen que hizo el agente")).toBe(false);
  });
});
