import { afterEach, expect, test } from "bun:test";
import { db } from "../src/db";
import type { ModelInfo } from "../src/models";
import { candidatosPorCuota, modeloSinCuota, modelosSinCuota, registrarCuotaModelo } from "../src/respaldos-cuota";

afterEach(() => db.query("DELETE FROM app_settings WHERE key='modelos_sin_cuota'").run());
const modelo = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, provider: id.split("/")[0], name: id, free: true, priceKnown: true, inputUsd: 0, outputUsd: 0, context: 100_000, variants: [], costTier: "gratis", costWarning: null, group: "Gratis", recommended: true, ...extra });

test("los respaldos elegidos van primero; los automáticos son gratis, conocidos y conectados", () => {
  const catalogo = [modelo("google/elegido"), modelo("opencode/automatico"), modelo("google/sin-precio", { priceKnown: false }), modelo("nvidia/desconectado"), modelo("google/pago", { free: false, inputUsd: 1 }), modelo("codex/plan", { free: false })];
  const conectados = new Set(["google", "opencode", "codex"]);
  expect(candidatosPorCuota(catalogo, ["google/elegido", "google/elegido", "google/pago"], "openai/agotado", conectados, new Set(), true).map((m) => m.id)).toEqual(["google/elegido", "opencode/automatico"]);
  expect(candidatosPorCuota(catalogo, ["codex/plan"], "openai/agotado", conectados, new Set(), true)[0].id).toBe("codex/plan");
});

test("se prueban hasta tres automáticos y se priorizan proveedores distintos", () => {
  const catalogo = [modelo("google/a"), modelo("google/b"), modelo("opencode/a"), modelo("nvidia/a"), modelo("groq/a")];
  const candidatos = candidatosPorCuota(catalogo, [], "google/agotado", new Set(["google", "opencode", "nvidia", "groq"]), new Set(), true);
  expect(candidatos).toHaveLength(3);
  expect(new Set(candidatos.map((m) => m.provider)).size).toBe(3);
  expect(candidatos.every((m) => m.provider !== "google")).toBe(true);
});

test("los modelos agotados no consumen los tres lugares automáticos", () => {
  const catalogo = [modelo("opencode/a"), modelo("opencode/b"), modelo("opencode/c"), modelo("opencode/d")];
  expect(candidatosPorCuota(catalogo, ["opencode/a"], "codex/agotado", new Set(["opencode"]), new Set(["opencode/a", "opencode/b", "opencode/c"]), true).map((m) => m.id)).toEqual(["opencode/d"]);
});

test("la pausa de cuota es persistente, caduca y separa proyectos", () => {
  const ahora = Date.now();
  registrarCuotaModelo("google/a", true, "proyecto-a", ahora);
  expect(modeloSinCuota("google/a", "proyecto-a", ahora + 1)).toBe(true);
  expect(modeloSinCuota("google/a", "proyecto-b", ahora + 1)).toBe(false);
  expect(modeloSinCuota("google/b", "proyecto-a", ahora + 1)).toBe(false);
  expect(modeloSinCuota("google/a", "proyecto-a", ahora + 15 * 60_000)).toBe(false);
  expect(db.query("SELECT value FROM app_settings WHERE key='modelos_sin_cuota'").get()).not.toBeNull();
});

test("una cuota no se atribuye a otro modelo y una respuesta válida libera su pausa", () => {
  registrarCuotaModelo("codex/a", true);
  expect(modeloSinCuota("codex/b")).toBe(false);
  expect(modelosSinCuota()).toEqual(new Set(["codex/a"]));
  registrarCuotaModelo("codex/a", false);
  expect(modeloSinCuota("codex/a")).toBe(false);
});
