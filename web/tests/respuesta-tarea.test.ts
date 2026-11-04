import { expect, test } from "bun:test";
import { interpretarRespuestaTarea } from "../src/lib/respuesta-tarea";

test("presenta resumen y causa de reportes antiguos sin mostrar memoria interna", () => {
  const datos = interpretarRespuestaTarea('{"estado":"fallo","resumen":"Faltan dependencias","desviacion":"Instala antes de probar"}<telo-memoria>interno</telo-memoria>');
  expect(datos?.resumen).toBe("Faltan dependencias");
  expect(datos?.causa).toBe("Instala antes de probar");
  expect(datos?.estado).toBe("fallo");
  expect(datos?.detalles).not.toContain("interno");
});

test("recupera pruebas, cambios y pendientes del nuevo informe estructurado", () => {
  const datos = interpretarRespuestaTarea(JSON.stringify({
    tipo: "telo_reporte_tarea",
    version: 1,
    estado: "fallo",
    resumen: "La auditoría terminó con una prueba fallida.",
    desviacion: "tests/auditoria.test.ts esperaba un valor distinto.",
    cambios: [{ archivo: "tests/auditoria.test.ts", tipo: "editar" }],
    pruebas: [{ comando: "bun test tests/auditoria.test.ts", resultado: "fallo" }],
    pendientes: ["Corregir y ejecutar de nuevo"],
  }));
  expect(datos).toMatchObject({
    estado: "fallo",
    causa: "tests/auditoria.test.ts esperaba un valor distinto.",
    cambios: [{ archivo: "tests/auditoria.test.ts", tipo: "editar" }],
    pruebas: [{ comando: "bun test tests/auditoria.test.ts", resultado: "fallo" }],
    pendientes: ["Corregir y ejecutar de nuevo"],
  });
});

test("clasifica reportes antiguos bloqueados por workspace y credenciales", () => {
  const datos = interpretarRespuestaTarea(JSON.stringify({
    estado: "fallo",
    resumen: "El workspace sigue sin package.json, lockfile ni dist/; CLOUDFLARE_API_TOKEN no está disponible.",
    cambios: [],
    pruebas: [],
    pendientes: ["Configurar Cloudflare en el servicio"],
  }));
  expect(datos?.bloqueante_externo).toContain("Publicar en Cloudflare Pages");
  expect(datos?.bloqueante_externo).toContain("fuentes necesarios");
});

test("conserva el bloqueante explícito en reportes nuevos", () => {
  const datos = interpretarRespuestaTarea(JSON.stringify({
    estado: "fallo",
    resumen: "El despliegue quedó detenido.",
    bloqueante_externo: "Falta configurar el token de Cloudflare.",
  }));
  expect(datos?.bloqueante_externo).toBe("Falta configurar el token de Cloudflare.");
});

test("tolera JSON malformado sin ejecutar expresiones del modelo", () => {
  const datos = interpretarRespuestaTarea('{"estado":"desviacion","resumen":"No hay cambios","pendientes":["x".replace("x","y")]}');
  expect(datos?.resumen).toBe("No hay cambios");
  expect(datos?.detalles).toContain("replace");
  expect(interpretarRespuestaTarea("Una respuesta normal")).toBeNull();
});
