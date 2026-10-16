import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/api";
import { errorText } from "../src/lib/model";

describe("mensajes de error", () => {
  test("explica el fallo de una tarea y conserva el detalle sin mostrar rutas", () => {
    const texto = errorText(new ApiError(500, "tarea_error", "Error: fallo al leer C:\\Users\\orquestador\\secreto\\archivo.ts"));

    expect(texto).toContain("La tarea se detuvo antes de completarse");
    expect(texto).toContain("Detalle:");
    expect(texto).toContain("[ruta]");
    expect(texto).toContain("abre «Ver proceso»");
    expect(texto).not.toContain("C:\\Users");
  });

  test("recomienda el paso adecuado ante cuota y credenciales de proveedor", () => {
    const cuota = errorText(new ApiError(502, "runner_failed", "HTTP 429: quota exceeded"));
    const credencial = errorText(new ApiError(502, "runner_failed", "401 invalid api key: sk-abcdefgh12345678"));

    expect(cuota).toContain("comprueba la cuota del proveedor");
    expect(credencial).toContain("revisa en Ajustes");
    expect(credencial).not.toContain("sk-abcdefgh12345678");
  });

  test("traduce errores de GitHub que antes no tenían mensaje propio", () => {
    expect(errorText(new ApiError(502, "conexion_fallida"))).toContain("Telo no pudo conectar con GitHub");
    expect(errorText(new ApiError(502, "github_error", "HTTP 502"))).toContain("revisa el acceso de la cuenta");
    expect(errorText(new ApiError(503, "codex_models_unavailable"))).toContain("modelos de Codex");
  });

  test("da una explicación y un siguiente paso para errores HTTP nuevos y de red", () => {
    const conflicto = errorText(new ApiError(409, "error_nuevo"));
    const servidor = errorText(new ApiError(503, "error_nuevo", "Error: fetch failed"));
    const red = errorText(new TypeError("Failed to fetch"));

    expect(conflicto).toContain("El estado cambió");
    expect(conflicto).toContain("HTTP 409");
    expect(servidor).toContain("servicio del servidor o del proveedor");
    expect(servidor).toContain("comprueba que el servidor tenga conexión");
    expect(red).toContain("Telo no pudo conectarse con el servidor");
  });
});
