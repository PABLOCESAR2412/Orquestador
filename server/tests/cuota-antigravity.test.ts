import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(tmpdir(), "telo-pruebas-servicio");
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { interpretarUsoAntigravity } = await import("../src/cuota-antigravity");

test("interpreta el reporte JSON de cuotas de Antigravity", () => {
  const uso = interpretarUsoAntigravity(
    JSON.stringify({ status: "SUCCESS", response: "Gemini 3.5 Flash: 80% restante" }),
    "",
    0,
    1_800_000_000_000,
  );
  expect(uso).toMatchObject({
    estado: "activo",
    respuesta: "Gemini 3.5 Flash: 80% restante",
    comprobadoEn: new Date(1_800_000_000_000).toISOString(),
  });
});

test("identifica una sesión de Google ausente sin mostrar datos privados", () => {
  const uso = interpretarUsoAntigravity(
    JSON.stringify({ status: "ERROR", response: "", error: "Authentication required" }),
    "",
    1,
  );
  expect(uso.estado).toBe("sin_sesion");
  expect(uso.respuesta).toBeNull();
});

test("conserva texto plano útil y devuelve fallos de cuota como no disponibles", () => {
  const uso = interpretarUsoAntigravity("No se pudo consultar el límite", "", 1);
  expect(uso.estado).toBe("no_disponible");
  expect(uso.detalle).toBe("No se pudo consultar el límite");
});
