import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-delegacion-"));
const anterior = { DATA_DIR: process.env.DATA_DIR, TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO, OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT };
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_AISLAMIENTO = "desactivado";
const { runOpenCode } = await import("../src/runners/opencode");
const { db } = await import("../src/db");
afterAll(() => {
  db.close();
  for (const [clave, valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  }
  rmSync(raiz, { recursive: true, force: true });
});

test("cada ejecución deniega task, incluso al reanudar y con permisos globales previos", async () => {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ theme: "prueba", small_model: "opencode/oculto", permission: { task: "allow" }, agent: { build: { model: "opencode/oculto", permission: { task: "allow" } }, title: { model: "opencode/oculto" }, compaction: { model: "opencode/oculto" } } });
  let comando: string[] = [];
  let env: Record<string, string> = {};
  const spawn = spyOn(Bun, "spawn").mockImplementation(((args: string[], opts: { env: Record<string, string> }) => {
    comando = args; env = opts.env; throw new Error("captura-sin-proveedor");
  }) as unknown as typeof Bun.spawn);
  try {
    await expect(runOpenCode({ prompt: "Genera un video", model: "opencode/prueba", cwd: raiz, sessionId: "ses_previa" })).rejects.toThrow("captura-sin-proveedor");
    expect(comando.slice(comando.indexOf("--agent"), comando.indexOf("--agent") + 2)).toEqual(["--agent", "build"]);
    expect(comando).toContain("ses_previa");
    const inline = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(inline.theme).toBe("prueba");
    expect(inline.permission.task).toBe("deny");
    expect(inline.agent.build.permission.task).toBe("deny");
    expect(inline.model).toBe("opencode/prueba");
    expect(inline.small_model).toBe("opencode/prueba");
    for (const nombre of ["build", "plan", "title", "summary", "compaction", "explore", "general"]) expect(inline.agent[nombre].model).toBe("opencode/prueba");
    expect(inline.agent.title.disable).toBe(true);
    expect(inline.agent.summary.disable).toBe(true);
  } finally { spawn.mockRestore(); }
});

test("solo habilita los alias temporales de la petición autorizada", async () => {
  const perfil = join(raiz, "perfil");
  mkdirSync(perfil);
  writeFileSync(join(perfil, "opencode.json"), JSON.stringify({ permission: { task: { "*": "allow", "telo-seguridad-1": "allow", "otro-agente": "allow" } } }));
  let task: unknown;
  const spawn = spyOn(Bun, "spawn").mockImplementation(((_args: string[], opts: { env: Record<string, string> }) => {
    task = JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT).agent.build.permission.task; throw new Error("captura-sin-proveedor");
  }) as unknown as typeof Bun.spawn);
  try {
    await expect(runOpenCode({ prompt: "Usa un subagente", model: "opencode/prueba", cwd: raiz, opencodeConfigDir: perfil })).rejects.toThrow("captura-sin-proveedor");
    expect(task).toEqual({ "*": "deny", "telo-seguridad-1": "allow" });
  } finally { spawn.mockRestore(); }
});
