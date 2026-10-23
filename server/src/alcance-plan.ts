import { lstatSync, readdirSync, readlinkSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { gitSeguro, prepararRepoSeguro, tieneGitReal } from "./git";

export type AlcancePlan = {
  cwd: string;
  arbol: string;
  contenido?: Map<string, string>;
  internos?: string[];
  // Archivos ignorados por Git que sí se vigilan (excluidas carpetas de dependencias y caché):
  // ruta → hash del contenido al capturar. Sin la comparación, un cambio solo en ignorados
  // sería invisible y el alcance daría por muerto lo que el agente tocó ahí.
  ignorados?: Map<string, string>;
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

// Sin Git, compara contenidos sin seguir enlaces ni cargar archivos grandes en memoria.
function contenidoWorkspace(cwd: string, prefijo = "", resultado = new Map<string, string>()): Map<string, string> {
  for (const nombre of readdirSync(join(cwd, prefijo))) {
    if (!prefijo && [".git", ".opencode"].includes(nombre)) continue;
    const ruta = prefijo ? prefijo + "/" + nombre : nombre;
    const absoluta = join(cwd, ruta);
    const stat = lstatSync(absoluta);
    if (stat.isSymbolicLink()) resultado.set(ruta, "enlace:" + readlinkSync(absoluta));
    else if (stat.isDirectory()) contenidoWorkspace(cwd, ruta, resultado);
    else if (stat.isFile()) resultado.set(ruta, hashDeArchivo(absoluta));
  }
  return resultado;
}

function hashDeArchivo(absoluta: string): string {
  const hash = createHash("sha256");
  const fd = openSync(absoluta, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { closeSync(fd); }
  return hash.digest("hex");
}

// Carpetas de dependencias y caché: imposibles de entregables y pesadas de vigilar.
const RUIDO_IGNORADOS = new Set([
  "node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", ".turbo",
  "target", ".gradle", "vendor", ".pytest_cache", ".mypy_cache", "site-packages",
]);
const TOPE_IGNORADOS = 400;
const TOPE_TAMANO_IGNORADO = 64 * 1024 * 1024;

function esRuido(ruta: string): boolean {
  return ruta.replace(/\\/g, "/").split("/").some((parte) => RUIDO_IGNORADOS.has(parte));
}

// Hash de los archivos ignorados que merecen vigilancia (mismo tope de archivos que el listado
// del proyecto). Un archivo que no se puede leer o pesa demasiado queda fuera del mapa.
async function mapaIgnorados(cwd: string): Promise<Map<string, string>> {
  const resultado = new Map<string, string>();
  let listado: string[];
  try {
    listado = (await git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", "."]))
      .split("\0")
      .filter(Boolean);
  } catch {
    // Sin listado de ignorados no hay comparación posible; el resto del alcance sigue.
    return resultado;
  }
  let considerados = 0;
  for (const ruta of listado) {
    if (considerados >= TOPE_IGNORADOS) break;
    if (esRuido(ruta)) continue;
    try {
      const stat = lstatSync(join(cwd, ruta));
      if (!stat.isFile() || stat.size > TOPE_TAMANO_IGNORADO) continue;
    } catch {
      continue;
    }
    try {
      resultado.set(ruta, hashDeArchivo(join(cwd, ruta)));
      considerados += 1;
    } catch {
      // El archivo ya no se puede leer: se omite del mapa.
    }
  }
  return resultado;
}

// Guarda el árbol de trabajo actual, incluidos cambios de turnos anteriores, sin crear commits.
export async function capturarAlcance(cwd: string, archivosPlan: string[], archivosInternos: string[] = []): Promise<AlcancePlan> {
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
  const gitReal = tieneGitReal(raiz);
  if (!gitReal) {
    try {
      lstatSync(join(raiz, ".git"));
      throw new Error("El workspace no tiene un repositorio Git seguro.");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const internos = archivosInternos.map(rutaDelPlan);
  if (!gitReal) return { cwd: raiz, archivos, internos, arbol: "", contenido: contenidoWorkspace(raiz) };
  const arbol = await arbolActual(raiz);
  // Con Git los ignorados son invisibles al árbol: se les saca su propio mapa de hashes.
  const ignorados = await mapaIgnorados(raiz);
  return { cwd: raiz, archivos, internos, arbol, ignorados };
}

// Solo informa: nunca revierte ni elimina los cambios que necesitan otra aprobación.
export async function comprobarAlcance(snapshot: AlcancePlan): Promise<string[]> {
  const contenido = snapshot.contenido ? contenidoWorkspace(snapshot.cwd) : null;
  const final = contenido ? "" : await arbolActual(snapshot.cwd);
  const cambiados = contenido ? [...new Set([...snapshot.contenido!.keys(), ...contenido.keys()])].filter(ruta => snapshot.contenido!.get(ruta) !== contenido.get(ruta)) : (
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
    .filter(Boolean)
    .filter((ruta) => !ruta.startsWith(".opencode/") && ruta !== ".opencode");
  // Los ignorados vigilados entran a la misma comparación: un cambio en uno de ellos cuenta
  // igual que un cambio visible en Git. Se recorre el mapa posterior para que también se
  // detecte un archivo ignorado creado durante la tarea (no estaba en el mapa inicial).
  if (snapshot.ignorados) {
    const despues = await mapaIgnorados(snapshot.cwd);
    for (const [ruta, ahora] of despues) {
      if (snapshot.ignorados.get(ruta) !== ahora) cambiados.push(ruta);
    }
  }
  return cambiados.filter((ruta) => {
    if (snapshot.internos?.includes(ruta)) return false;
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
