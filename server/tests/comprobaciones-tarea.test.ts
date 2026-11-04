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

test("los workspaces de Bun se instalan una sola vez desde su raíz", () => {
  const cwd = mkdtempSync(join(tmpdir(), "telo-workspaces-"));
  try {
    mkdirSync(join(cwd, "apps", "web"), { recursive: true });
    mkdirSync(join(cwd, "packages", "ui"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ workspaces: ["apps/*", "packages/*"], packageManager: "bun@1.4.0" }));
    writeFileSync(join(cwd, "bun.lock"), "");
    for (const carpeta of ["apps/web", "packages/ui"])
      writeFileSync(join(cwd, carpeta, "package.json"), JSON.stringify({ dependencies: { react: "*" } }));
    const avisos = revisarDependencias(cwd);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("en la raíz");
    expect(avisos[0]).toContain("Si la tarea requiere compilar o ejecutar pruebas");
    expect(avisos[0]).toContain("bun install --frozen-lockfile");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
