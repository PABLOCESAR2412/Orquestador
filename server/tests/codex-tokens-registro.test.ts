import { expect, spyOn, test } from "bun:test";
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = mkdtempSync(join(tmpdir(), "telo-codex-tokens-"));
const dataOriginal = process.env.DATA_DIR;
process.env.DATA_DIR = join(cwd, "data");
const { runCodex } = await import("../src/runners/codex");
const { ErrorAgente } = await import("../src/runners/opencode");
const { guardarTotalesSesion } = await import("../src/runners/tokens-codex");
const { db } = await import("../src/db");
afterAll(() => { db.close(); rmSync(cwd, { recursive: true, force: true }); if (dataOriginal === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = dataOriginal; });

function salidaFalsa(lineas: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(control) {
      for (const linea of lineas) control.enqueue(new TextEncoder().encode(linea + "\n"));
      control.close();
    },
  });
}

function procesoFalso(codigo: number): never {
  return {
    stdout: salidaFalsa([
      JSON.stringify({ type: "thread.started", thread_id: "11111111-2222-3333-4444-555555555555" }),
      JSON.stringify({ type: "token_count", info: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 } }),
      JSON.stringify({ type: "token_count", info: { input_tokens: 120, cached_input_tokens: 12, output_tokens: 9, reasoning_output_tokens: 4 } }),
      JSON.stringify({ type: "error", message: "HTTP 500 temporal" }),
    ]),
    stderr: new ReadableStream<Uint8Array>({ start(control) { control.close(); } }),
    exited: Promise.resolve(codigo),
    kill() {},
    pid: 999_999_999,
  } as never;
}

test("Codex deja registrado el gasto real aunque el turno muera a medias, una sola vez", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => procesoFalso(1)) as unknown as typeof Bun.spawn);

  const usos: Record<string, unknown>[] = [];
  const anteriorAislamiento = process.env.TELO_AISLAMIENTO;
  try {
    process.env.TELO_AISLAMIENTO = "desactivado";
    await expect(runCodex({
      prompt: "continua",
      model: "codex/gpt-6-luna",
      cwd,
      onUso: (uso) => usos.push({ ...uso, tokensMedidos: uso.tokensMedidos ?? false }),
    })).rejects.toThrow("Codex falló");

    // Es sesión nueva: la base es cero y el primer token_count ya contiene gasto nuevo.
    expect(usos).toEqual([
      { input: 120, output: 9, reasoning: 4, cacheRead: 12, cost: 0, costeDisponible: false, tokensMedidos: true },
    ]);
    // Una sola llamada al CLI: los reintentos y el respaldo viven a nivel ejecutar.
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    spawn.mockRestore();
    which.mockRestore();
    if (anteriorAislamiento === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anteriorAislamiento;
  }
});

test("resume resta el acumulado persistido antes de lanzar el CLI", async () => {
  const sid = "22222222-2222-3333-4444-555555555555";
  guardarTotalesSesion(sid, { input: 100, cached: 10, output: 5, reasoning: 2 });
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => procesoFalso(1)) as unknown as typeof Bun.spawn);
  const usos: unknown[] = [];
  const anterior = process.env.TELO_AISLAMIENTO;
  process.env.TELO_AISLAMIENTO = "desactivado";
  try {
    await expect(runCodex({ prompt: "continua", model: "codex/prueba", cwd, sessionId: sid, onUso: (u) => usos.push(u) })).rejects.toThrow("Codex falló");
    expect(usos).toEqual([{ input: 20, output: 4, reasoning: 2, cacheRead: 2, cost: 0, tokensMedidos: true, costeDisponible: false }]);
  } finally {
    spawn.mockRestore(); which.mockRestore();
    if (anterior === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anterior;
  }
});

