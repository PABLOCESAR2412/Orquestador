import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { pluginSeguimientoOpenCode } from "../src/runners/seguimiento-opencode";

const raiz = mkdtempSync(join(tmpdir(), "telo-seguimiento-"));
const previos = { DATA_DIR: process.env.DATA_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO };
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_AISLAMIENTO = "desactivado";
const { runOpenCode } = await import("../src/runners/opencode");
const { itemDeLinea } = await import("../src/actividad");
const { db } = await import("../src/db");
const { registrarUsoAgente } = await import("../src/registro-uso-agente");
afterAll(() => {
  db.close();
  for (const [k, v] of Object.entries(previos)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(raiz, { recursive: true, force: true });
});

test("el plugin filtra hijos, limita eventos y no copia texto parcial ni razonamiento", async () => {
  const salida = join(raiz, "eventos.ndjson"), plugin = join(raiz, "plugin.js");
  writeFileSync(salida, ""); writeFileSync(plugin, pluginSeguimientoOpenCode(salida, "ses_padre"));
  const { TeloSeguimiento } = await import(pathToFileURL(plugin).href);
  const hooks = await TeloSeguimiento();
  const enviar = (type: string, properties: unknown) => hooks.event({ event: { type, properties } });
  await enviar("session.status", { sessionID: "ses_hijo", status: { type: "retry", attempt: 99 } });
  await enviar("message.part.delta", { sessionID: "ses_padre", field: "reasoning", delta: "razonamiento privado" });
  for (let n = 0; n < 20; n++) await enviar("message.part.delta", { sessionID: "ses_padre", delta: "texto parcial secreto" });
  for (let n = 0; n < 2; n++) await enviar("message.part.updated", { part: { sessionID: "ses_padre", type: "tool", callID: "c1", tool: "bash", state: { status: "running", input: { command: "bun test", content: "archivo gigante" } } } });
  await enviar("session.status", { sessionID: "ses_padre", status: { type: "retry", attempt: 1, message: "HTTP 503", next: 123 } });
  await enviar("session.status", { sessionID: "ses_padre", status: { type: "idle" } });
  const texto = readFileSync(salida, "utf8"), eventos = texto.trim().split("\n").map(linea => JSON.parse(linea));
  expect(eventos).toHaveLength(4);
  expect(texto).not.toMatch(/ses_hijo|razonamiento privado|texto parcial secreto|archivo gigante/);
  expect(eventos[1]).toMatchObject({ part: { callID: "c1", state: { status: "running", input: { command: "bun test" } } } });
  expect(itemDeLinea(JSON.stringify(eventos[2]))).toMatchObject({ herramienta: "provider", titulo: "El proveedor reintenta la solicitud (1/3)", estado: "en_curso" });
});

test("un runner sin subagentes publica herramientas en curso y mantiene resultado y sesión", async () => {
  const lineas: string[] = [];
  const spawn = spyOn(Bun, "spawn").mockImplementation(((_args: unknown, opts: { env: Record<string, string> }) => {
    const conf = JSON.parse(readFileSync(opts.env.OPENCODE_CONFIG, "utf8"));
    const plugin = fileURLToPath(conf.plugin[0]);
    const exited = (async () => {
      const { TeloSeguimiento } = await import(pathToFileURL(plugin).href);
      const hooks = await TeloSeguimiento();
      await hooks.event({ event: { type: "session.status", properties: { sessionID: "ses_nueva", status: { type: "busy" } } } });
      await hooks.event({ event: { type: "message.part.updated", properties: { part: { sessionID: "ses_nueva", type: "tool", tool: "bash", callID: "cmd1", state: { status: "running", input: { command: "bun test" } } } } } });
      await Bun.sleep(300);
      expect(lineas.some(l => l.includes('"running"'))).toBe(true);
      return 0;
    })();
    return { pid: 2147483647, stdout: new Blob([JSON.stringify({ type: "text", sessionID: "ses_nueva", part: { text: "Resultado final" } }) + "\n"]).stream(), stderr: new Blob([]).stream(), exited };
  }) as unknown as typeof Bun.spawn);
  try {
    const result = await runOpenCode({ cwd: raiz, model: "opencode/prueba", prompt: "Analiza", timeoutMs: null, tiempoSinActividadMs: null, onLinea: l => lineas.push(l) });
    expect(result.textoFinal).toBe("Resultado final"); expect(result.sessionId).toBe("ses_nueva");
    expect(lineas.map(itemDeLinea).some(item => item?.tipo === "accion" && item.estado === "en_curso")).toBe(true);
  } finally { spawn.mockRestore(); }
});

test("tres fallos internos explícitos cierran con error recuperable sin esperar indefinidamente", async () => {
  let sesion: string | null = null;
  const spawn = spyOn(Bun, "spawn").mockImplementation(((_args: unknown, opts: { env: Record<string, string> }) => {
    const conf = JSON.parse(readFileSync(opts.env.OPENCODE_CONFIG, "utf8"));
    const captura = join(fileURLToPath(new URL(".", conf.plugin[0])), "actividad.ndjson");
    writeFileSync(captura, [1, 2, 3].map(attempt => JSON.stringify({ type: "telo.provider", sessionID: "ses_guardada", status: "retry", attempt, message: "Error temporal" })).join("\n") + "\n");
    return { pid: 2147483647, stdout: new Blob([]).stream(), stderr: new Blob([]).stream(), exited: new Promise(() => {}) };
  }) as unknown as typeof Bun.spawn);
  try {
    await expect(runOpenCode({ cwd: raiz, model: "opencode/prueba", prompt: "Analiza", timeoutMs: null, tiempoSinActividadMs: null, onSesion: id => { sesion = id; } })).rejects.toThrow("tres reintentos internos");
    expect(String(sesion)).toBe("ses_guardada");
  } finally { spawn.mockRestore(); }
});

test("un paso de uso repetido se suma una vez, también después de reanudar", async () => {
  const evento = (id: string) => JSON.stringify({ type: "step_finish", sessionID: "ses_uso_unico", part: { id, type: "step-finish", tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0 } }, cost: 0 } });
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ pid: 2147483647, stdout: new Blob([[evento("prt_uno"), evento("prt_uno"), evento("prt_dos"), JSON.stringify({ type: "text", sessionID: "ses_uso_unico", part: { text: "Resultado" } })].join("\n") + "\n"]).stream(), stderr: new Blob([]).stream(), exited: Promise.resolve(0) })) as unknown as typeof Bun.spawn);
  try {
    for (let n = 0; n < 2; n++) {
      let registros = 0;
      const r = await runOpenCode({ cwd: raiz, model: "google/prueba", prompt: "Consulta", timeoutMs: null, onUso: (uso) => {
        registros++;
        registrarUsoAgente("google/prueba", uso, { providerEventId: uso.providerEventId });
      } });
      expect(r.usage?.input).toBe(200);
      expect(registros).toBe(2);
    }
    expect(db.query("SELECT COUNT(*) AS n,SUM(input_tokens) AS tokens FROM usage WHERE provider_event_id LIKE 'opencode:step:ses_uso_unico:%'").get()).toEqual({ n: 2, tokens: 200 });
  } finally { spawn.mockRestore(); }
});

test("un cierre exitoso de OpenCode sin respuesta visible se informa como error recuperable", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({
    pid: 2147483647,
    stdout: new Blob([]).stream(),
    stderr: new Blob([]).stream(),
    exited: Promise.resolve(0),
  })) as unknown as typeof Bun.spawn);
  try {
    await expect(runOpenCode({ cwd: raiz, model: "google/gemini-3.1-flash-lite", prompt: "Analiza", timeoutMs: null, tiempoSinActividadMs: null }))
      .rejects.toThrow("el proveedor no devolvió texto final");
  } finally { spawn.mockRestore(); }
});