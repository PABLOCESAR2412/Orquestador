import { db } from "./db";
import type { ModelInfo } from "./models";

const KEY = "modelos_sin_cuota";
const PAUSA_MS = 15 * 60_000;
type Agotado = { ambito: string; modelo: string; hasta: number };
const ambito = (projectId?: string | null) => projectId ?? "global";

function leer(ahora: number): Agotado[] {
  try {
    const valor: unknown = JSON.parse(db.query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key=?").get(KEY)?.value ?? "[]");
    return Array.isArray(valor) ? valor.filter((v): v is Agotado => v && typeof v.ambito === "string" && typeof v.modelo === "string" && typeof v.hasta === "number" && v.hasta > ahora).slice(-200) : [];
  } catch { return []; }
}

export function modeloSinCuota(modelo: string, projectId?: string | null, ahora = Date.now()): boolean {
  return leer(ahora).some((v) => v.ambito === ambito(projectId) && v.modelo === modelo);
}

export function registrarCuotaModelo(modelo: string, agotado: boolean, projectId?: string | null, ahora = Date.now()): void {
  const anteriores = leer(ahora);
  const actuales = anteriores.filter((v) => v.ambito !== ambito(projectId) || v.modelo !== modelo);
  if (agotado) actuales.push({ ambito: ambito(projectId), modelo: modelo, hasta: ahora + PAUSA_MS });
  if (!agotado && anteriores.length === actuales.length) return;
  db.query("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(KEY, JSON.stringify(actuales.slice(-200)));
}

export function modelosSinCuota(projectId?: string | null, ahora = Date.now()): Set<string> {
  return new Set(leer(ahora).filter((v) => v.ambito === ambito(projectId)).map((v) => v.modelo));
}

export function candidatosPorCuota(catalogo: ModelInfo[], preferidos: string[], actual: string, conectados: ReadonlySet<string>, agotados: ReadonlySet<string> = new Set(), automaticos = false): ModelInfo[] {
  const elegidos = new Set([actual]);
  const guardados = preferidos.flatMap((id) => {
    const info = catalogo.find((m) => m.id === id);
    if (!info || elegidos.has(id) || agotados.has(id) || (!info.free && info.provider !== "codex") || !conectados.has(info.provider)) return [];
    elegidos.add(id);
    return [info];
  });
  if (!automaticos) return guardados;
  // Sin precio explícito, cero en el catálogo no demuestra gratuidad. Codex solo entra por elección guardada.
  const gratis = catalogo.filter((m) => !elegidos.has(m.id) && !agotados.has(m.id) && m.free && m.priceKnown === true && m.provider !== "codex" && conectados.has(m.provider))
    .sort((a, b) => Number(b.provider !== actual.split("/")[0]) - Number(a.provider !== actual.split("/")[0]) || Number(b.recommended) - Number(a.recommended) || b.context - a.context || a.id.localeCompare(b.id));
  const proveedores = new Set<string>();
  const diversos = gratis.filter((m) => {
    if (proveedores.has(m.provider)) return false;
    proveedores.add(m.provider);
    return true;
  });
  const orden = [...diversos, ...gratis.filter((m) => !diversos.includes(m))];
  return [...guardados, ...orden.slice(0, 3)];
}
