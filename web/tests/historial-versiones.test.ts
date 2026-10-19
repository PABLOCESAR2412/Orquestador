import { describe, expect, test } from "bun:test";
import cambios from "../src/cambios.json";
import { historialPorPR, type CambioRegistrado } from "../src/lib/historial-versiones";

describe("historial de actualizaciones por PR", () => {
  test("agrupa cambios de una misma PR y ordena por actividad reciente", () => {
    const datos: CambioRegistrado[] = [
      { fecha: "2026-01-02", tipo: "mediano", titulo: "Función nueva", pr: 6 },
      { fecha: "2026-01-02", tipo: "minimo", titulo: "Ajuste", pr: 6 },
      { fecha: "2026-01-02", tipo: "minimo", titulo: "Sin PR", pr: null },
      { fecha: "2026-01-01", tipo: "grande", titulo: "Aislamiento", pr: 5 },
    ];

    const historial = historialPorPR(datos);

    expect(historial.map(({ pr, tipo }) => [pr, tipo])).toEqual([
      [6, "mediano"],
      [5, "grande"],
    ]);
    expect(historial[0].cambios.map(({ titulo }) => titulo)).toEqual(["Función nueva", "Ajuste"]);
  });

  test("incluye todas las entradas con PR y conserva la fecha más reciente de cada grupo", () => {
    const entradas = cambios.cambios as CambioRegistrado[];
    const historial = historialPorPR(entradas);

    const fechaMasReciente = historial[0].fecha;
    const mayorPRDeLaFecha = Math.max(...entradas.filter((cambio) => cambio.pr !== null && cambio.fecha === fechaMasReciente).map((cambio) => cambio.pr!));
    expect(historial[0].pr).toBe(mayorPRDeLaFecha);
    expect(historial.find(({ pr }) => pr === 53)?.fecha).toBe("2026-10-16");
    expect(historial.flatMap(({ cambios: grupo }) => grupo)).toHaveLength(
      entradas.filter(({ pr }) => pr !== null).length,
    );
    expect(new Set(historial.map(({ pr }) => pr)).size).toBe(historial.length);
  });
});
