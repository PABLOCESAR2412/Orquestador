import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { esResumenCompactacion } from "../../shared/compactacion";

const resumen = "## Objective\n- Terminar el video.\n## Important Details\n- Mantener la voz.\n## Work State\n### Completed\n- Audio preparado.\n### Active\n- Render.\n### Blocked\n- (none)\n## Next Move\n1. Verificar el MP4.\n## Relevant Files\n- video/index.html";
const raiz = mkdtempSync(join(tmpdir(), "telo-compactacion-"));
const originales = { DATA_DIR: process.env.DATA_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO };
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_AISLAMIENTO = "desactivado";
const { runOpenCode } = await import("../src/runners/opencode");
const { itemDeLinea, registrarActividad, actividadDelTurno, marcarRespuestaCompactada } = await import("../src/actividad");
const { db } = await import("../src/db");
afterAll(() => {
  db.close();
  for (const [clave, valor] of Object.entries(originales)) {
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  }
  rmSync(raiz, { recursive: true, force: true });
});

function flujo(lineas: unknown[]) {
  return new Blob([lineas.map((e) => JSON.stringify(e)).join("\n")]).stream();
}

test("reconoce la plantilla completa, sin plegar respuestas normales ni ejemplos de código", () => {
  expect(esResumenCompactacion(resumen)).toBe(true);
  expect(esResumenCompactacion("## Objective\nDescripción normal\n## Relevant Files\n- archivo.ts")).toBe(false);
  expect(esResumenCompactacion("```markdown\n" + resumen + "\n```")).toBe(false);
});

test("la compactación emitida como texto queda en actividad y no contamina el resultado ni el uso", async () => {
  const eventos = [
    { type: "text", sessionID: "ses_compacta", part: { type: "text", text: resumen } },
    { type: "step_finish", part: { type: "step-finish", cost: 0.01, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0 } } } },
    { type: "text", sessionID: "ses_compacta", part: { type: "text", text: "El video está listo y verificado." } },
  ];
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ stdout: flujo(eventos), stderr: flujo([]), exited: Promise.resolve(0), pid: 2147483647 })) as unknown as typeof Bun.spawn);
  const conv = crypto.randomUUID(), turno = crypto.randomUUID(), respuesta = crypto.randomUUID();
  db.query("INSERT INTO conversations(id,title) VALUES (?, 'Compactación')").run(conv);
  try {
    const result = await runOpenCode({ cwd: raiz, model: "opencode/prueba", prompt: "Termina el video", onLinea: (linea) => {
      const item = itemDeLinea(linea); if (item) registrarActividad(conv, turno, item);
    } });
    expect(result.textoFinal).toBe("El video está listo y verificado.");
    expect(result.text).not.toContain("## Objective");
    expect(result.sessionId).toBe("ses_compacta");
    expect(result.usage?.output).toBe(50);
    expect(result.usage?.cost).toBe(0.01);
    expect(actividadDelTurno(conv, turno)[0]).toMatchObject({ herramienta: "compaction", detalle: resumen });
    db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'assistant',?)").run(respuesta, conv, result.textoFinal);
    marcarRespuestaCompactada(respuesta, conv, turno);
    expect(db.query<{ sesion_compactada: number }, [string]>("SELECT sesion_compactada FROM messages WHERE id=?").get(respuesta)?.sesion_compactada).toBe(1);
  } finally { spawn.mockRestore(); }
});

test("también conserva resúmenes identificados por metadatos y evita presentarlos como entrega", async () => {
  const evento = { type: "text", sessionID: "ses_compacta", part: { type: "text", summary: true, text: "Resumen breve de contexto" } };
  expect(itemDeLinea(JSON.stringify(evento))).toMatchObject({ herramienta: "compaction", detalle: "Resumen breve de contexto" });
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ stdout: flujo([evento]), stderr: flujo([]), exited: Promise.resolve(0), pid: 2147483647 })) as unknown as typeof Bun.spawn);
  try {
    const result = await runOpenCode({ cwd: raiz, model: "opencode/prueba", prompt: "Continúa" });
    expect(result.text).toBe("");
    expect(result.textoFinal).toContain("sin una respuesta final");
    expect(result.textoFinal).not.toContain("Resumen breve");
  } finally { spawn.mockRestore(); }
});
