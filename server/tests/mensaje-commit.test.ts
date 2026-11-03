import { expect, test } from "bun:test";
import { mensajeCommitConvencional } from "../src/mensaje-commit";

test("deriva fix y asunto del resultado real, con scope del diff", () => {
  const reporte = JSON.stringify({
    tipo_cambio: "fix",
    resumen: "Se corrigió el scroll al cargar diagramas.",
  });
  expect(mensajeCommitConvencional(reporte, [
    "web/src/components/diagramas.tsx",
    "web/src/styles/diagramas.css",
  ])).toBe("fix(web): corrige el scroll al cargar diagramas");
});

test("clasifica una capacidad nueva como feat", () => {
  const reporte = JSON.stringify({
    tipo_cambio: "feat",
    resumen: "Se añadió el selector de nivel de esfuerzo.",
  });
  expect(mensajeCommitConvencional(reporte, ["apps/web/src/components/model-picker.tsx"])).toBe(
    "feat(web): añade el selector de nivel de esfuerzo",
  );
});

test("los archivos objetivos prevalecen si el tipo reportado no coincide", () => {
  expect(mensajeCommitConvencional(
    JSON.stringify({ tipo_cambio: "feat", resumen: "Se añadió una guía." }),
    ["docs/guia.md", "README.md"],
  )).toBe("docs: añade una guía");
});

test("sin reporte evita inventar un asunto a partir de la petición", () => {
  expect(mensajeCommitConvencional(null, ["server/tests/plan.test.ts"])).toBe("test(server): actualiza las pruebas");
});
