import { entornoProveedores, proveedoresConClave } from "./claves-proveedor";
import { sesionCodexConectada } from "./login-cli";
import { listarModelosCodex } from "./modelos-codex";
import { proveedorCompatibleConBroker } from "./runners/red-agente";
import { aislamientoActivo } from "./runners/aislamiento";

export type CostTier = "gratis" | "economico" | "medio" | "alto" | "premium" | "desconocido";

export type ModelInfo = {
  id: string;
  provider: string;
  name: string;
  inputUsd: number;
  outputUsd: number;
  context: number;
  variants: string[];
  free: boolean;
  priceKnown?: boolean;
  supportsImages?: boolean;
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
  { label: "Gemini", pattern: /gemini/ },
  { label: "DeepSeek", pattern: /deepseek-v4(\.1)?-flash|deepseek-v4-pro/ },
  { label: "Big Pickle", pattern: /big-pickle/ },
];

// Alias que cambian solos y modelos de imagen o visión: nunca se listan.
const ALWAYS_EXCLUDE = /~|image|vision/;
// Versiones preview de pago: duplican a las estables. Las gratuitas sí se listan.
const PAID_EXCLUDE = /preview|customtools/;

const WARNINGS: Record<CostTier, string | null> = {
  desconocido: "El catálogo no publica un precio verificable. Este modelo no se considera gratuito ni se usa como respaldo.",
  gratis: null,
  economico: null,
  medio: null,
  alto: "Costo alto: consume saldo rápido. Revisa tu saldo antes de usarlo.",
  premium: "Costo muy alto: úsalo solo si lo necesitas y con saldo suficiente.",
};

const TTL_MS = 10 * 60_000;
let cache: { at: number; models: ModelInfo[] } | null = null;

type RawModel = {
  capabilities?: { input?: { image?: boolean } | string[] };
  modalities?: { input?: string[] };
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
export function parseModels(txt: string, conClave: ReadonlyMap<string, string> = new Map()): ModelInfo[] {
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
    const priceKnown = typeof raw.cost?.input === "number" && Number.isFinite(raw.cost.input) && raw.cost.input >= 0 && typeof raw.cost?.output === "number" && Number.isFinite(raw.cost.output) && raw.cost.output >= 0;
    const free = priceKnown && inputUsd === 0 && outputUsd === 0;

    if (ALWAYS_EXCLUDE.test(id) || (!free && PAID_EXCLUDE.test(id))) continue;

    const matched = GROUPS.find((g) => g.pattern.test(id));
    const costTier = priceKnown ? tierFor(free, outputUsd) : "desconocido";
    const provider = id.split("/")[0];
    const etiquetaProveedor = conClave.get(provider);

    models.push({
      id,
      provider,
      name: raw.name ?? id,
      supportsImages: Array.isArray(raw.capabilities?.input) ? raw.capabilities.input.includes("image") : typeof raw.capabilities?.input?.image === "boolean" ? raw.capabilities.input.image : Array.isArray(raw.modalities?.input) ? raw.modalities.input.includes("image") : undefined,
      inputUsd,
      outputUsd,
      context: raw.limit?.context ?? 0,
      variants: Object.keys(raw.variants ?? {}),
      free,
      priceKnown,
      costTier,
      costWarning: WARNINGS[costTier],
      group: matched?.label ?? etiquetaProveedor ?? (free ? "Gratis" : "Otros"),
      recommended: free || matched !== undefined || etiquetaProveedor !== undefined,
    });
  }
  // OpenCode Zen también publica algunos modelos de Google. Si el proveedor oficial está
  // configurado, conserva esa entrada y evita que el selector muestre el mismo Gemini dos veces.
  const ids = new Set<string>();
  const googleGemini = new Set(
    models
      .filter((m) => m.provider === "google" && m.id.startsWith("google/gemini-"))
      .map((m) => m.id.slice("google/".length)),
  );
  return models.filter((model) => {
    if (ids.has(model.id)) return false;
    ids.add(model.id);
    return !(model.provider === "opencode" && googleGemini.has(model.id.slice("opencode/".length)));
  });
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

  const args = ["opencode", "models", "--verbose"];
  if (force) args.push("--refresh");
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: entornoDelCli(),
  });
  // La validación del modelo ocurre antes de crear la tarea: un CLI detenido no debe bloquear el envío indefinidamente.
  let limite: ReturnType<typeof setTimeout> | undefined;
  let out: string;
  let code: number;
  try {
    [out, code] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), proc.exited, new Response(proc.stderr).text()]),
      new Promise<never>((_, rechazar) => {
        limite = setTimeout(() => {
          try { proc.kill(); } catch { /* El CLI ya terminó. */ }
          rechazar(new Error("opencode models no respondió en 15 segundos"));
        }, 15_000);
      }),
    ]);
  } catch (error) {
    if (cache) return cache.models;
    throw error;
  } finally { if (limite) clearTimeout(limite); }

  if (code !== 0) {
    // Si falla la actualización, se usa la última lista buena
    if (cache) return cache.models;
    throw new Error(`opencode models salió con código ${code}`);
  }

  const entorno = entornoProveedores();
  const models = parseModels(out, proveedoresConClave()).filter(m => !aislamientoActivo() || proveedorCompatibleConBroker(m.provider, entorno));

  try {
    if (await sesionCodexConectada()) {
      const codexRes = await listarModelosCodex();
      for (const m of codexRes.models) {
        const id = `codex/${m.id}`;
        if (!models.some((existente) => existente.id === id)) {
          models.push({
            id,
            provider: "codex",
            name: m.name,
            inputUsd: 0,
            outputUsd: 0,
            context: m.context,
            variants: m.variants.length > 0 ? m.variants : ["low", "medium", "high"],
            free: false,
            costTier: "medio",
            costWarning: null,
            group: "Codex",
            recommended: true,
          });
        }
      }
    }
  } catch {
    // Si Codex no responde, no interrumpimos la lista principal
  }

  cache = { at: Date.now(), models };
  return models;
}

export async function validateSelection(
  model: string,
  effort: string | null,
): Promise<{ ok: true; info: ModelInfo } | { ok: false; error: string }> {
  let info = (await getModels()).find((m) => m.id === model);
  // Chats y preferencias antiguas pueden conservar un ID que OpenCode ya retiró.
  // Actualiza el catálogo una vez antes de rechazarlo.
  if (!info) info = (await getModels(true)).find((m) => m.id === model);
  if (!info) return { ok: false, error: "model_not_found" };
  if (effort && !info.variants.includes(effort)) {
    return { ok: false, error: "effort_not_supported" };
  }
  return { ok: true, info };
}

