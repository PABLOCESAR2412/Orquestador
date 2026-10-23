import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "../src/api";
import { agruparPorProveedor, coincideModelo, normalizaBusca } from "../src/lib/busca-modelos";

const modelo = (sobre: Partial<ModelInfo> & Pick<ModelInfo, "id" | "provider" | "name" | "group">): ModelInfo => ({
  inputUsd: 0,
  outputUsd: 0,
  context: 0,
  variants: [],
  free: false,
  costTier: "medio",
  costWarning: null,
  recommended: true,
  ...sobre,
});

const catalogo = [
  modelo({ id: "openai/gpt-5", provider: "openai", name: "GPT-5", group: "GPT-5" }),
  modelo({ id: "anthropic/claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5", group: "Claude" }),
  modelo({ id: "opencode/xai/grok-4", provider: "opencode/xai", name: "Grok 4", group: "Grok" }),
];

describe("normalizaBusca", () => {
  test("baja a minúsculas y quita tildes", () => {
    expect(normalizaBusca("ConFiguración")).toBe("configuracion");
    expect(normalizaBusca("GroK-4")).toBe("grok-4");
  });

  test("deja intactos los espacios y los signos", () => {
    expect(normalizaBusca("GPT-5 mini")).toBe("gpt-5 mini");
  });
});

describe("coincideModelo", () => {
  test("busqueda vacía coincide con todo", () => {
    expect(coincideModelo(catalogo[0], "  ")).toBe(true);
  });

  test("coincide por nombre y por id sin mirar tildes ni mayúsculas", () => {
    expect(coincideModelo(catalogo[0], "gpt-5")).toBe(true);
    expect(coincideModelo(catalogo[1], "claude sonnet")).toBe(true);
    expect(coincideModelo(catalogo[1], "antropic")).toBe(false);
  });

  test("coincide por familia y por nombre visible del proveedor", () => {
    expect(coincideModelo(catalogo[1], "claude")).toBe(true);
    expect(coincideModelo(catalogo[1], "anthropic")).toBe(true);
    expect(coincideModelo(catalogo[2], "xai")).toBe(true);
    expect(coincideModelo(catalogo[2], "opencodexai")).toBe(false);
  });

  test("un texto sin coincidencias devuelve false", () => {
    expect(coincideModelo(catalogo[0], "mistrall")).toBe(false);
  });
});

describe("agruparPorProveedor", () => {
  test("conserva el orden del catálogo en la primera aparición de cada proveedor", () => {
    const grupos = agruparPorProveedor(catalogo);
    expect(grupos.map(([proveedor]) => proveedor)).toEqual(["openai", "anthropic", "opencode/xai"]);
    expect(grupos[0]![1].map((m) => m.id)).toEqual(["openai/gpt-5"]);
  });

  test("apila varios modelos del mismo proveedor en un solo grupo", () => {
    const grupos = agruparPorProveedor([catalogo[0], catalogo[1], catalogo[0]]);
    expect(grupos.length).toBe(2);
    expect(grupos[0]![1].length).toBe(2);
  });
});
