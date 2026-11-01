import { expect, test } from "bun:test";
import { auxiliaresEnVivo } from "../src/lib/auxiliares-actividad";
import type { PasoActividad } from "../src/api";

const hito = (detalle: string, seq = 1): PasoActividad => ({ seq, tipo: "texto", titulo: `Auxiliar arquitectura (google/gemini-test): ${detalle}`, detalle: null, herramienta: null, estado: "texto" });
const accion = (estado: PasoActividad["estado"], seq = 2): PasoActividad => ({ seq, tipo: "accion", titulo: "[arquitectura] Capacidad disponible", detalle: null, herramienta: "capacity", estado });

test("la cuota agotada termina el auxiliar y una acción tardía no lo vuelve a activar", () => {
  const [auxiliar] = auxiliaresEnVivo([hito("inició la revisión de solo lectura"), accion("error"), hito("falló tras 42.0 s: Se acabó la cuota del modelo google/gemini-test", 3), accion("hecha", 4)]);
  expect(auxiliar.estado).toBe("failed");
  expect(auxiliar.avance).toContain("Se acabó la cuota");
});

test("reutilizar una revisión completada no aparece como trabajo en curso", () => {
  expect(auxiliaresEnVivo([hito("reutilicé la revisión ya completada; no repetí esa llamada.")])[0].estado).toBe("done");
});

test("un error recuperable de herramienta conserva el análisis activo hasta su resultado", () => {
  expect(auxiliaresEnVivo([hito("inició la revisión"), accion("error")])[0].estado).toBe("running");
  expect(auxiliaresEnVivo([hito("inició la revisión"), accion("error"), hito("terminó la revisión en 2.0 s", 3)])[0].estado).toBe("done");
});

test("reconoce las dos formas de cancelación que emite el servidor", () => {
  for (const detalle of ["cancelado junto con el turno.", "se canceló junto con el turno."]) {
    expect(auxiliaresEnVivo([hito(detalle)])[0].estado).toBe("cancelled");
  }
});
