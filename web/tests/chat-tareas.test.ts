import { expect, test } from "bun:test";
import type { Task, TaskStatus } from "../src/api";
import { tareaVisibleDelChat } from "../src/lib/actividad-chat";

const tarea = (id: string, status: TaskStatus) => ({ id, status }) as Task;

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
