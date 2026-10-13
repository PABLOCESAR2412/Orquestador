import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { sinLimiteDeInactividad } from "../src/conexion";

// Simula el contexto de Hono dentro de Bun: c.env es el servidor y c.req.raw la petición.
function contextoFalso(servidor: unknown) {
  const raw = new Request("http://localhost/api/prueba");
  return { env: servidor, req: { raw } } as unknown as Context;
}

describe("sinLimiteDeInactividad", () => {
  test("desactiva el límite de inactividad solo para esa petición", () => {
    const llamadas: Array<[Request, number]> = [];
    const servidor = { timeout: (req: Request, s: number) => llamadas.push([req, s]) };
    const c = contextoFalso(servidor);
    sinLimiteDeInactividad(c);
    expect(llamadas.length).toBe(1);
    expect(llamadas[0][1]).toBe(0);
    expect(llamadas[0][0]).toBe(c.req.raw);
  });

  test("no falla si no hay servidor (pruebas o runtime sin esa función)", () => {
    expect(() => sinLimiteDeInactividad(contextoFalso(undefined))).not.toThrow();
    expect(() => sinLimiteDeInactividad(contextoFalso({}))).not.toThrow();
  });
});
