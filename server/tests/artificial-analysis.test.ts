import { afterEach, describe, expect, mock, test } from "bun:test";
import { limpiarCacheIndiceArtificial, obtenerIndiceArtificial } from "../src/artificial-analysis";

const apiKeyOriginal = process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY;
const fetchOriginal = globalThis.fetch;

afterEach(() => {
  if (apiKeyOriginal === undefined) delete process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY;
  else process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY = apiKeyOriginal;
  globalThis.fetch = fetchOriginal;
  limpiarCacheIndiceArtificial();
});

describe("índice de Artificial Analysis", () => {
  test("sin clave informa que el índice no está configurado y no hace peticiones", async () => {
    delete process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY;
    const fetchMock = mock(() => Promise.reject(new Error("no debe llamar")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await obtenerIndiceArtificial()).toEqual({ configurado: false, disponible: false, version: null, modelos: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("lee páginas oficiales, conserva el índice de inteligencia y cachea el resultado", async () => {
    process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY = "clave-de-prueba";
    const llamadas: string[] = [];
    globalThis.fetch = (async (input, init) => {
      llamadas.push(String(input));
      expect(new Headers(init?.headers).get("x-api-key")).toBe("clave-de-prueba");
      const page = new URL(String(input)).searchParams.get("page");
      return Response.json(page === "1"
        ? { intelligence_index_version: 4.3, pagination: { total_pages: 2 }, data: [{ slug: "modelo-prueba", name: "Modelo de prueba", model_creator: { name: "Proveedor" }, evaluations: { artificial_analysis_intelligence_index: 41.2 } }] }
        : { intelligence_index_version: 4.3, pagination: { total_pages: 2 }, data: [{ slug: "sin-puntaje", name: "Sin puntaje", evaluations: { artificial_analysis_intelligence_index: null } }] });
    }) as typeof fetch;

    const first = await obtenerIndiceArtificial();
    const cached = await obtenerIndiceArtificial();
    expect(first).toEqual({ configurado: true, disponible: true, version: 4.3, modelos: [{ slug: "modelo-prueba", name: "Modelo de prueba", creador: "Proveedor", score: 41.2 }] });
    expect(cached).toBe(first);
    expect(llamadas).toHaveLength(2);
  });
});
