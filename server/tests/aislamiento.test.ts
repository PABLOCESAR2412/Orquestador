import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
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
const { eliminarPerfilOpenCode, prepararPerfilOpenCode, prefijoAislamiento, prepararDirectorioOpenCode } = await import("../src/runners/aislamiento");

test("rechaza .opencode enlazado antes de permitir su runtime", () => {
  const carpeta = join(proyectos, "enlace-opencode");
  const destino = join(raiz, "fuera");
  mkdirSync(carpeta, { recursive: true }); mkdirSync(destino);
  symlinkSync(destino, join(carpeta, ".opencode"), process.platform === "win32" ? "junction" : "dir");
  expect(() => prepararDirectorioOpenCode(carpeta)).toThrow("no es segura");
});

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
  const gitignore = join(configSubagentes, ".gitignore");
  const gitignoreMount = args.indexOf(gitignore);
  expect(existsSync(gitignore)).toBe(true);
  expect(args[gitignoreMount - 1]).toBe("--bind");
  expect(args[gitignoreMount + 1]).toBe("/tmp/telo-opencode-config/.gitignore");
  expect(args).toContain("--ro-bind");
  eliminarPerfilOpenCode("chat-con-bwrap");
});

test.skipIf(process.platform === "win32" || !Bun.which("bwrap"))("oculta el archivo de entorno y la clave privada de la GitHub App, y no los reexpone por lectura extra", () => {
  const workspace = join(proyectos, "repo");
  mkdirSync(workspace, { recursive: true });
  const claveApp = join(raiz, "clave-app-simulada.pem");
  writeFileSync(claveApp, "-----BEGIN PRIVATE KEY-----\nsimulada\n-----END PRIVATE KEY-----\n");
  const extraOculto = join(raiz, "sensibles-extra");
  mkdirSync(extraOculto, { recursive: true });
  const previos = {
    clave: process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH,
    ocultar: process.env.TELO_OCULTAR_EXTRA,
    leer: process.env.TELO_LECTURA_EXTRA,
  };
  process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH = claveApp;
  process.env.TELO_OCULTAR_EXTRA = extraOculto;
  process.env.TELO_LECTURA_EXTRA = [claveApp, extraOculto].join(":");
  try {
    const args = prefijoAislamiento(workspace);
    for (const ruta of ["/etc/orquestador", claveApp, extraOculto]) {
      if (!existsSync(ruta)) continue;
      const indice = args.indexOf(ruta);
      expect(indice).toBeGreaterThan(0);
      expect(args[indice - 1]).toBe("--tmpfs");
    }
    expect(args.filter((a) => a === claveApp).length).toBe(1);
    expect(args.filter((a) => a === extraOculto).length).toBe(1);
  } finally {
    if (previos.clave === undefined) delete process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH;
    else process.env.TELO_GITHUB_APP_PRIVATE_KEY_PATH = previos.clave;
    if (previos.ocultar === undefined) delete process.env.TELO_OCULTAR_EXTRA;
    else process.env.TELO_OCULTAR_EXTRA = previos.ocultar;
    if (previos.leer === undefined) delete process.env.TELO_LECTURA_EXTRA;
    else process.env.TELO_LECTURA_EXTRA = previos.leer;
  }
});

test.skipIf(process.platform === "win32" || !Bun.which("bwrap"))("el seguimiento permite escribir solo su captura y mantiene plugin y configuración de solo lectura", () => {
  const workspace = join(proyectos, "seguimiento");
  const temporal = join(config.dataDir, "perfiles-mcp", "prueba-seguimiento");
  mkdirSync(workspace, { recursive: true }); mkdirSync(temporal, { recursive: true });
  const archivo = join(temporal, "opencode.json"), captura = join(temporal, "actividad.ndjson"), plugin = join(temporal, "seguimiento.js");
  for (const ruta of [archivo, captura, plugin]) writeFileSync(ruta, "");
  const args = prefijoAislamiento(workspace, false, [], undefined, undefined, undefined, archivo, captura);
  for (const ruta of [archivo, plugin]) expect(args[args.indexOf(ruta) - 1]).toBe("--ro-bind");
  expect(args[args.indexOf(captura) - 1]).toBe("--bind");
  expect(args[args.indexOf(captura) + 1]).toBe("/tmp/telo-mcp-config/actividad.ndjson");
  rmSync(captura); symlinkSync(join(home, ".local/share/opencode/auth.json"), captura);
  expect(() => prefijoAislamiento(workspace, false, [], undefined, undefined, undefined, archivo, captura)).toThrow("registro temporal");
});
