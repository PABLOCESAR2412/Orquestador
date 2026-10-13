import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal compartida por todos los archivos de prueba (ver proyectos.test.ts).
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { itemDeLinea, describirAccion, vistaDe, registrarActividad, actividadDelTurno } = await import(
  "../src/actividad"
);
const { suscribir } = await import("../src/bus");
import type { EventoVivo } from "../src/bus";
const { db } = await import("../src/db");

// Una conversación real: chat_actividad tiene clave foránea hacia conversations.
const CONVERSACION = "conv-actividad-prueba";
db.query("INSERT OR IGNORE INTO conversations (id, title) VALUES (?, ?)").run(CONVERSACION, "Prueba");

// Línea tal como la emite OpenCode con --format json (herramienta terminada).
function herramienta(nombre: string, estado: Record<string, unknown>): string {
  return JSON.stringify({
    type: "tool_use",
    sessionID: "ses_prueba",
    part: { type: "tool", tool: nombre, callID: "toolu_1", state: { status: "completed", ...estado } },
  });
}

describe("líneas del agente", () => {
  test("el texto intermedio pasa como paso de texto", () => {
    const linea = JSON.stringify({ type: "text", part: { type: "text", text: "  Voy a leer el archivo.  " } });
    expect(itemDeLinea(linea)).toEqual({ tipo: "texto", texto: "Voy a leer el archivo." });
  });

  test("una lectura terminada muestra la ruta y la vista previa de la salida", () => {
    const item = itemDeLinea(
      herramienta("read", { input: { filePath: "src/app.ts" }, output: "const a = 1;\nexport {};" }),
    );
    expect(item).toEqual({
      tipo: "accion",
      herramienta: "read",
      titulo: "Leyó src/app.ts",
      detalle: "const a = 1;\nexport {};",
      estado: "hecha",
    });
  });

  test("una herramienta con error queda marcada como error y muestra el motivo", () => {
    const linea = JSON.stringify({
      type: "tool_use",
      part: { type: "tool", tool: "read", state: { status: "error", input: { filePath: "x.md" }, error: "No existe" } },
    });
    expect(itemDeLinea(linea)).toMatchObject({ tipo: "accion", estado: "error", detalle: "No existe" });
  });

  test("una edición que falla muestra el motivo antes que el cambio pedido", () => {
    const { detalle } = describirAccion("edit", { filePath: "a.ts", oldString: "x", newString: "y" }, null, "No se encontró el texto");
    expect(detalle).toBe("No se encontró el texto\n\n- x\n+ y");
  });

  test("una herramienta que todavía corre no se muestra", () => {
    const linea = JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "running" } } });
    expect(itemDeLinea(linea)).toBeNull();
  });

  test("líneas que no son JSON, sin tipo o sin contenido se descartan", () => {
    expect(itemDeLinea("no es json")).toBeNull();
    expect(itemDeLinea('{"sin":"tipo"}')).toBeNull();
    expect(itemDeLinea(JSON.stringify({ type: "text", part: { type: "text", text: "   " } }))).toBeNull();
    expect(itemDeLinea(JSON.stringify({ type: "step_start" }))).toBeNull();
  });
});

describe("títulos y vistas previas", () => {
  test("un comando muestra la descripción en el título y el comando con su salida en el detalle", () => {
    const { titulo, detalle } = describirAccion("bash", { command: "bun test", description: "Correr pruebas" }, "15 pass", null);
    expect(titulo).toBe("Ejecutó Correr pruebas");
    expect(detalle).toBe("$ bun test\n15 pass");
  });

  test("una edición muestra lo quitado y lo puesto", () => {
    const { titulo, detalle } = describirAccion("edit", { filePath: "web/a.ts", oldString: "viejo", newString: "nuevo" }, "ok", null);
    expect(titulo).toBe("Editó web/a.ts");
    expect(detalle).toBe("- viejo\n+ nuevo");
  });

  test("una búsqueda dice qué buscó y dónde", () => {
    expect(describirAccion("grep", { pattern: "clonar", path: "server/src" }, "", null).titulo).toBe(
      "Buscó «clonar» en server/src",
    );
    expect(describirAccion("glob", { pattern: "**/*.md" }, null, null).titulo).toBe("Buscó archivos «**/*.md»");
  });

  test("una herramienta desconocida se nombra sin inventar su significado", () => {
    const { titulo, detalle } = describirAccion("herramienta_nueva", { x: 1 }, null, null);
    expect(titulo).toBe("Usó herramienta_nueva");
    expect(detalle).toBe('{"x":1}');
  });

  test("la vista previa recorta a 30 líneas y dice cuántas faltan", () => {
    const salida = Array.from({ length: 40 }, (_, i) => `línea ${i + 1}`).join("\n");
    const vista = vistaDe(salida);
    expect(vista.split("\n")[0]).toBe("línea 1");
    expect(vista).toContain("línea 30");
    expect(vista).not.toContain("línea 31");
    expect(vista.endsWith("(10 líneas más)")).toBe(true);
  });
});

describe("registro por turno", () => {
  test("los pasos se numeran en orden, se leen por turno y se publican al canal en vivo", () => {
    const turno = "turno-orden";
    const recibidos: EventoVivo[] = [];
    const baja = suscribir((e) => recibidos.push(e));
    try {
      registrarActividad(CONVERSACION, turno, { tipo: "texto", texto: "Voy a revisarlo." });
      registrarActividad(CONVERSACION, turno, {
        tipo: "accion",
        herramienta: "read",
        titulo: "Leyó a.ts",
        detalle: "uno",
        estado: "hecha",
      });
    } finally {
      baja();
    }

    const filas = actividadDelTurno(CONVERSACION, turno);
    expect(filas.map((f) => f.seq)).toEqual([1, 2]);
    expect(filas[0]).toMatchObject({ tipo: "texto", titulo: "Voy a revisarlo.", estado: "texto" });
    expect(filas[1]).toMatchObject({ tipo: "accion", herramienta: "read", detalle: "uno", estado: "hecha" });

    const publicados = recibidos.filter((e) => e.tipo === "actividad");
    expect(publicados).toHaveLength(2);
    expect(publicados[1]).toMatchObject({
      conversacion_id: CONVERSACION,
      turno_id: turno,
      paso: { seq: 2, tipo: "accion", herramienta: "read", estado: "hecha" },
    });
  });

  test("un turno no admite más de 300 pasos", () => {
    const turno = "turno-tope";
    for (let i = 0; i < 300; i++) {
      registrarActividad(CONVERSACION, turno, { tipo: "texto", texto: `paso ${i}` });
    }
    expect(registrarActividad(CONVERSACION, turno, { tipo: "texto", texto: "de más" })).toBeNull();
    expect(actividadDelTurno(CONVERSACION, turno)).toHaveLength(300);
  });
});
