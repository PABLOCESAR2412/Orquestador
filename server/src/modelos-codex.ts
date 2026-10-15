import { carpetaHome } from "./hogar";
import { hallarEjecutable } from "./ejecutable";

export type ModeloCodex = {
  id: string;
  name: string;
  context: number;
  variants: string[];
};

type RegistroModelo = {
  slug?: unknown;
  display_name?: unknown;
  context_window?: unknown;
  visibility?: unknown;
  supported_in_api?: unknown;
  supported_reasoning_levels?: unknown;
};

export function parsearCatalogoCodex(texto: string): ModeloCodex[] {
  let respuesta: { models?: unknown };
  try {
    respuesta = JSON.parse(texto) as { models?: unknown };
  } catch {
    throw new Error("codex_models_invalid");
  }
  if (!Array.isArray(respuesta.models)) throw new Error("codex_models_invalid");

  const ids = new Set<string>();
  return (respuesta.models as RegistroModelo[]).flatMap((valor) => {
    if (
      typeof valor?.slug !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(valor.slug) ||
      ids.has(valor.slug) ||
      valor.visibility === "hide" ||
      valor.supported_in_api === false
    ) return [];
    ids.add(valor.slug);
    const variants = Array.isArray(valor.supported_reasoning_levels)
      ? valor.supported_reasoning_levels.flatMap((nivel: unknown) =>
          nivel && typeof nivel === "object" && "effort" in nivel && typeof nivel.effort === "string"
            ? [nivel.effort]
            : [],
        )
      : [];
    return [{
      id: valor.slug,
      name: typeof valor.display_name === "string" ? valor.display_name : valor.slug,
      context: typeof valor.context_window === "number" ? valor.context_window : 0,
      variants,
    }];
  });
}

let cache: { at: number; models: ModeloCodex[] } | null = null;
let enCurso: Promise<ModeloCodex[]> | null = null;
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 30_000;

// El propio Codex CLI usa la sesión de ChatGPT del servidor y entrega su catálogo actualizado.
// Solo se devuelve metadata de modelo: nunca se lee ni serializa auth.json ni la salida de error.
export async function listarModelosCodex(): Promise<{ generado: string; models: ModeloCodex[] }> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { generado: new Date(cache.at).toISOString(), models: cache.models };
  }
  if (!enCurso) {
    enCurso = cargarCatalogo().finally(() => { enCurso = null; });
  }
  const models = await enCurso;
  cache = { at: Date.now(), models };
  return { generado: new Date(cache.at).toISOString(), models };
}

async function cargarCatalogo(): Promise<ModeloCodex[]> {
  const codex = hallarEjecutable("codex");
  if (!codex) throw new Error("codex_models_unavailable");
  const proc = Bun.spawn([codex, "debug", "models"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: carpetaHome(), LC_ALL: "C.UTF-8" },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const resultado = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          proc.kill();
          reject(new Error("codex_models_timeout"));
        }, TIMEOUT_MS);
      }),
    ]);
    const [salida, _errorCli, codigo] = resultado;
    if (codigo !== 0) throw new Error("codex_models_unavailable");
    return parsearCatalogoCodex(salida);
  } finally {
    if (timeout) clearTimeout(timeout);
    void proc.stderr?.cancel().catch(() => {});
  }
}
