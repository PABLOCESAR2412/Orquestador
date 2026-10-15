import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Login de Codex por código de dispositivo, con un CLI falso. El token que imprime el CLI nunca debe aparecer
// en las respuestas, y el archivo de sesión solo se comprueba por existencia.
const RAIZ = mkdtempSync(join(tmpdir(), "telo-login-codex-"));
const HOME_PRUEBA = join(RAIZ, "home");
const BIN_LENTO = join(RAIZ, "bin-lento");
const BIN_RAPIDO = join(RAIZ, "bin-rapido");
const BIN_VACIO = join(RAIZ, "bin-vacio");
for (const d of [HOME_PRUEBA, BIN_LENTO, BIN_RAPIDO, BIN_VACIO]) mkdirSync(d, { recursive: true });
process.env.HOME = HOME_PRUEBA;
process.env.DATA_DIR = join(RAIZ, "data");
const PATH_ORIGINAL = process.env.PATH;
const TOKEN = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
const ARCHIVO_SESION = join(HOME_PRUEBA, ".codex", "auth.json");

// Muestra URL y código y el token. El modo lento espera hasta que lo cancelen; el rápido escribe la sesión.
function cliFalso(dir: string, cuerpo: string) {
  const ruta = join(dir, "codex");
  writeFileSync(ruta, `#!/bin/sh\necho "Abre https://auth.ejemplo.test/device e introduce el código WXYZ-12345"\necho "token ${TOKEN}"\n${cuerpo}\n`);
  chmodSync(ruta, 0o755);
}
cliFalso(BIN_LENTO, "sleep 30");
cliFalso(BIN_RAPIDO, `mkdir -p "$HOME/.codex" && echo '{"sesion":"prueba"}' > "$HOME/.codex/auth.json"`);

const { providers: servidor } = await import("../src/routes/providers");

async function estado() {
  return (await servidor.request("/providers/codex/login")).json() as Promise<{
    estado: string;
    conectada: boolean;
    url: string | null;
    codigo: string | null;
    salida: string;
    motivo: string | null;
  }>;
}

async function esperar(pred: (e: Awaited<ReturnType<typeof estado>>) => boolean, ms = 8000) {
  const limite = Date.now() + ms;
  for (;;) {
    const e = await estado();
    if (pred(e) || Date.now() > limite) return e;
    await Bun.sleep(50);
  }
}

beforeAll(() => {
  process.env.PATH = `${BIN_VACIO}:/usr/bin:/bin`;
});

afterAll(() => {
  process.env.PATH = PATH_ORIGINAL;
  rmSync(RAIZ, { recursive: true, force: true });
});

describe("login de Codex", () => {
  test("sin CLI de Codex responde 503 con código legible", async () => {
    const res = await servidor.request("/providers/codex/login", { method: "POST" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("codex_no_instalado");
  });

  test("muestra URL y código, no deja iniciar dos veces y se puede cancelar", async () => {
    process.env.PATH = `${BIN_LENTO}:${BIN_VACIO}:/usr/bin:/bin`;
    const res = await servidor.request("/providers/codex/login", { method: "POST" });
    expect(res.status).toBe(202);

    const esperando = await esperar((e) => e.url !== null && e.codigo !== null);
    expect(esperando.estado).toBe("esperando");
    expect(esperando.url).toBe("https://auth.ejemplo.test/device");
    expect(esperando.codigo).toBe("WXYZ-12345");
    expect(esperando.salida).not.toContain(TOKEN);
    expect(esperando.salida).toContain("***");

    const dos = await servidor.request("/providers/codex/login", { method: "POST" });
    expect(dos.status).toBe(409);

    await servidor.request("/providers/codex/login", { method: "DELETE" });
    const cancelado = await esperar((e) => e.estado === "fallido");
    expect(cancelado.estado).toBe("fallido");
    expect(cancelado.motivo).toBe("cancelado");
    expect(existsSync(ARCHIVO_SESION)).toBe(false);
  });

  test("al terminar con archivo de sesión queda conectado, sin exponer el contenido", async () => {
    process.env.PATH = `${BIN_RAPIDO}:${BIN_VACIO}:/usr/bin:/bin`;
    await servidor.request("/providers/codex/login", { method: "POST" });
    const fin = await esperar((e) => e.estado === "conectado" || e.estado === "fallido");
    expect(fin.estado).toBe("conectado");
    expect(fin.conectada).toBe(true);

    const cuerpo = JSON.stringify(fin);
    expect(cuerpo).not.toContain("prueba");
    expect(cuerpo).not.toContain(TOKEN);
  });

  test("el proveedor codex refleja la sesión sin cambiar a activo (los agentes aún no lo usan)", async () => {
    const lista = (await (await servidor.request("/providers")).json()) as { id: string; configured: boolean; enAgente: boolean }[];
    const codex = lista.find((p) => p.id === "codex");
    expect(codex?.configured).toBe(true);
    expect(codex?.enAgente).toBe(false);
  });
});
