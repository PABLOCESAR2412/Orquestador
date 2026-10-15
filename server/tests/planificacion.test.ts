import { describe, expect, test } from "bun:test";
import { hashPlan, leerPlan, leerReporte, type Plan } from "../src/planificacion";

function planValido(): Plan {
  return {
    objetivo: "Corregir el saludo",
    supuestos: [],
    pasos: [{ id: 1, descripcion: "Editar y comprobar el saludo", archivos: ["src/saludo.ts"] }],
    criterios_de_aceptacion: ["El saludo usa el nombre"],
    requiere_aprobacion: [],
    riesgos: [],
    preguntas: [],
  };
}

describe("plan del analizador", () => {
  test("valida el reporte del obrero y admite solicitar revisión", () => {
    const reporte = {
      resumen: "Listo",
      cambios: [{ archivo: "src/saludo.ts", tipo: "editar" as const }],
      pruebas: [{ comando: "bun test", resultado: "ok" as const }],
      pendientes: [],
      diff_disponible: true,
    };
    expect(leerReporte(JSON.stringify(reporte))).toEqual(reporte);
    expect(leerReporte('{"requiere_revision":"Necesito otro archivo"}')).toEqual({
      requiere_revision: "Necesito otro archivo",
    });
    for (const cambio of [
      { cambios: [{ archivo: "../otro", tipo: "editar" }] },
      { pruebas: [{ comando: "bun test", resultado: "quizás" }] },
      { diff_disponible: "sí" },
      { memoria: "x".repeat(4001) },
    ])
      expect(() => leerReporte(JSON.stringify({ ...reporte, ...cambio }))).toThrow();
    expect(() => leerReporte("null")).toThrow();
  });
  test("acepta JSON puro o cercado en Markdown", () => {
    const plan = planValido();
    expect(leerPlan(JSON.stringify(plan))).toEqual(plan);
    expect(leerPlan("```json\n" + JSON.stringify(plan) + "\n``` ")).toEqual(plan);
  });

  test("rechaza respuestas incompletas, acciones desconocidas y pasos sin orden", () => {
    for (const texto of [
      "",
      "No puedo",
      "null",
      "[]",
      "{}",
      "{",
      "Texto " + JSON.stringify(planValido()),
    ]) {
      expect(() => leerPlan(texto)).toThrow();
    }
    for (const cambio of [
      { objetivo: " " },
      { riesgos: null },
      { preguntas: [1] },
      { criterios_de_aceptacion: [] },
      { requiere_aprobacion: ["deploy"] },
      { pasos: [] },
      { pasos: [{ id: 2, descripcion: "Editar", archivos: [] }] },
      { pasos: [{ id: 1, descripcion: " ", archivos: [] }] },
      {
        pasos: Array.from({ length: 9 }, (_, i) => ({
          id: i + 1,
          descripcion: "Editar",
          archivos: [],
        })),
      },
    ])
      expect(() => leerPlan(JSON.stringify({ ...planValido(), ...cambio }))).toThrow();
  });

  test("rechaza rutas fuera del workspace y cualquier segmento .git", () => {
    for (const ruta of [
      "/etc/passwd",
      "\\servidor\\archivo",
      "C:/datos",
      "../otro",
      "src/../../otro",
      "src\\..\\otro",
      "src\0archivo",
      ".git/config",
      "src/.git/hooks/pre-commit",
      ".GIT/config",
      "src\\.git\\config",
    ]) {
      const plan = planValido();
      plan.pasos[0].archivos = [ruta];
      expect(() => leerPlan(JSON.stringify(plan))).toThrow();
    }
  });

  test("hash estable del plan validado y sensible a cambios aprobables", () => {
    const plan = planValido();
    expect(hashPlan(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPlan(leerPlan(JSON.stringify(plan)))).toBe(hashPlan(plan));
    expect(hashPlan({ ...plan, requiere_aprobacion: ["push"] })).not.toBe(hashPlan(plan));
    expect(hashPlan({ ...plan, objetivo: "Otro objetivo" })).not.toBe(hashPlan(plan));
  });
});
