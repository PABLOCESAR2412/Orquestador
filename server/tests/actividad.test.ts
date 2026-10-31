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
const { suscribirConEventosDesde } = await import("../src/bus");
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
  test("la cola del proveedor explica la espera y completa el mismo paso al admitir", () => {
    const fila = (estado: string) => itemDeLinea(JSON.stringify({ type: "telo.queue", id: "espera-1", proveedor: "opencode", estado }));
    expect(fila("waiting")).toMatchObject({ herramienta: "capacity", callId: "queue:espera-1", estado: "en_curso", titulo: "En cola: esperando capacidad de opencode" });
    expect(fila("ready")).toMatchObject({ callId: "queue:espera-1", estado: "hecha" });
    expect(fila("cancelled")).toMatchObject({ estado: "error" });
    const turno = "turno-capacidad-reanudada";
    registrarActividad(CONVERSACION, turno, fila("ready")!);
    registrarActividad(CONVERSACION, turno, fila("waiting")!);
    expect(actividadDelTurno(CONVERSACION, turno)).toHaveLength(1);
    expect(actividadDelTurno(CONVERSACION, turno)[0].estado).toBe("en_curso");
  });
  test("el texto intermedio pasa como paso de texto", () => {
    const linea = JSON.stringify({ type: "text", part: { type: "text", text: "  Voy a leer el archivo.  " } });
    expect(itemDeLinea(linea)).toEqual({ tipo: "texto", texto: "Voy a leer el archivo." });
  });

  test("la compactación automática del contexto aparece como una acción", () => {
    expect(itemDeLinea(JSON.stringify({ type: "session.compacted", properties: { sessionID: "ses_prueba" } }))).toEqual({
      tipo: "accion",
      herramienta: "compaction",
      titulo: "Contexto compactado automáticamente",
      detalle: null,
      estado: "hecha",
    });
  });

  test("una lectura terminada muestra la ruta y la vista previa de la salida", () => {
    const item = itemDeLinea(
      herramienta("read", { input: { filePath: "src/app.ts" }, output: "const a = 1;\nexport {};" }),
    );
    expect(item).toEqual({
      tipo: "accion",
      herramienta: "read",
      callId: "toolu_1",
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

  test("una herramienta en curso se publica con su id para completar el mismo paso", () => {
    const linea = JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "running" } } });
    expect(itemDeLinea(linea)).toMatchObject({ tipo: "accion", herramienta: "bash", estado: "en_curso" });
  });

  test("una llamada invalid no se marca hecha aunque OpenCode la complete", () => {
    expect(itemDeLinea(herramienta("invalid", { output: "Invalid arguments: JSON incompleto" })))
      .toMatchObject({ estado: "error", titulo: "El modelo envió una llamada de herramienta inválida" });
  });

  test("los eventos de Codex convierten comandos y cambios de archivo en actividad", () => {
    const comandoInicio = itemDeLinea(JSON.stringify({
      type: "item.started",
      item: { id: "cmd-1", type: "command_execution", command: "bun test server/tests/actividad.test.ts" },
    }));
    const comandoFin = itemDeLinea(JSON.stringify({
      type: "item.completed",
      item: { id: "cmd-1", type: "command_execution", command: "bun test server/tests/actividad.test.ts", aggregated_output: "12 pass", exit_code: 0 },
    }));
    expect(comandoInicio).toMatchObject({ tipo: "accion", estado: "en_curso", callId: "cmd-1" });
    expect(comandoFin).toMatchObject({ tipo: "accion", estado: "hecha", callId: "cmd-1", detalle: expect.stringContaining("12 pass") });

    const cambio = itemDeLinea(JSON.stringify({
      type: "item.completed",
      item: { id: "edit-1", type: "file_change", changes: [{ kind: "update", path: "web/src/chat.tsx" }] },
    }));
    expect(cambio).toMatchObject({ tipo: "accion", herramienta: "edit", titulo: "Modificó web/src/chat.tsx", estado: "hecha" });
  });

  test("omite eventos de razonamiento de Codex", () => {
    expect(itemDeLinea(JSON.stringify({ type: "item.completed", item: { id: "reason-1", type: "reasoning", text: "razonamiento privado" } }))).toBeNull();
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

  test("una búsqueda web muestra la consulta y los resultados observados", () => {
    const { titulo, detalle } = describirAccion("websearch", { query: "límites Gemini API" }, "Encontró la documentación oficial", null);
    expect(titulo).toBe("Buscó en la web «límites Gemini API»");
    expect(detalle).toBe("Encontró la documentación oficial");
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

  test("la integración de GitHub se distingue de un comando de terminal", () => {
    const { titulo, detalle } = describirAccion("github_search_code", { query: "chat" }, "3 resultados", null);
    expect(titulo).toBe("Usó la integración de GitHub");
    expect(detalle).toBe("3 resultados");
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
    const baja = suscribirConEventosDesde(null, (e) => recibidos.push(e)).baja;
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

  test("el cierre de una herramienta actualiza el paso en curso sin duplicarlo", () => {
    const turno = "turno-herramienta-en-curso";
    const recibidos: EventoVivo[] = [];
    const baja = suscribirConEventosDesde(null, (e) => recibidos.push(e)).baja;
    try {
      const inicio = itemDeLinea(herramienta("bash", { status: "running", input: { command: "bun test" } }));
      const fin = itemDeLinea(herramienta("bash", { status: "completed", input: { command: "bun test" }, output: "5 pass" }));
      expect(inicio?.tipo).toBe("accion");
      expect(fin?.tipo).toBe("accion");
      if (inicio && fin) {
        registrarActividad(CONVERSACION, turno, inicio);
        registrarActividad(CONVERSACION, turno, fin);
      }
    } finally {
      baja();
    }
    const filas = actividadDelTurno(CONVERSACION, turno);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ seq: 1, estado: "hecha", detalle: "$ bun test\n5 pass" });
    const publicados = recibidos.filter((e) => e.tipo === "actividad");
    expect(publicados).toHaveLength(2);
    expect(publicados[0]).toMatchObject({ tipo: "actividad", paso: { seq: 1, estado: "en_curso" } });
    expect(publicados[1]).toMatchObject({ tipo: "actividad", paso: { seq: 1, estado: "hecha" } });
  });

  test("un turno no admite más de 300 pasos", () => {
    const turno = "turno-tope";
    for (let i = 0; i < 300; i++) {
      registrarActividad(CONVERSACION, turno, { tipo: "texto", texto: `paso ${i}` });
    }
    expect(registrarActividad(CONVERSACION, turno, { tipo: "texto", texto: "de más" })).toBeNull();
    expect(actividadDelTurno(CONVERSACION, turno)).toHaveLength(300);
  });

  test("un inicio tardío del plugin no revierte una herramienta ya terminada", () => {
    const turno = "orden-plugin-stdout";
    registrarActividad(CONVERSACION, turno, itemDeLinea(herramienta("bash", { output: "Prueba terminada" }))!);
    registrarActividad(CONVERSACION, turno, itemDeLinea(herramienta("bash", { status: "running" }))!);
    expect(actividadDelTurno(CONVERSACION, turno)).toHaveLength(1);
    expect(actividadDelTurno(CONVERSACION, turno)[0]).toMatchObject({ estado: "hecha", detalle: "Prueba terminada" });
  });
});
