import { entornoProveedores, proveedoresConClave, cuentaCloudflare } from "./claves-proveedor";
import { sesionCodexConectada } from "./login-cli";
import { listarModelosCodex } from "./modelos-codex";
import { listarModelosAntigravity, sesionAntigravityConectada } from "./antigravity";
import { commandCodeConectado } from "./runners/aislamiento";
import { listarModelosCommandCode } from "./modelos-commandcode";
import { listarModelosOllama, invalidarCatalogoOllama } from "./modelos-ollama";
import { proveedorCompatibleConBroker } from "./runners/red-agente";
import { aislamientoActivo } from "./runners/aislamiento";
import { consultarApiOpenCodeLocal } from "./opencode-api-local";

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
const ALWAYS_EXCLUDE = /~|image|vision|embedding|\bembed\b/;
// Versiones preview de pago: duplican a las estables. Las gratuitas sí se listan.
const PAID_EXCLUDE = /preview|customtools/;
// Retira endpoints de Google que ya no admiten solicitudes de cuentas nuevas.
const GOOGLE_NO_DISPONIBLES = /^google\/(?:gemini-2\.0-|gemini-2\.5-|gemini-3\.1-flash-lite-preview$)/;

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

type JsonObject = Record<string, unknown>;

function objeto(valor: unknown): JsonObject | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as JsonObject : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

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

    if (ALWAYS_EXCLUDE.test(id) || GOOGLE_NO_DISPONIBLES.test(id) || (!free && PAID_EXCLUDE.test(id))) continue;

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

// OpenCode v2 retiró `models --verbose`; su API local conserva precio, contexto y variantes.
export function parseModelsApiOpenCode(valor: unknown, conClave: ReadonlyMap<string, string> = new Map()): ModelInfo[] {
  const cuerpo = objeto(valor);
  const filas = Array.isArray(valor) ? valor : Array.isArray(cuerpo?.data) ? cuerpo.data : [];
  const lineas: string[] = [];

  for (const fila of filas) {
    const model = objeto(fila);
    if (!model || model.enabled === false || model.status === "deprecated") continue;
    if (typeof model.type === "string" && model.type !== "chat") continue;

    const provider = typeof model.providerID === "string" ? model.providerID : "";
    const modelID = typeof model.modelID === "string"
      ? model.modelID
      : typeof model.id === "string"
        ? model.id.startsWith(`${provider}/`) ? model.id.slice(provider.length + 1) : model.id
        : "";
    if (!provider || !modelID) continue;

    const valoresCosto = Array.isArray(model.cost) ? model.cost : model.cost ? [model.cost] : [];
    const costos = valoresCosto.map(objeto).filter((costo): costo is JsonObject => costo !== null);
    const preciosDisponibles = costos.length > 0 && costos.every((costo) => numero(costo.input) !== null && numero(costo.output) !== null);
    const inputUsd = preciosDisponibles ? Math.max(...costos.map((costo) => numero(costo.input)!)) : undefined;
    const outputUsd = preciosDisponibles ? Math.max(...costos.map((costo) => numero(costo.output)!)) : undefined;
    const limite = objeto(model.limit);
    const variantes = Array.isArray(model.variants)
      ? Object.fromEntries(model.variants.flatMap((variant) => {
        const id = objeto(variant)?.id;
        return typeof id === "string" ? [[id, {}]] : [];
      }))
      : objeto(model.variants) ?? {};
    const capacidades = objeto(model.capabilities);
    const modalidades = objeto(model.modalities);
    const entrada = capacidades?.input;
    const raw: RawModel = {
      name: typeof model.name === "string" ? model.name : `${provider}/${modelID}`,
      ...(preciosDisponibles ? { cost: { input: inputUsd, output: outputUsd } } : {}),
      ...(numero(limite?.context) !== null ? { limit: { context: numero(limite?.context)! } } : {}),
      ...(Array.isArray(entrada) || objeto(entrada) ? { capabilities: { input: entrada as string[] | { image?: boolean } } } : {}),
      ...(Array.isArray(modalidades?.input) ? { modalities: { input: modalidades.input as string[] } } : {}),
      variants: variantes,
    };
    lineas.push(`${provider}/${modelID}`, JSON.stringify(raw));
  }

  // La API local es la fuente de modelos habilitados para el CLI: todos deben seguir seleccionables,
  // aunque el precio del catálogo no esté publicado. El precio desconocido no implica gratuidad.
  return parseModels(lineas.join("\n"), conClave).map((model) => ({ ...model, recommended: true }));
}

// El listado corto de v2 solo expone IDs. Conserva los modelos seleccionables sin inventar metadatos.
export function parseModelsListaOpenCode(txt: string, conClave: ReadonlyMap<string, string> = new Map()): ModelInfo[] {
  const ids = [...new Set(txt.split(/\r?\n/).map((linea) => linea.trim()).filter((linea) => /^[^\s/]+\/\S+$/.test(linea)))];
  const listado = ids.flatMap((id) => [id, JSON.stringify({ name: id.split("/").at(-1) ?? id })]).join("\n");
  return parseModels(listado, conClave).map((model) => ({ ...model, recommended: true }));
}

// Tras cambiar una clave de proveedor, la lista de modelos se vuelve a pedir.
export function invalidarModelos(): void {
  cache = null;
  invalidarCatalogoOllama();
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
  const cuenta = cuentaCloudflare();
  if (cuenta) base.CLOUDFLARE_ACCOUNT_ID = cuenta;
  for (const variable of ["CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN"]) {
    if (process.env[variable]) base[variable] = process.env[variable]!;
  }
  if (!base.CLOUDFLARE_API_KEY && base.CLOUDFLARE_API_TOKEN) base.CLOUDFLARE_API_KEY = base.CLOUDFLARE_API_TOKEN;
  const proveedores = entornoProveedores();
  delete proveedores.COMMAND_CODE_API_KEY;
  return { ...base, ...proveedores };
}

