import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consultarGraphify } from "../src/graphify-context";

test("consulta solo el grafo del workspace y devuelve nodos relacionados con sus fuentes", () => {
  const raiz = mkdtempSync(join(tmpdir(), "telo-graphify-"));
  try {
    const carpeta = join(raiz, "graphify-out");
    mkdirSync(carpeta);
    writeFileSync(join(carpeta, "graph.json"), JSON.stringify({
      nodes: [
        { id: "seguir", label: "seguir()", source_file: "server/src/routes/chat.ts", source_location: "L1547" },
        { id: "cuota", label: "modelo agotado" },
        { id: "unrelated", label: "renderizar gráfico" },
      ],
      links: [{ source: "seguir", target: "cuota", relation: "reads" }],
    }));

    const resultado = consultarGraphify(raiz, "¿Por qué falla seguir cuando se agota la cuota?");
    expect(resultado.estado).toBe("consultado");
    expect(resultado.contexto).toContain("server/src/routes/chat.ts:1547");
    expect(resultado.contexto).toContain("seguir() —reads→ modelo agotado");
    expect(resultado.contexto).not.toContain("renderizar gráfico");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("continúa con claridad cuando el proyecto aún no tiene grafo", () => {
  const raiz = mkdtempSync(join(tmpdir(), "telo-graphify-"));
  try {
    expect(consultarGraphify(raiz, "Revisa errores del chat")).toMatchObject({ estado: "ausente", contexto: "" });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

