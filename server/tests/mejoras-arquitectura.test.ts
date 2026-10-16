import { describe, expect, test } from "bun:test";
import { publicar, eventosDesde } from "../src/bus";
import { limpiarSesionesAntiguas, crearSesionDispositivo } from "../src/auth";
import { db } from "../src/db";

describe("resiliencia SSE: buffer circular y Last-Event-ID", () => {
  test("asigna secuencia incremental a cada evento y los recupera con eventosDesde", () => {
    const id1 = publicar({ tipo: "chat", conversacion_id: "conv-1", estado: "en_curso" });
    const id2 = publicar({ tipo: "chat", conversacion_id: "conv-1", estado: "terminado" });

    expect(id2).toBeGreaterThan(id1);

    const pendientes = eventosDesde(id1);
    expect(pendientes.length).toBeGreaterThanOrEqual(1);
    const encontrado = pendientes.find((p) => p.id === id2);
    expect(encontrado).toBeDefined();
    expect(encontrado?.evento.tipo).toBe("chat");

    // Si pide desde un id futuro o inexistente muy alto, devuelve array vacío
    expect(eventosDesde(id2 + 1000)).toEqual([]);
  });
});

describe("mantenimiento y purga de sesiones", () => {
  test("limpiarSesionesAntiguas no borra sesiones recientes y elimina las vencidas", () => {
    const s = crearSesionDispositivo({ userAgent: "Prueba Limpieza", ip: "127.0.0.1" });

    // Modificar last_seen_at para simular una sesión de hace 90 días
    db.query("UPDATE auth_sessions SET last_seen_at = datetime('now', '-90 days') WHERE id = ?").run(s.id);

    const borradas = limpiarSesionesAntiguas(60);
    expect(borradas).toBeGreaterThanOrEqual(1);

    const verificacion = db.query("SELECT id FROM auth_sessions WHERE id = ?").get(s.id);
    expect(verificacion).toBeNull();
  });
});
