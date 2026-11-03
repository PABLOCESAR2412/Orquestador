import { expect, test } from "bun:test";
import { parsearModelosAntigravity } from "../src/modelos-antigravity";

test("parsea el catálogo JSON de Antigravity con nombres, contextos y esfuerzos admitidos", () => {
  expect(parsearModelosAntigravity(JSON.stringify({ models: [
    { id: "gemini-pro", display_name: "Gemini Pro", context_window: 128000, variants: { low: {}, high: {}, xhigh: {} } },
    { id: "gemini-pro", display_name: "duplicado" },
  ] }))).toEqual([
    { id: "gemini-pro", name: "Gemini Pro", context: 128000, variants: ["low", "high"] },
  ]);
});

test("mantiene modelos del catálogo de texto de versiones sin salida JSON", () => {
  expect(parsearModelosAntigravity([
    "gemini-4-argon-high       Gemini 4 Argon (High)",
    "grok-4-fast                Grok 4 Fast",
    "texto sin identificador",
  ].join("\n"))).toEqual([
    { id: "gemini-4-argon", name: "Gemini 4 Argon", context: 0, variants: ["high"] },
    { id: "grok-4-fast", name: "Grok 4 Fast", context: 0, variants: [] },
  ]);
});
