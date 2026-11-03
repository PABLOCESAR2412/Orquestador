import { valorClaveApiProveedor } from "./claves-proveedor";

export type ModeloOllamaCloud = { id: string; nombre: string };
const URL_MODELOS = "https://ollama.com/v1/models";
const TTL_MS = 5 * 60_000;
let cache: { at: number; modelos: ModeloOllamaCloud[] } | null = null;

export function parsearCatalogoOllama(valor: unknown): ModeloOllamaCloud[] {
  if (!valor || typeof valor !== "object" || !Array.isArray((valor as { data?: unknown }).data)) return [];
  const ids = new Set<string>();
  return (valor as { data: unknown[] }).data.flatMap((fila) => {
    if (!fila || typeof fila !== "object") return [];
    const item = fila as { id?: unknown; name?: unknown };
    const id = typeof item.id === "string" ? item.id.trim() : typeof item.name === "string" ? item.name.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(id) || id.includes("..") || ids.has(id)) return [];
    ids.add(id);
    return [{ id, nombre: (typeof item.name === "string" && item.name.trim() ? item.name.trim() : id).slice(0, 180) }];
  });
}

export function invalidarCatalogoOllama(): void {
  cache = null;
}

export async function listarModelosOllama(forzar = false, solicitar: typeof fetch = fetch): Promise<ModeloOllamaCloud[]> {
  const clave = valorClaveApiProveedor("ollama");
  if (!clave) return [];
  if (!forzar && cache && Date.now() - cache.at < TTL_MS) return cache.modelos;
  const respuesta = await solicitar(URL_MODELOS, {
    headers: { Accept: "application/json", Authorization: `Bearer ${clave}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!respuesta.ok) throw new Error(respuesta.status === 401 || respuesta.status === 403 ? "ollama_key_rejected" : respuesta.status === 429 ? "ollama_rate_limited" : "ollama_catalog_unavailable");
  const modelos = parsearCatalogoOllama(await respuesta.json().catch(() => null));
  if (!modelos.length) throw new Error("ollama_catalog_empty");
  cache = { at: Date.now(), modelos };
  return modelos;
}