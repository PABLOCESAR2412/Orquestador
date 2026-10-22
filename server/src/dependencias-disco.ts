import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gitOkSeguro } from "./git";

const BLOQUEOS = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

// Solo dependencias ignoradas y reconstruibles; nunca sigue enlaces del workspace.
export async function dependenciasRetirables(repo: string): Promise<string[]> {
  const raiz = resolve(repo);
  if (!existsSync(raiz) || lstatSync(raiz).isSymbolicLink() || realpathSync(raiz) !== raiz) return [];
  const git = join(raiz, ".git");
  if (!existsSync(git) || !lstatSync(git).isDirectory() || lstatSync(git).isSymbolicLink()) return [];
  const seguidos = (await gitOkSeguro(["ls-files", "-z"], { cwd: raiz })).split("\0");
  const ignorados = new Set((await gitOkSeguro([
    "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z",
  ], { cwd: raiz })).split("\0"));
  const candidatos: string[] = [];
  function visitar(carpeta: string, bloqueoHeredado: boolean) {
    const bloqueo = bloqueoHeredado || BLOQUEOS.some(nombre => {
      const ruta = join(carpeta, nombre);
      return existsSync(ruta) && lstatSync(ruta).isFile() && !lstatSync(ruta).isSymbolicLink();
    });
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      if (!entrada.isDirectory() || entrada.isSymbolicLink() || entrada.name === ".git") continue;
      const ruta = join(carpeta, entrada.name);
      if (entrada.name === "node_modules") {
        const prefijo = relative(raiz, ruta).split(sep).join("/") + "/";
        if (bloqueo && existsSync(join(carpeta, "package.json")) && ignorados.has(prefijo)
          && !seguidos.some(nombre => nombre.startsWith(prefijo))) candidatos.push(ruta);
      } else {
        // .opencode necesita su propio lockfile; el lock del proyecto no lo reconstruye.
        visitar(ruta, entrada.name === ".opencode" ? false : bloqueo);
      }
    }
  }
  visitar(raiz, false);
  return candidatos;
}

export async function retirarDependencias(repo: string, permitir: () => boolean = () => true): Promise<string[]> {
  const rutas = await dependenciasRetirables(repo);
  const retiradas: string[] = [];
  const residuos = join(dirname(resolve(repo)), ".telo-dependencias-retiradas");
  if (existsSync(residuos)) {
    if (lstatSync(residuos).isSymbolicLink() || realpathSync(residuos) !== residuos) throw new Error("Directorio de residuos inválido");
    // Recupera retiros interrumpidos por un reinicio; fuera del repo y de la vista del agente.
    for (const entrada of readdirSync(residuos, { withFileTypes: true })) {
      if (entrada.isDirectory() && !entrada.isSymbolicLink() && /^[a-f0-9-]{36}$/i.test(entrada.name)) {
        await rm(join(residuos, entrada.name), { recursive: true, force: true });
      }
    }
  }
  for (const ruta of rutas) {
    if (!permitir()) break;
    const relativa = relative(resolve(repo), ruta);
    if (!relativa || relativa.startsWith(`..${sep}`) || resolve(ruta) !== realpathSync(ruta)) {
      throw new Error("Ruta de dependencias fuera del workspace o con enlaces");
    }
    mkdirSync(residuos, { recursive: true, mode: 0o700 });
    if (realpathSync(residuos) !== residuos) throw new Error("Directorio de residuos fuera de la tarea");
    const retirada = join(residuos, crypto.randomUUID());
    // El movimiento es atómico antes de ceder el bucle; un agente reanudado puede reinstalar.
    renameSync(ruta, retirada);
    await rm(retirada, { recursive: true, force: true });
    retiradas.push(ruta);
  }
  return retiradas;
}
