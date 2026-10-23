import { expect, test } from "bun:test";
import { registrarTransicion } from "../src/lib/notificaciones-estado";

test("siembra la primera vez sin avisar y avisa los cambios nuevos sin duplicar", () => {
  const estados = new Map<string, string>();
  // La primera vez que se ve un id solo toma el punto de partida: ese estado ya existía
  // al abrir la app (o llegó como primer paquete tras conectar), no es una novedad.
  expect(registrarTransicion(estados, "a", "failed")).toBe(false);
  expect(registrarTransicion(estados, "a", "failed")).toBe(false);
  // Lo que cambia con la app abierta sí avisa, y cada cambio suena una sola vez.
  expect(registrarTransicion(estados, "a", "running")).toBe(true);
  expect(registrarTransicion(estados, "a", "failed")).toBe(true);
  expect(registrarTransicion(estados, "a", "failed")).toBe(false);
  // Otras tareas siembran y avisan de forma independiente.
  expect(registrarTransicion(estados, "b", "waiting_approval")).toBe(false);
  expect(registrarTransicion(estados, "b", "running")).toBe(true);
  // Un estado vacío nunca avisa.
  expect(registrarTransicion(estados, "c", "")).toBe(false);
});
