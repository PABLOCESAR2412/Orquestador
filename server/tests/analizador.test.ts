import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// El worker es único por proceso, así que el flujo completo corre en un proceso propio con un
// `opencode` falso al frente del PATH (server/tests/fixtures/bin/opencode). Requiere setsid (Linux).
describe.skipIf(!Bun.which("setsid"))("analizador y obrero, extremo a extremo", () => {
  test(
    "planes, aprobaciones, desviaciones, reportes y tope de replanificación",
    async () => {
      const raiz = join(tmpdir(), "telo-pruebas-analizador");
      rmSync(raiz, { recursive: true, force: true });
      mkdirSync(raiz, { recursive: true });

      const carpetaFixtures = join(import.meta.dir, "fixtures");
      const proc = Bun.spawn([process.execPath, "run", join(carpetaFixtures, "analizador-e2e.ts")], {
        env: {
          ...process.env,
          DATA_DIR: join(raiz, "data"),
          TELO_PROYECTOS_DIR: join(raiz, "proyectos"),
          TELO_AISLAMIENTO: "desactivado",
          PATH: `${join(carpetaFixtures, "bin")}${delimiter}${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [salida, errores, codigo] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // Si falla, el mensaje indica qué comprobación no se cumplió.
      expect(codigo, `${errores}\n${salida}`).toBe(0);
      expect(salida).toContain("comprobaciones correctas");
    },
    120_000,
  );
});
