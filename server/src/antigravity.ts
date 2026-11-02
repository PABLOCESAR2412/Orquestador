import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { carpetaHome } from "./hogar";
import { hallarEjecutable } from "./ejecutable";
import { leerConTope } from "./runners/proteccion";

export type ModeloAntigravity = { id: string; name: string; context: number; variants: string[] };
export const TOKEN_ANTIGRAVITY = "antigravity-cli/antigravity-oauth-token";

// Solo el almacén de archivos creado por el login SSH puede montarse en un perfil aislado.
// La sesión del keyring/DBus no se exporta ni se convierte en una API key.
export function archivosSesionAntigravity(home = carpetaHome()): { relativa: string; ruta: string }[] {
  const raiz = join(resolve(home), ".gemini");
  const segura = (relativa: string) => {
    const ruta = join(raiz, relativa);
    try {
      const stat = lstatSync(ruta);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size === 0 || stat.size > 1024 * 1024 || realpathSync(ruta) !== ruta || realpathSync(dirname(ruta)) !== dirname(ruta)) return [];
      if (relativa === TOKEN_ANTIGRAVITY && process.platform === "linux" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) return [];
      return [{ relativa, ruta }];
    } catch { return []; }
  };
  const token = segura(TOKEN_ANTIGRAVITY);
  if (!token.length) return [];
  return [...token, ...["installation_id", "google_accounts.json", "state.json"].flatMap(nombre => segura(`antigravity-cli/${nombre}`))];
}

export async function sesionAntigravityConectada(): Promise<boolean> {
  return hallarEjecutable("agy") !== null && archivosSesionAntigravity().length > 0;
}

export function parsearCatalogoAntigravity(texto: string): ModeloAntigravity[] {
  const ids = new Set<string>();
  return stripVTControlCharacters(texto).split(/\r?\n/).flatMap(linea => {
    const match = linea.trim().match(/^([a-z][a-z0-9_.:-]{1,119})\s{2,}(.+)$/);
    if (!match || ids.has(match[1]!)) return [];
    ids.add(match[1]!);
    return [{ id: match[1]!, name: match[2]!.trim().slice(0, 200), context: 0, variants: [] }];
  });
}

let cache: { at: number; models: ModeloAntigravity[] } | null = null;
export async function listarModelosAntigravity(forzar = false): Promise<{ generado: string; models: ModeloAntigravity[] }> {
  if (!forzar && cache && Date.now() - cache.at < 5 * 60_000) return { generado: new Date(cache.at).toISOString(), models: cache.models };
  const agy = hallarEjecutable("agy");
  if (!agy) throw new Error("Antigravity CLI no está instalado.");
  const proc = Bun.spawn([agy, "models"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: carpetaHome(), LC_ALL: "C.UTF-8" },
  });
  const reloj = setTimeout(() => proc.kill(), 15_000);
  try {
    const [salida, , codigo] = await Promise.all([leerConTope(proc.stdout, 1024 * 1024), leerConTope(proc.stderr, 4096), proc.exited]);
    if (codigo !== 0) throw new Error("Antigravity no pudo consultar su catálogo. Comprueba su sesión por SSH como usuario orquestador.");
    const models = parsearCatalogoAntigravity(salida);
    if (!models.length) throw new Error("Antigravity no devolvió un catálogo válido.");
    cache = { at: Date.now(), models };
    return { generado: new Date(cache.at).toISOString(), models };
  } finally { clearTimeout(reloj); }
}
