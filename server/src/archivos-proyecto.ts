import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

// Lectura de archivos dentro de la carpeta de un proyecto. Ninguna ruta llega al disco sin pasar
// por normalizarRuta (texto) y resolverEnProyecto (realpath dentro de la raíz del proyecto).

export const LIMITE_LISTADO = 500;
export const LIMITE_LECTURA = 256 * 1024;
const LONGITUD_RUTA_MAX = 1024;
const MAX_ENTRADAS_BUSQUEDA = 20_000;
const MAX_RESULTADOS_BUSQUEDA = 9;
const CARPETAS_IGNORADAS_BUSQUEDA = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".turbo", "vendor", "target",
]);

export class ArchivoError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 415,
  ) {
    super(code);
  }
}

export type EntradaArchivo = {
  nombre: string;
  ruta: string;
  tipo: "carpeta" | "archivo";
  tamano: number | null;
  modificado: string;
};

// Convierte la ruta que llega por la API en segmentos. Vacía = la raíz del proyecto.
// Rechaza rutas absolutas, NUL, ".." y cualquier segmento ".git" (en cualquier mayúscula).
export function normalizarRuta(entrada: string | undefined): string[] {
  const ruta = entrada ?? "";
  if (ruta === "") return [];
  if (ruta.length > LONGITUD_RUTA_MAX || ruta.includes("\0")) throw new ArchivoError("invalid_project_path", 400);
  if (isAbsolute(ruta) || ruta.startsWith("\\") || /^[A-Za-z]:/.test(ruta)) {
    throw new ArchivoError("invalid_project_path", 400);
  }

  const segmentos = ruta.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  for (const s of segmentos) {
    if (s === ".." || s.toLowerCase() === ".git") throw new ArchivoError("invalid_project_path", 400);
  }
  return segmentos;
}

function dentroDe(ruta: string, raiz: string): boolean {
  return ruta === raiz || ruta.startsWith(raiz + sep);
}

// Resuelve los segmentos dentro de la raíz del proyecto siguiendo enlaces. Si el destino real
// queda fuera de la raíz (incluido por un enlace), lanza project_path_outside_root.
export function resolverEnProyecto(raizProyecto: string, segmentos: string[]): string {
  let raizReal: string;
  try {
    raizReal = realpathSync(raizProyecto);
  } catch {
    throw new ArchivoError("project_path_not_found", 404);
  }

  let real: string;
  try {
    real = realpathSync(join(raizReal, ...segmentos));
  } catch {
    throw new ArchivoError("project_path_not_found", 404);
  }
  if (!dentroDe(real, raizReal)) throw new ArchivoError("project_path_outside_root", 400);
  // Un enlace puede caer dentro del proyecto pero en su .git: eso también queda fuera.
  if (esRutaDeGit(relative(raizReal, real))) throw new ArchivoError("invalid_project_path", 400);
  return real;
}

// Verdadero si alguna parte de la ruta relativa es ".git" (en cualquier mayúscula).
function esRutaDeGit(relativa: string): boolean {
  return relativa.split(sep).some((s) => s.toLowerCase() === ".git");
}

// En Linux, /proc/self/fd dice dónde quedó abierto el archivo. Si ya no está dentro del proyecto
// (un directorio intermedio pudo cambiarse por un enlace), no se lee. Sin /proc se confía en la
// comprobación de la ruta y en O_NOFOLLOW.
function fueraDelProyecto(fd: number, raizReal: string): boolean {
  let destino: string;
  try {
    destino = readlinkSync(`/proc/self/fd/${fd}`);
  } catch {
    return false;
  }
  return !dentroDe(destino, raizReal) || esRutaDeGit(relative(raizReal, destino));
}