async function ejecutarComandoModelos(args: string[]): Promise<{ salida: string; codigo: number }> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: entornoDelCli(),
  });
  let limite: ReturnType<typeof setTimeout> | undefined;
  try {
    const [salida, codigo] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), proc.exited, new Response(proc.stderr).text()]).then(([texto, code]) => [texto, code] as const),
      new Promise<never>((_, rechazar) => {
        limite = setTimeout(() => {
          try { proc.kill(); } catch { /* El CLI ya terminó. */ }
          rechazar(new Error("OpenCode no respondió en 15 segundos."));
        }, 15_000);
      }),
    ]);
    return { salida, codigo };
  } finally {
    if (limite) clearTimeout(limite);
  }
}

export async function getModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const entorno = entornoProveedores();
  let models: ModelInfo[] = [];
  if (Bun.which("opencode", { PATH: process.env.PATH ?? "" })) {
    let codigoDetallado = 1;
    try {
      const detallado = await ejecutarComandoModelos(["opencode", "models", "--verbose", ...(force ? ["--refresh"] : [])]);
      codigoDetallado = detallado.codigo;
      if (detallado.codigo === 0) models = parseModels(detallado.salida, proveedoresConClave());
    } catch {
      // Versiones recientes retiraron --verbose; se intenta su catálogo v2 y la API local.
    }

    if (models.length === 0) {
      let modelosBreves: ModelInfo[] = [];
      let codigoBreve = 1;
      try {
        const breve = await ejecutarComandoModelos(["opencode", "models", ...(force ? ["--refresh"] : [])]);
        codigoBreve = breve.codigo;
        if (breve.codigo === 0) modelosBreves = parseModelsListaOpenCode(breve.salida, proveedoresConClave());
        else if (force) {
          const sinRefresh = await ejecutarComandoModelos(["opencode", "models"]);
          codigoBreve = sinRefresh.codigo;
          if (sinRefresh.codigo === 0) modelosBreves = parseModelsListaOpenCode(sinRefresh.salida, proveedoresConClave());
        }
      } catch {
        // La API local todavía puede ofrecer el catálogo completo.
      }

      let modelosApi: ModelInfo[] = [];
      try {
        const respuestaApi = await consultarApiOpenCodeLocal("/api/model", { timeoutMs: 8_000, env: entornoDelCli() });
        if (respuestaApi.ok) modelosApi = parseModelsApiOpenCode(respuestaApi.datos, proveedoresConClave());
      } catch {
        // Mantener el listado corto si el servidor API no está disponible.
      }
      models = modelosApi.length > 0 ? modelosApi : modelosBreves;

      if (models.length === 0 && cache) return cache.models;
      if (models.length === 0) {
        const detalle = codigoBreve !== 0
          ? "El CLI rechazó tanto el catálogo detallado como el listado corto."
          : codigoDetallado !== 0
            ? "La API local no devolvió modelos habilitados para esta sesión."
            : "OpenCode no devolvió modelos utilizables.";
        throw new Error(`No se pudo consultar el catálogo de OpenCode. ${detalle} Comprueba la sesión del CLI.`);
      }
    }
  }

  models = models.filter((m) => m.provider !== "ollama" && (!aislamientoActivo() || proveedorCompatibleConBroker(m.provider, entorno)));

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

  try {
    if (await sesionAntigravityConectada()) {
      for (const m of (await listarModelosAntigravity(force)).models) {
        const id = `antigravity/${m.id}`;
        if (!models.some(existente => existente.id === id)) models.push({
          id, provider: "antigravity", name: m.name, context: m.context, variants: m.variants,
          inputUsd: 0, outputUsd: 0, priceKnown: false, free: false, costTier: "medio",
          costWarning: "Cuota de la sesión de Antigravity; no es la API de Google.",
          group: "Antigravity", recommended: true,
        });
      }
    }
  } catch { /* Un fallo del catálogo de la sesión no elimina las otras integraciones. */ }

  try {
    for (const modelo of await listarModelosOllama(force)) {
      const id = "ollama/" + modelo.id;
      if (!models.some((existente) => existente.id === id)) models.push({
        id, provider: "ollama", name: modelo.nombre, inputUsd: 0, outputUsd: 0, context: 0, variants: [],
        free: false, priceKnown: false, costTier: "desconocido",
        costWarning: "La tarifa depende del plan y del modelo de Ollama Cloud. Telo registra el uso, pero no consulta el saldo de la cuenta.",
        group: "Ollama Cloud", recommended: true,
      });
    }
  } catch { /* Si Ollama no devuelve el catálogo, se conservan los demás proveedores. */ }

  try {
    if (commandCodeConectado()) {
      for (const modelo of await listarModelosCommandCode(force)) {
        const id = `commandcode/${modelo.id}`;
        if (!models.some((existente) => existente.id === id)) models.push({
          id, provider: "commandcode", name: modelo.nombre, inputUsd: 0, outputUsd: 0,
          context: 0, variants: ["low", "medium", "high"], free: false,
          priceKnown: false, costTier: "medio",
          costWarning: "El plan Command Code Go aplica límites compartidos; revisa /usage en la CLI.",
          group: "Command Code Go", recommended: true,
        });
      }
    }
  } catch { /* Si el catálogo de la CLI no responde, se conservan los demás proveedores. */ }

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

