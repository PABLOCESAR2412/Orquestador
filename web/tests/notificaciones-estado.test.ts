import { expect, test } from "bun:test";
import { registrarTransicion } from "../src/lib/notificaciones-estado";
test("notifica pendientes iniciales y fallos nuevos sin duplicar retransmisiones", () => {
 const estados = new Map<string, string>();
 expect(registrarTransicion(estados, "a", "failed")).toBe(true);
 expect(registrarTransicion(estados, "a", "failed")).toBe(false);
 registrarTransicion(estados, "a", "running");
 expect(registrarTransicion(estados, "a", "failed")).toBe(true);
 expect(registrarTransicion(estados, "b", "waiting_approval")).toBe(true);
 expect(registrarTransicion(estados, "c", "")).toBe(false);
});
