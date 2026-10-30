import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_PRUEBA = join(tmpdir(), `telo-subagentes-${crypto.randomUUID()}`);
process.env.DATA_DIR = DATA_PRUEBA;
const { prepararSubagentes, pideSubagentes } = await import("../src/subagentes");
type Modelo = (Awaited<ReturnType<typeof import("../src/models").getModels>>)[number];

afterAll(() => rmSync(DATA_PRUEBA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const catalogo = async (): Promise<Modelo[]> => [
  {
    id: "openai/gpt-4.1-mini", name: "GPT 4.1 Mini", provider: "openai", inputUsd: 0,
    outputUsd: 0, context: 1000, variants: ["high"], free: true, costTier: "gratis",
    costWarning: null, group: "GPT", recommended: true,
  },
  {
    id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", inputUsd: 0,
    outputUsd: 0, context: 1000, variants: ["high"], free: true, costTier: "gratis",
    costWarning: null, group: "DeepSeek", recommended: true,
  },
];

describe("subagentes solicitados por el usuario", () => {
  test("solo prepara perfiles cuando la petición pide delegar", () => {
    expect(pideSubagentes("Analiza el proyecto" )).toBe(false);
    expect(pideSubagentes("Usa varios subagentes para revisar esto" )).toBe(true);
  });

  test("crea perfiles efímeros con los modelos expresamente nombrados", async () => {
    const perfiles = await prepararSubagentes({
      prompt: "Usa subagentes en paralelo: openai/gpt-4.1-mini y deepseek/deepseek-v4-flash",
      modelo: "google/gemini-test",
      esfuerzo: "high",
      idEjecucion: "ejecucion-prueba",
      listarModelos: catalogo,
      directorioBase: DATA_PRUEBA,
    });
    expect(perfiles?.instruccion).toContain("openai/gpt-4.1-mini");
    expect(perfiles?.instruccion).toContain("deepseek/deepseek-v4-flash");
    expect(perfiles?.instruccion).toContain("continúa esa misma sesión con una instrucción de corrección concreta una sola vez");
    expect(perfiles?.instruccion).toContain("No crees un reemplazo");
    const agentes = readdirSync(join(DATA_PRUEBA, "perfiles-subagente", "ejecucion-prueba", "agents"));
    expect(agentes).toHaveLength(2);
    const perfilesMd = agentes.map((archivo) => readFileSync(join(DATA_PRUEBA, "perfiles-subagente", "ejecucion-prueba", "agents", archivo), "utf8"));
    expect(perfilesMd.every((contenido) => contenido.includes("limita la autocorrección a dos intentos"))).toBe(true);
    expect(perfilesMd.some((contenido) => contenido.includes('model: "openai/gpt-4.1-mini#high"'))).toBe(true);
    expect(perfilesMd.some((contenido) => contenido.includes('model: "deepseek/deepseek-v4-flash#high"'))).toBe(true);
    const config = JSON.parse(readFileSync(join(DATA_PRUEBA, "perfiles-subagente", "ejecucion-prueba", "opencode.json"), "utf8")) as {
      permission: { task: Record<string, string> };
    };
    expect(config.permission.task).toEqual({
      "*": "deny",
      "telo-deepseek-v4-flash-1": "allow",
      "telo-gpt-4-1-mini-2": "allow",
    });
    const plugin = readFileSync(join(DATA_PRUEBA, "perfiles-subagente", "ejecucion-prueba", "plugins", "telo-subagentes.js"), "utf8");
    expect(plugin).toContain("if (!hijos.has(id))");
    expect(plugin).toContain("const LIMITE_BYTES = 8 * 1024 * 1024");
    expect(plugin).toContain("const LIMITE_LINEA = 32 * 1024");
    perfiles?.limpiar();
    expect(() => readdirSync(join(DATA_PRUEBA, "perfiles-subagente", "ejecucion-prueba"))).toThrow();
  });
});
