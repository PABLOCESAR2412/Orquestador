import { expect, test } from "bun:test";
import { interpretarRespuestaTarea } from "../src/lib/respuesta-tarea";

test("presenta resumen y causa de reportes antiguos sin mostrar memoria interna", () => {
  const datos = interpretarRespuestaTarea('{"estado":"fallo","resumen":"Faltan dependencias","desviacion":"Instala antes de probar"}<telo-memoria>interno</telo-memoria>');
  expect(datos?.resumen).toBe("Faltan dependencias");
  expect(datos?.causa).toBe("Instala antes de probar");
  expect(datos?.detalles).not.toContain("interno");
});

test("tolera JSON malformado sin ejecutar expresiones del modelo", () => {
  const datos = interpretarRespuestaTarea('{"estado":"desviacion","resumen":"No hay cambios","pendientes":["x".replace("x","y")]}');
  expect(datos?.resumen).toBe("No hay cambios");
  expect(datos?.detalles).toContain("replace");
  expect(interpretarRespuestaTarea("Una respuesta normal")).toBeNull();
});
