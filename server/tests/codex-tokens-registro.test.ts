import { expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "../src/runners/codex";

const cwd = mkdtempSync(join(tmpdir(), "telo-codex-tokens-"));

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

    // El turno no completó ningún `turn.completed`: el delta entre la base de esta ejecución
    // y el último token_count es el gasto pendiente (20 input, 2 cacheados, 4 salida, 2 razonamiento).
    expect(usos).toEqual([
      { input: 20, output: 4, reasoning: 2, cacheRead: 2, cost: 0, costeDisponible: false, tokensMedidos: true },
    ]);
    // Una sola llamada al CLI: los reintentos y el respaldo viven a nivel ejecutar.
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    spawn.mockRestore();
    which.mockRestore();
    if (anteriorAislamiento === undefined) delete process.env.TELO_AISLAMIENTO; else process.env.TELO_AISLAMIENTO = anteriorAislamiento;
  }
});
