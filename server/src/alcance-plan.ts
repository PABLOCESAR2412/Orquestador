import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitSeguro, prepararRepoSeguro } from "./git";

export type AlcancePlan = {
  cwd: string;
  arbol: string;
  archivos: { ruta: string; directorio: boolean }[];
};

function rutaDelPlan(ruta: string): string {
  const partes = ruta.replace(/\\/g, "/").split("/");
  if (
    !ruta.trim() ||
    /^[\\/]|^[A-Za-z]:/.test(ruta) ||
    ruta.includes("\0") ||
    partes.some((p) => p === ".." || p.toLowerCase() === ".git")
  ) {
    throw new Error("El plan contiene una ruta fuera del workspace o dentro de .git.");
  }
  const relativa = partes.filter((p) => p && p !== ".").join("/");
  if (!relativa) throw new Error("El plan debe indicar archivos o directorios concretos.");
  return relativa;
}

function sinEnlaces(cwd: string, ruta: string): void {
  let actual = cwd;
  for (const parte of ruta.split("/")) {
    actual = join(actual, parte);
    try {
      if (lstatSync(actual).isSymbolicLink())
        throw new Error("El alcance del plan no admite enlaces simbólicos.");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const resultado = await gitSeguro(args, { cwd });
  if (resultado.code !== 0)
    throw new Error("No se pudo comprobar el alcance del plan con Git. Los cambios se conservan.");
  return resultado.stdout;
}

async function arbolActual(cwd: string): Promise<string> {
  if (!(await prepararRepoSeguro(cwd)))
    throw new Error("El workspace no tiene un repositorio Git seguro.");
  await git(cwd, ["add", "-A", "--", "."]);
  return (await git(cwd, ["write-tree"])).trim();
}

// Guarda el árbol de trabajo actual, incluidos cambios de turnos anteriores, sin crear commits.
export async function capturarAlcance(cwd: string, archivosPlan: string[]): Promise<AlcancePlan> {
  const raiz = resolve(cwd);
  if (lstatSync(raiz).isSymbolicLink())
    throw new Error("El workspace no admite enlaces simbólicos.");
  const archivos = archivosPlan.map((archivo) => {
    const ruta = rutaDelPlan(archivo);
    sinEnlaces(raiz, ruta);
    let directorio = false;
    try {
      directorio = lstatSync(join(raiz, ruta)).isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return { ruta, directorio };
  });
  return { cwd: raiz, archivos, arbol: await arbolActual(raiz) };
}

// Solo informa: nunca revierte ni elimina los cambios que necesitan otra aprobación.
export async function comprobarAlcance(snapshot: AlcancePlan): Promise<string[]> {
  const final = await arbolActual(snapshot.cwd);
  const cambiados = (
    await git(snapshot.cwd, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      snapshot.arbol,
      final,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  return cambiados.filter((ruta) => {
    try {
      rutaDelPlan(ruta);
      sinEnlaces(snapshot.cwd, ruta);
    } catch {
      return true;
    }
    return !snapshot.archivos.some(
      (permitido) =>
        ruta === permitido.ruta || (permitido.directorio && ruta.startsWith(permitido.ruta + "/")),
    );
  });
}