// Lista una carpeta del proyecto: carpetas primero, luego por nombre, sin .git, hasta 500 entradas.
export function listarCarpeta(raizProyecto: string, segmentos: string[]): EntradaArchivo[] {
  const real = resolverEnProyecto(raizProyecto, segmentos);
  if (!statSync(real).isDirectory()) throw new ArchivoError("project_path_not_directory", 400);
  const raizReal = realpathSync(raizProyecto);

  const visibles = readdirSync(real, { withFileTypes: true }).filter((d) => d.name.toLowerCase() !== ".git");

  // Los enlaces se clasifican por su destino, si está dentro del proyecto. Los demás no se siguen.
  const ordenables = visibles.map((d) => ({ dirent: d, carpeta: esCarpeta(join(real, d.name), d, raizReal) }));
  ordenables.sort((a, b) => {
    if (a.carpeta !== b.carpeta) return a.carpeta ? -1 : 1;
    return a.dirent.name.localeCompare(b.dirent.name, "es");
  });

  return ordenables.slice(0, LIMITE_LISTADO).map(({ dirent, carpeta }) => {
    const info = describir(join(real, dirent.name), dirent, raizReal);
    return {
      nombre: dirent.name,
      ruta: [...segmentos, dirent.name].join("/"),
      tipo: carpeta ? "carpeta" : "archivo",
      tamano: carpeta ? null : info.tamano,
      modificado: info.modificado,
    };
  });
}

function esCarpeta(ruta: string, dirent: Dirent, raizReal: string): boolean {
  if (!dirent.isSymbolicLink()) return dirent.isDirectory();
  try {
    const destino = realpathSync(ruta);
    return dentroDe(destino, raizReal) && statSync(destino).isDirectory();
  } catch {
    return false;
  }
}

function describir(ruta: string, dirent: Dirent, raizReal: string): { tamano: number | null; modificado: string } {
  if (dirent.isSymbolicLink()) {
    try {
      const destino = realpathSync(ruta);
      if (dentroDe(destino, raizReal)) {
        const info = statSync(destino);
        return { tamano: info.isDirectory() ? null : info.size, modificado: info.mtime.toISOString() };
      }
    } catch {
      // Enlace roto: se muestra con los datos del propio enlace.
    }
    return { tamano: null, modificado: lstatSync(ruta).mtime.toISOString() };
  }
  const info = lstatSync(ruta);
  return { tamano: info.isDirectory() ? null : info.size, modificado: info.mtime.toISOString() };
}

const decodificador = new TextDecoder("utf-8", { fatal: true });

// Decodifica UTF-8 estricto. Si el archivo se cortó, puede partirse un carácter al final: se
// quitan hasta 3 bytes finales y se vuelve a intentar.
function decodificar(bytes: Buffer, truncado: boolean): string {
  try {
    return decodificador.decode(bytes);
  } catch {
    if (truncado) {
      for (let recorte = 1; recorte <= 3 && recorte <= bytes.length; recorte++) {
        try {
          return decodificador.decode(bytes.subarray(0, bytes.length - recorte));
        } catch {
          // Sigue probando con un byte menos.
        }
      }
    }
    throw new ArchivoError("archivo_binario", 415);
  }
}

