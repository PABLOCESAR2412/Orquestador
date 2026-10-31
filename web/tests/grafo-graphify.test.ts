import { describe, expect, test } from "bun:test";
import { leerGrafoGraphify } from "../src/components/grafo-graphify";

describe("importación Graphify", () => {
  test("conserva relaciones reales y descarta enlaces sin destino", () => {
    const grafo = leerGrafoGraphify(JSON.stringify({ nodes: [{ id: "a", label: "función", source_file: "a.ts" }, { id: "b" }], links: [{ source: "a", target: "b", relation: "calls" }, { source: "a", target: "inexistente" }] }));
    expect(grafo.nodes).toHaveLength(2);
    expect(grafo.links).toEqual([{ source: "a", target: "b", relation: "calls" }]);
  });
  test("rechaza archivos que no son grafos", () => {
    expect(() => leerGrafoGraphify('{"nodes":[],"links":[]}')).toThrow();
    expect(() => leerGrafoGraphify('{"nodes":{}}')).toThrow();
  });
});
