import { carpetaHome } from "./hogar";
import { entornoSecretServiceAntigravity } from "./runtime-antigravity";
import { hallarEjecutable } from "./ejecutable";

export type ModeloAntigravity = { id: string; name: string; variants: string[]; context: number };

const TTL_MS = 5 * 60_000;
const TOPE_MS = 20_000;
let cache: { at: number; models: ModeloAntigravity[] } | null = null;
let enCurso: Promise<ModeloAntigravity[]> | null = null;

function registro(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function listaDeModelos(valor: unknown): unknown[] {
  if (Array.isArray(valor)) return valor;
  const objeto = registro(valor);
  for (const campo of ["models", "data", "items", "availableModels"]) {
    if (Array.isArray(objeto?.[campo])) return objeto[campo] as unknown[];
  }
  return [];
}

function niveles(valor: Record<string, unknown>): string[] {
  const posibles = valor.variants ?? valor.reasoning_levels ?? valor.reasoningLevels ?? valor.effortLevels ?? valor.effort_levels;
  const objeto = registro(posibles);
  const lista = Array.isArray(posibles) ? posibles : objeto ? Object.keys(objeto) : [];
  return [...new Set(lista.flatMap((nivel) => {
    if (typeof nivel === "string") return [nivel.toLowerCase()];
    const objeto = registro(nivel);
    const esfuerzo = objeto?.effort ?? objeto?.id ?? objeto?.name;
    return typeof esfuerzo === "string" ? [esfuerzo.toLowerCase()] : [];
  }).filter((nivel) => ["low", "medium", "high"].includes(nivel)))];
}

export function parsearModelosAntigravity(texto: string): ModeloAntigravity[] {
  let json: unknown;
  try { json = JSON.parse(texto); } catch { json = null; }
  if (json !== null) {
    const ids = new Set<string>();
    const modelos = listaDeModelos(json).flatMap((entrada) => {
      const modelo = registro(entrada);
      const id = modelo?.id ?? modelo?.slug ?? modelo?.model ?? modelo?.name;
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(id) || ids.has(id)) return [];
      ids.add(id);
      const name = modelo?.display_name ?? modelo?.displayName ?? modelo?.label ?? modelo?.name;
      const context = modelo?.context_window ?? modelo?.contextWindow ?? modelo?.context;
      return [{
        id,
        name: typeof name === "string" ? name : id,
        variants: niveles(modelo!),
        context: typeof context === "number" && Number.isFinite(context) ? context : 0,
      }];
    });
    if (modelos.length) return modelos;
  }

  // Compatibilidad con versiones que imprimen `agy models` como texto. Desde v1.3.4
  // `--model` admite el slug base y `--effort` elige entre sus niveles publicados.
  const modelos = new Map<string, ModeloAntigravity>();
  const orden = ["low", "medium", "high"];
  for (const linea of texto.split(/\r?\n/)) {
    const coincidencia = /^\s*((?:gemini|claude|gpt|grok|deepseek|llama|qwen|glm|kimi|mistral)[-_.:A-Za-z0-9]*)(?:\s+(.*))?$/i.exec(linea);
    const slug = coincidencia?.[1];
    if (!slug || !coincidencia) continue;
    const esfuerzo = /-(low|medium|high)$/i.exec(slug)?.[1]?.toLowerCase();
    const id = esfuerzo ? slug.slice(0, -(esfuerzo.length + 1)) : slug;
    const etiqueta = (coincidencia[2] ?? "").trim();
    const name = etiqueta.replace(/\s*\((?:low|medium|high)\)\s*$/i, "").trim() || id;
    const anterior = modelos.get(id);
    if (anterior) {
      if (esfuerzo && !anterior.variants.includes(esfuerzo)) {
        anterior.variants = [...anterior.variants, esfuerzo].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
      }
      continue;
    }
    modelos.set(id, { id, name: name.slice(0, 160), variants: esfuerzo ? [esfuerzo] : [], context: 0 });
  }
  return [...modelos.values()];
}

export async function listarModelosAntigravity(forzar = false): Promise<ModeloAntigravity[]> {
  if (!forzar && cache && Date.now() - cache.at < TTL_MS) return cache.models;
  if (!enCurso) enCurso = cargar().finally(() => { enCurso = null; });
  const models = await enCurso;
  cache = { at: Date.now(), models };
  return models;
}

async function cargar(): Promise<ModeloAntigravity[]> {
  const agy = hallarEjecutable("agy");
  if (!agy) return [];
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
    ...entornoSecretServiceAntigravity(),
  };
  const args = [agy, "models", "--output-format", "json"];
  let proceso = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env, stdin: "ignore" });
  let salida = await finalizar(proceso);
  if (salida.codigo !== 0) {
    // La bandera de formato JSON llegó en agy 1.1.8; versiones antiguas solo emiten texto.
    proceso = Bun.spawn([agy, "models"], { stdout: "pipe", stderr: "pipe", env, stdin: "ignore" });
    salida = await finalizar(proceso);
  }
  if (salida.codigo !== 0) throw new Error("antigravity_models_unavailable");
  const models = parsearModelosAntigravity(salida.stdout);
  if (!models.length) throw new Error("antigravity_models_empty");
  return models;
}

async function finalizar(proceso: Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all([new Response(proceso.stdout).text(), new Response(proceso.stderr).text(), proceso.exited])
        .then(([stdout, stderr, codigo]) => ({ stdout, stderr, codigo })),
      new Promise<never>((_, rechazar) => {
        timer = setTimeout(() => {
          try { proceso.kill(); } catch {}
          rechazar(new Error("antigravity_models_timeout"));
        }, TOPE_MS);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
