import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { comprobarHerramientas, revisarDependencias } from "../src/comprobaciones-tarea";

test("detecta dependencias ausentes en un monorepo antes de las pruebas", () => {
  const cwd = mkdtempSync(join(tmpdir(), "telo-preparacion-"));
  try {
    const web = join(cwd, "web");
    mkdirSync(web);
    writeFileSync(join(web, "package.json"), JSON.stringify({ dependencies: { react: "*" }, packageManager: "bun@1.4.0" }));
    writeFileSync(join(web, "bun.lock"), "");
    expect(revisarDependencias(cwd).join(" ")).toContain("bun install --frozen-lockfile");
    mkdirSync(join(web, "node_modules"));
    expect(revisarDependencias(cwd)).toEqual([]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("explica manifiestos dañados y herramientas que faltan", () => {
  const cwd = mkdtempSync(join(tmpdir(), "telo-preparacion-"));
  const which = spyOn(Bun, "which").mockReturnValue(null);
  try {
    writeFileSync(join(cwd, "package.json"), "{invalido");
    expect(revisarDependencias(cwd)[0]).toContain("Revisa su formato");
    const errores = comprobarHerramientas(true).join(" ");
    expect(errores).toContain("Falta opencode");
    expect(errores).toContain("Falta git");
  } finally { which.mockRestore(); rmSync(cwd, { recursive: true, force: true }); }
});
