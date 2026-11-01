import { expect, test } from "bun:test";
import type { PasoActividad, Task, TaskStatus } from "../src/api";
import { integrarActividadGuardada, tareaVisibleDelChat } from "../src/lib/actividad-chat";

const tarea = (id: string, status: TaskStatus) => ({ id, status }) as Task;

test("el sondeo actualiza el mismo turno y conserva eventos posteriores y herramientas terminadas", () => {
  const paso = (seq: number, estado: PasoActividad["estado"], detalle: string) => ({ seq, tipo: "accion", herramienta: "bash", titulo: "Ejecutar", detalle, estado }) as PasoActividad;
  const actuales = [paso(1, "en_curso", "sin salida"), paso(3, "hecha", "evento reciente")];
  const nuevos = integrarActividadGuardada(actuales, [paso(1, "hecha", "10 pruebas pasan"), paso(2, "hecha", "lectura terminada")]);
  expect(nuevos.map(p => p.seq)).toEqual([1, 2, 3]);
  expect(nuevos[0]).toMatchObject({ estado: "hecha", detalle: "10 pruebas pasan" });
  expect(integrarActividadGuardada(nuevos, [paso(1, "en_curso", "respuesta atrasada")])[0]).toEqual(nuevos[0]);
});

for (const estado of ["running", "analyzing", "waiting_approval"] as const) {
  test(`los turnos nuevos no ocultan la tarea ${estado}`, () => {
    const actual = tarea("actual", estado);
    expect(tareaVisibleDelChat([tarea("anterior", "done"), actual, tarea("siguiente", "queued")])).toBe(actual);
  });
}

test("sin tarea activa muestra la primera en cola y después el último resultado", () => {
  const primera = tarea("primera", "queued"), segunda = tarea("segunda", "queued");
  expect(tareaVisibleDelChat([tarea("anterior", "done"), primera, segunda])).toBe(primera);
  segunda.status = "done";
  primera.status = "cancelled";
  expect(tareaVisibleDelChat([primera, segunda])).toBe(segunda);
  expect(tareaVisibleDelChat([])).toBeUndefined();
});
