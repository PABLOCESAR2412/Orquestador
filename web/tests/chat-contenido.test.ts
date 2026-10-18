import { describe, expect, test } from "bun:test";
import { separarReferenciaArchivo } from "../src/components/chat-contenido";

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
});
