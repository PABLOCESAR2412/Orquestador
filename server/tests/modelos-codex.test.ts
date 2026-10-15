import { expect, test } from "bun:test";
import { parsearCatalogoCodex } from "../src/modelos-codex";

test("muestra solo modelos Codex disponibles para API y conserva contexto y esfuerzo", () => {
  const modelos = parsearCatalogoCodex(JSON.stringify({ models: [
    {
      slug: "gpt-5-codex",
      display_name: "GPT-5 Codex",
      context_window: 272_000,
      supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }],
    },
    { slug: "oculto", visibility: "hide" },
    { slug: "solo-app", supported_in_api: false },
    { slug: "gpt-5-codex", display_name: "Duplicado" },
  ] }));
  expect(modelos).toEqual([{ id: "gpt-5-codex", name: "GPT-5 Codex", context: 272_000, variants: ["medium", "high"] }]);
});
