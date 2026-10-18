const API_BASE = "https://artificialanalysis.ai/api/v2/language/models/free";
const CACHE_MS = 12 * 60 * 60_000;
const MAX_PAGES = 10;

type RespuestaAA = {
  intelligence_index_version?: number;
  pagination?: { total_pages?: number };
  data?: {
    name?: string;
    slug?: string;
    model_creator?: { name?: string };
    evaluations?: { artificial_analysis_intelligence_index?: number | null };
  }[];
};

export type PuntajeArtificial = { slug: string; name: string; creador: string | null; score: number };
export type IndiceArtificial = {
  configurado: boolean;
  disponible: boolean;
  version: number | null;
  modelos: PuntajeArtificial[];
};

let cache: { at: number; value: IndiceArtificial } | null = null;

export async function obtenerIndiceArtificial(): Promise<IndiceArtificial> {
  const key = process.env.TELO_ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  if (!key) return { configurado: false, disponible: false, version: null, modelos: [] };
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const signal = AbortSignal.timeout(20_000);
    const first = await pedirPagina(key, 1, signal);
    const respuestas = [first];
    const paginas = Math.min(first.pagination?.total_pages ?? 1, MAX_PAGES);
    for (let page = 2; page <= paginas; page += 1) respuestas.push(await pedirPagina(key, page, signal));

    const modelos = respuestas.flatMap((respuesta) => (respuesta.data ?? []).flatMap((modelo) => {
      const score = modelo.evaluations?.artificial_analysis_intelligence_index;
      if (!modelo.slug || !modelo.name || typeof score !== "number" || !Number.isFinite(score)) return [];
      return [{ slug: modelo.slug, name: modelo.name, creador: modelo.model_creator?.name ?? null, score }];
    }));
    const value: IndiceArtificial = {
      configurado: true,
      disponible: true,
      version: typeof first.intelligence_index_version === "number" ? first.intelligence_index_version : null,
      modelos,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return { configurado: true, disponible: false, version: null, modelos: [] };
  }
}

async function pedirPagina(key: string, page: number, signal: AbortSignal): Promise<RespuestaAA> {
  const response = await fetch(`${API_BASE}?page=${page}`, {
    headers: { "x-api-key": key, accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Artificial Analysis no está disponible");
  const body = await response.json() as RespuestaAA;
  if (!Array.isArray(body.data)) throw new Error("Respuesta de Artificial Analysis inválida");
  return body;
}

export function limpiarCacheIndiceArtificial(): void {
  cache = null;
}
