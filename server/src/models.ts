import { entornoProveedores, proveedoresConClave } from "./claves-proveedor";

export type CostTier = "gratis" | "economico" | "medio" | "alto" | "premium";

export type ModelInfo = {
  id: string;
  provider: string;
  name: string;
  inputUsd: number;
  outputUsd: number;
  context: number;
  variants: string[];
  free: boolean;
  costTier: CostTier;
  costWarning: string | null;
  group: string;
  recommended: boolean;
};

// Grupos curados por patrón: las versiones nuevas que coincidan aparecen solas.
const GROUPS: { label: string; pattern: RegExp }[] = [
  { label: "Claude", pattern: /claude-(fable|haiku|opus|sonnet)/ },
  { label: "GPT-6", pattern: /gpt-6/ },
  { label: "Codex", pattern: /codex/ },
  { label: "Gemini Pro 3.1", pattern: /gemini-3\.1-pro/ },
  { label: "Gemini Flash 3.5-3.8", pattern: /gemini-3\.[5-8]-flash/ },
  { label: "DeepSeek", pattern: /deepseek-v4(\.1)?-flash|deepseek-v4-pro/ },
  { label: "Big Pickle", pattern: /big-pickle/ },
];

// Alias que cambian solos y modelos de imagen o visión: nunca se listan.
const ALWAYS_EXCLUDE = /~|image|vision/;
// Versiones preview de pago: duplican a las estables. Las gratuitas sí se listan.
const PAID_EXCLUDE = /preview|customtools/;

const WARNINGS: Record<CostTier, string | null> = {
  gratis: null,
  economico: null,
  medio: null,
  alto: "Costo alto: consume saldo rápido. Revisa tu saldo antes de usarlo.",
  premium: "Costo muy alto: úsalo solo si lo necesitas y con saldo suficiente.",
};

const TTL_MS = 10 * 60_000;
let cache: { at: number; models: ModelInfo[] } | null = null;

type RawModel = {
  name?: string;
  cost?: { input?: number; output?: number };
  limit?: { context?: number };
  variants?: Record<string, unknown>;
};

function tierFor(free: boolean, outputUsd: number): CostTier {
  if (free) return "gratis";
  if (outputUsd <= 2) return "economico";
  if (outputUsd <= 15) return "medio";
  if (outputUsd <= 60) return "alto";
  return "premium";
}

// `conClave`: proveedor -> etiqueta, de los que tienen clave activa. Sus modelos se recomiendan aunque no sean
// gratis o no estén en un grupo curado: si el usuario guardó la clave, quiere usarlos.
function parseModels(txt: string, conClave: ReadonlyMap<string, string> = new Map()): ModelInfo[] {
  // Cada modelo aparece como una línea "proveedor/modelo" seguida de su JSON
  const parts = txt.split(/^(\S+\/\S+)$/m).slice(1);
  const models: ModelInfo[] = [];

  for (let i = 0; i < parts.length; i += 2) {
    const id = parts[i];
    let raw: RawModel;
    try {
      raw = JSON.parse(parts[i + 1]);
    } catch {
      continue;
    }

    const inputUsd = raw.cost?.input ?? 0;
    const outputUsd = raw.cost?.output ?? 0;
    const free = inputUsd === 0 && outputUsd === 0;

    if (ALWAYS_EXCLUDE.test(id) || (!free && PAID_EXCLUDE.test(id))) continue;

    const matched = GROUPS.find((g) => g.pattern.test(id));
    const costTier = tierFor(free, outputUsd);
    const provider = id.split("/")[0];
    const etiquetaProveedor = conClave.get(provider);

    models.push({
      id,
      provider,
      name: raw.name ?? id,
      inputUsd,
      outputUsd,
      context: raw.limit?.context ?? 0,
      variants: Object.keys(raw.variants ?? {}),
      free,
      costTier,
      costWarning: WARNINGS[costTier],
      group: matched?.label ?? etiquetaProveedor ?? (free ? "Gratis" : "Otros"),
      recommended: free || matched !== undefined || etiquetaProveedor !== undefined,
    });
  }
  return models;
}

// Tras cambiar una clave de proveedor, la lista de modelos se vuelve a pedir.
export function invalidarModelos(): void {
  cache = null;
}

// El CLI recibe solo lo que usa (como el agente) más las claves de proveedor guardadas: nunca TELO_*.
function entornoDelCli(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(process.env)) {
    if (valor === undefined) continue;
    if (["PATH", "HOME", "LANG", "TZ", "TMPDIR"].includes(clave) || /^(LC_|XDG_|OPENCODE_)/.test(clave)) {
      base[clave] = valor;
    }
  }
  return { ...base, ...entornoProveedores() };
}

export async function getModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const proc = Bun.spawn(["opencode", "models", "--verbose"], {
    stdout: "pipe",
    stderr: "pipe",
    env: entornoDelCli(),
  });
  const [out, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    // Si falla la actualización, se usa la última lista buena
    if (cache) return cache.models;
    throw new Error(`opencode models salió con código ${code}`);
  }

  const models = parseModels(out, proveedoresConClave());
  cache = { at: Date.now(), models };
  return models;
}

export async function validateSelection(
  model: string,
  effort: string | null,
): Promise<{ ok: true; info: ModelInfo } | { ok: false; error: string }> {
  const info = (await getModels()).find((m) => m.id === model);
  if (!info) return { ok: false, error: "model_not_found" };
  if (effort && !info.variants.includes(effort)) {
    return { ok: false, error: "effort_not_supported" };
  }
  return { ok: true, info };
}
