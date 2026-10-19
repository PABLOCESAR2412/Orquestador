import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-aislamiento-"));
const originales = {
  DATA_DIR: process.env.DATA_DIR,
  TELO_PROYECTOS_DIR: process.env.TELO_PROYECTOS_DIR,
  HOME: process.env.HOME,
  TELO_AISLAMIENTO: process.env.TELO_AISLAMIENTO,
};
const home = join(raiz, "home");
const proyectos = join(raiz, "proyectos");
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = proyectos;
process.env.HOME = home;
process.env.TELO_AISLAMIENTO = "activado";
mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
mkdirSync(proyectos, { recursive: true });
writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), '{"openai":{"key":"credencial-local"}}');

const { config } = await import("../src/config");
const { eliminarPerfilOpenCode, prepararPerfilOpenCode, prefijoAislamiento } = await import("../src/runners/aislamiento");

afterAll(() => {
  for (const [clave, valor] of Object.entries(originales)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("mantiene un perfil de estado por conversación y permite purgarlo", () => {
  const uno = prepararPerfilOpenCode("conversacion-uno");
  const dos = prepararPerfilOpenCode("conversacion-dos");
  expect(uno).not.toBe(dos);
  expect(uno).toStartWith(join(config.dataDir, "perfiles-opencode"));
  expect(existsSync(join(uno, "data", "opencode"))).toBe(true);
  expect(existsSync(join(uno, "state", "opencode"))).toBe(true);
  expect(existsSync(join(uno, "cache", "opencode"))).toBe(true);
  eliminarPerfilOpenCode("conversacion-uno");
  expect(existsSync(uno)).toBe(false);
  eliminarPerfilOpenCode("conversacion-dos");
});

test.skipIf(process.platform === "win32" || !Bun.which("bwrap"))("monta el perfil de OpenCode y las credenciales originales en solo lectura", () => {
  const workspace = join(proyectos, "repo");
  mkdirSync(workspace, { recursive: true });
  const perfil = prepararPerfilOpenCode("chat-con-bwrap");
  const configSubagentes = join(config.dataDir, "perfiles-subagente", "prueba");
  mkdirSync(join(configSubagentes, "agents"), { recursive: true });
  const args = prefijoAislamiento(workspace, false, [], perfil, configSubagentes);
  const authOriginal = join(home, ".local", "share", "opencode", "auth.json");

  expect(args).toContain("/tmp/telo-opencode-profile");
  expect(args).toContain(perfil);
  expect(args).toContain(authOriginal);
  expect(args).toContain(join("/tmp/telo-opencode-profile", "data", "opencode", "auth.json"));
  expect(args).toContain(configSubagentes);
  expect(args).toContain("/tmp/telo-opencode-config");
  expect(args).toContain("--ro-bind");
  eliminarPerfilOpenCode("chat-con-bwrap");
});
