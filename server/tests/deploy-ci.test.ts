import { describe, expect, test } from "bun:test";
import { evaluarChecksGitHub } from "../../deploy/verificar-ci";

describe("puerta de CI del despliegue", () => {
  test("requiere que los dos trabajos obligatorios terminen bien", () => {
    expect(evaluarChecksGitHub({ check_runs: [
      { id: 1, name: "servidor", status: "completed", conclusion: "success" },
      { id: 2, name: "interfaz", status: "completed", conclusion: "success" },
    ] })).toEqual({ listo: true, motivo: "servidor e interfaz aprobaron CI" });
  });

  test("pospone si faltan checks o siguen ejecutándose", () => {
    expect(evaluarChecksGitHub({ check_runs: [
      { id: 1, name: "servidor", status: "in_progress", conclusion: null },
    ] })).toEqual({ listo: false, motivo: "servidor:pendiente,interfaz:pendiente" });
  });

  test("el resultado más reciente gobierna y un fallo bloquea el despliegue", () => {
    expect(evaluarChecksGitHub({ check_runs: [
      { id: 1, name: "servidor", status: "completed", conclusion: "success", completed_at: "2026-10-31T10:00:00Z" },
      { id: 2, name: "servidor", status: "completed", conclusion: "failure", completed_at: "2026-10-31T10:01:00Z" },
      { id: 3, name: "interfaz", status: "completed", conclusion: "success" },
    ] })).toEqual({ listo: false, motivo: "servidor:failure" });
  });

  test("rechaza errores de API con forma inesperada", () => {
    expect(evaluarChecksGitHub({ message: "Not Found" })).toEqual({ listo: false, motivo: "respuesta_invalida" });
  });
});
