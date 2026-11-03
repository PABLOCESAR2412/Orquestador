import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = mkdtempSync(join(tmpdir(), "telo-commandcode-"));
process.env.DATA_DIR = join(raiz, "data");
process.env.HOME = join(raiz, "home");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { parsearModelosCommandCode } = await import("../src/modelos-commandcode");
const { usoCommandCode } = await import("../src/runners/commandcode");
const { autenticacionCommandCode, prepararPerfilCommandCode } = await import("../src/runners/aislamiento");

afterAll(() => rmSync(raiz, { recursive: true, force: true }));

test("lee modelos de Command Code y omite modelos de decisión no conversacionales", () => {
  const modelos = parsearModelosCommandCode([
    "Available models · 3 models",
    "nvidia/nemotron-3.5  NVIDIA Nemotron 3.5",
    "xai/grok-4.1-fast  xAI Grok 4.1 Fast",
    "Decision models (headless only)",
    "typesafe/jev  Jev",
  ].join("\n"));
  expect(modelos).toEqual([
    { id: "nvidia/nemotron-3.5", nombre: "NVIDIA Nemotron 3.5" },
    { id: "xai/grok-4.1-fast", nombre: "xAI Grok 4.1 Fast" },
  ]);
});

test("registra el uso de tokens entregado por Command Code sin inventar costo", () => {
  expect(usoCommandCode({ input_tokens: 150, output_tokens: 30, reasoning_tokens: 12 })).toEqual({
    input: 150,
    output: 30,
    reasoning: 12,
    cacheRead: 0,
    cost: 0,
    tokensMedidos: true,
    costeDisponible: false,
  });
  expect(usoCommandCode({})).toBeNull();
});

test("crea un perfil persistente con política inmutable y exige auth JSON regular", () => {
  const authDir = join(process.env.HOME!, ".commandcode");
  mkdirSync(authDir, { recursive: true });
  const auth = join(authDir, "auth.json");
  writeFileSync(auth, "{}");
  expect(autenticacionCommandCode()).toBeNull();
  writeFileSync(auth, JSON.stringify({ session: "fake-token-not-printed" }), { mode: 0o600 });
  expect(autenticacionCommandCode()).toBe(auth);

  const perfil = prepararPerfilCommandCode("conversacion-commandcode");
  const settings = JSON.parse(readFileSync(join(perfil, ".commandcode", "settings.json"), "utf8")) as {
    permissions: { deny: string[] };
  };
  expect(settings.permissions.deny).toContain("Read(//tmp/telo-commandcode-home/.commandcode/auth.json)");
  expect(settings.permissions.deny).toContain("Shell(git push:*)");
  expect(settings.permissions.deny).toContain("Shell(wrangler deploy:*)");
});