test("Codex conserva el código estructurado de cuota agotada en su error", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({
    stdout: salidaFalsa([
      JSON.stringify({ type: "thread.started", thread_id: "11111111-2222-3333-4444-555555555555" }),
      JSON.stringify({
        type: "turn.failed",
        error: { code: "usage_limit_reached", message: "You've hit your ChatGPT usage limit. Try again later." },
      }),
    ]),
    stderr: salidaFalsa([]), exited: Promise.resolve(1), kill() {}, pid: 999_999_999,
  })) as unknown as typeof Bun.spawn);
  const anterior = process.env.TELO_AISLAMIENTO;
  process.env.TELO_AISLAMIENTO = "desactivado";
  try {
    let fallo: unknown;
    try {
      await runCodex({ prompt: "continua", model: "codex/gpt-6-luna", cwd });
    } catch (error) {
      fallo = error;
    }
    expect(fallo).toBeInstanceOf(ErrorAgente);
    expect((fallo as InstanceType<typeof ErrorAgente>).detalleProveedor).toContain("usage_limit_reached");
    expect((fallo as InstanceType<typeof ErrorAgente>).detalleProveedor).toContain("You've hit your ChatGPT usage limit");
    expect((fallo as InstanceType<typeof ErrorAgente>).detalleProveedor).not.toContain("11111111-2222-3333-4444-555555555555");
  } finally {
    spawn.mockRestore(); which.mockRestore();
    if (anterior === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anterior;
  }
});

test("descarta líneas enormes antes del parser y conserva el uso posterior", async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({
    stdout: salidaFalsa(["x".repeat(8 * 1024 * 1024), '{"type":"token_count","info":{"input_tokens":17}}', '{"type":"item.completed","item":{"type":"agent_message","text":"Lista"}}']),
    stderr: salidaFalsa([]), exited: Promise.resolve(0), kill() {}, pid: 999_999_999,
  })) as unknown as typeof Bun.spawn);
  const lineas: string[] = [];
  const usos: unknown[] = [];
  const anterior = process.env.TELO_AISLAMIENTO;
  process.env.TELO_AISLAMIENTO = "desactivado";
  try {
    const resultado = await runCodex({ prompt: "haz", model: "codex/prueba", cwd, onLinea: (l) => lineas.push(l), onUso: (u) => usos.push(u) });
    expect(resultado.text).toBe("Lista");
    expect(lineas).toHaveLength(2);
    expect(Math.max(...lineas.map((l) => l.length))).toBeLessThan(1000);
    expect(usos).toEqual([{ input: 17, output: 0, reasoning: 0, cacheRead: 0, cost: 0, tokensMedidos: true, costeDisponible: false }]);
  } finally {
    spawn.mockRestore(); which.mockRestore();
    if (anterior === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anterior;
  }
});

test("un descendiente con tuberías abiertas no retiene el cierre ni pierde los tokens", { timeout: 7000 }, async () => {
  const which = spyOn(Bun, "which").mockReturnValue("codex-falso");
  let canceladas = 0;
  let cierres = 0;
  const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({
    stdout: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"type":"token_count","info":{"input_tokens":13}}\n')); }, cancel() { canceladas++; } }),
    stderr: new ReadableStream({ cancel() { canceladas++; } }),
    exited: Promise.resolve(0), kill() { cierres++; }, pid: 999_999_999,
  })) as unknown as typeof Bun.spawn);
  const anterior = process.env.TELO_AISLAMIENTO;
  process.env.TELO_AISLAMIENTO = "desactivado";
  const usos: unknown[] = [];
  try {
    const inicio = Date.now();
    await runCodex({ prompt: "haz", model: "codex/prueba", cwd, onUso: (u) => usos.push(u) });
    expect(Date.now() - inicio).toBeLessThan(6500);
    expect(canceladas).toBe(2);
    expect(cierres).toBeGreaterThan(0);
    expect(usos).toEqual([{ input: 13, output: 0, reasoning: 0, cacheRead: 0, cost: 0, tokensMedidos: true, costeDisponible: false }]);
  } finally {
    spawn.mockRestore(); which.mockRestore();
    if (anterior === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anterior;
  }
});
