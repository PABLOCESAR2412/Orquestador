import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("el worker atribuye actividad, subchats y tarjetas al turno de cada tarea en cola", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-worker-turnos-"));
  try {
    const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "fixtures/worker-turnos.ts")], {
      env: { ...process.env, DATA_DIR: join(carpeta, "data") }, stdout: "pipe", stderr: "pipe",
    });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
    expect(salida).toContain("turnos de tareas verificados");
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
}, 20_000);
