import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { carpetaHome } from "./hogar";
import { hallarEjecutable } from "./ejecutable";
import { listarModelosAntigravity as consultarModelosAntigravity, type ModeloAntigravity } from "./modelos-antigravity";
export type { ModeloAntigravity } from "./modelos-antigravity";

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

export async function listarModelosAntigravity(forzar = false): Promise<{ generado: string; models: ModeloAntigravity[] }> {
  return consultarModelosAntigravity(forzar);
}