// Lee un archivo de texto de hasta 256 KB. Binario o no UTF-8 -> archivo_binario (415).
export function leerArchivo(
  raizProyecto: string,
  segmentos: string[],
): { ruta: string; tamano: number; texto: string; truncado: boolean } {
  if (segmentos.length === 0) throw new ArchivoError("invalid_project_path", 400);
  const real = resolverEnProyecto(raizProyecto, segmentos);

  // Solo archivos regulares: una carpeta, o un FIFO o socket que bloquearía la lectura, se rechazan antes de abrir.
  if (!statSync(real).isFile()) throw new ArchivoError("project_path_not_file", 400);
  // O_NOFOLLOW: si el último componente pasó a ser un enlace entre la comprobación y la apertura, falla.
  // O_NONBLOCK: si en ese instante es un FIFO, la apertura no se queda esperando a un escritor.
  let fd: number;
  try {
    fd = openSync(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch {
    throw new ArchivoError("project_path_not_file", 400);
  }
  let bytes: Buffer;
  let tamano: number;
  try {
    const info = fstatSync(fd);
    // Solo archivos regulares: una carpeta, o un FIFO o socket que bloquearía la lectura, se rechazan.
    if (!info.isFile()) throw new ArchivoError("project_path_not_file", 400);
    if (fueraDelProyecto(fd, realpathSync(raizProyecto))) throw new ArchivoError("project_path_outside_root", 400);

    tamano = info.size;
    const aLeer = Math.min(tamano, LIMITE_LECTURA);
    bytes = Buffer.alloc(aLeer);
    let leidos = 0;
    while (leidos < aLeer) {
      const n = readSync(fd, bytes, leidos, aLeer - leidos, leidos);
      if (n === 0) break;
      leidos += n;
    }
  } finally {
    closeSync(fd);
  }

  // Un NUL en cualquier parte de lo leído: se trata como binario, sin intentar decodificar.
  if (bytes.includes(0)) throw new ArchivoError("archivo_binario", 415);

  const truncado = tamano > LIMITE_LECTURA;
  return {
    ruta: segmentos.join("/"),
    tamano,
    texto: decodificar(bytes, truncado),
    truncado,
  };
}

// Busca una referencia sin carpeta dentro del proyecto cuando el modelo solo citó el nombre.
// La búsqueda no sigue enlaces y limita tanto el recorrido como los resultados.
export async function buscarArchivosPorNombre(
  raizProyecto: string,
  nombre: string,
): Promise<{ rutas: string[]; truncada: boolean }> {
  if (!nombre || nombre.length > 255 || /[\\/\0]/.test(nombre) || nombre === "." || nombre === "..") {
    return { rutas: [], truncada: false };
  }

  let raizReal: string;
  try {
    raizReal = realpathSync(raizProyecto);
  } catch {
    throw new ArchivoError("project_path_not_found", 404);
  }

  const pendientes = [{ absoluta: raizReal, relativa: "" }];
  const rutas: string[] = [];
  let visitadas = 0;
  let truncada = false;
  while (pendientes.length > 0 && rutas.length < MAX_RESULTADOS_BUSQUEDA && !truncada) {
    const actual = pendientes.pop()!;
    let entradas: Dirent[];
    try {
      entradas = await readdir(actual.absoluta, { withFileTypes: true });
    } catch {
      truncada = true;
      continue;
    }
    for (let indice = 0; indice < entradas.length; indice += 1) {
      const entrada = entradas[indice]!;
      if (++visitadas > MAX_ENTRADAS_BUSQUEDA) {
        truncada = true;
        break;
      }
      const relativa = actual.relativa ? `${actual.relativa}/${entrada.name}` : entrada.name;
      if (entrada.isFile() && entrada.name.toLowerCase() === nombre.toLowerCase()) rutas.push(relativa);
      else if (entrada.isDirectory() && !CARPETAS_IGNORADAS_BUSQUEDA.has(entrada.name.toLowerCase())) {
        pendientes.push({ absoluta: join(actual.absoluta, entrada.name), relativa });
      }
      if (rutas.length >= MAX_RESULTADOS_BUSQUEDA) {
        truncada = pendientes.length > 0 || indice < entradas.length - 1;
        break;
      }
    }
  }
  rutas.sort((a, b) => a.localeCompare(b, "es"));
  return { rutas, truncada };
}

// Tamaño y número de archivos de una carpeta. No sigue enlaces y se detiene al pasar maxEntradas.
export async function medirCarpeta(
  ruta: string,
  maxEntradas = 50_000,
): Promise<{ bytes: number; archivos: number; truncado: boolean }> {
  let bytes = 0;
  let archivos = 0;
  let visitadas = 0;
  let truncado = false;
  const pendientes: string[] = [ruta];

  while (pendientes.length > 0 && !truncado) {
    const carpeta = pendientes.pop()!;
    let entradas: Dirent[];
    try {
      entradas = await readdir(carpeta, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      if (++visitadas > maxEntradas) {
        truncado = true;
        break;
      }
      const absoluta = join(carpeta, e.name);
      if (e.isDirectory()) {
        pendientes.push(absoluta);
      } else if (e.isFile()) {
        try {
          bytes += (await lstat(absoluta)).size;
          archivos++;
        } catch {
          // Archivo que desapareció mientras se medía: se omite.
        }
      }
    }
  }
  return { bytes, archivos, truncado };
}
