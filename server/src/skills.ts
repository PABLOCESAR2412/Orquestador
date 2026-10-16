import {
  closeSync,
  constants as fc,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";

// Skills de OpenCode, en dos ámbitos:
//  - global:   ~/.config/opencode/skills/<nombre>/SKILL.md (OpenCode la lee siempre)
//  - proyecto: <carpeta del proyecto>/.opencode/skills/<nombre>/SKILL.md (OpenCode la lee desde el directorio de trabajo)
// Cada escritura va por tramos comprobados (ningún tramo puede ser enlace) y termina con un renombrado atómico.

export const LIMITE_SKILL = 64 * 1024;
const NOMBRE_MAX = 64;
const DESCRIPCION_MAX = 1024;
// Mismo patrón que exige OpenCode: minúsculas, dígitos y guiones simples entre segmentos.
const NOMBRE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARCHIVO = "SKILL.md";

export class SkillError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413,
  ) {
    super(code);
  }
}

export type AmbitoSkills = { ambito: "global" } | { ambito: "proyecto"; carpeta: string };

export type SkillResumen = {
  nombre: string;
  descripcion: string | null;
  // false si el archivo no tiene un frontmatter válido. OpenCode no la cargará hasta corregirla.
  valida: boolean;
  bytes: number;
  modificada: string;
};

export type SkillDetalle = SkillResumen & { contenido: string };

// Carpeta base y tramos que cuelgan de ella. El ámbito global cuelga del HOME del servidor, que es el del agente.
function anclaDe(ambito: AmbitoSkills): { ancla: string; tramos: string[] } {
  if (ambito.ambito === "global") return { ancla: carpetaHome(), tramos: [".config", "opencode", "skills"] };
  return { ancla: ambito.carpeta, tramos: [".opencode", "skills"] };
}

export function validarNombre(nombre: string): void {
  if (nombre.length > NOMBRE_MAX || !NOMBRE.test(nombre)) throw new SkillError("skill_nombre_invalido", 400);
}

// Recorre los tramos desde la base. Cualquier tramo que sea enlace o archivo se rechaza.
// Con `crear`, los tramos que falten se crean; sin él, devuelve null si la carpeta no existe.
function carpetaSegura(ancla: string, tramos: string[], crear: boolean): string | null {
  let actual = ancla;
  for (const tramo of tramos) {
    actual = join(actual, tramo);
    let existe = true;
    try {
      lstatSync(actual);
    } catch {
      existe = false;
    }
    if (!existe) {
      if (!crear) return null;
      mkdirSync(actual);
      continue;
    }
    if (!lstatSync(actual).isDirectory()) throw new SkillError("skill_ruta_no_permitida", 400);
  }
  return actual;
}

// Datos del frontmatter YAML: solo claves de primer nivel con valor de una línea, o bloque > / | para la descripción.
export function leerFrontmatter(texto: string): Record<string, string> | null {
  const cabecera = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texto);
  if (!cabecera) return null;
  const lineas = cabecera[1]!.split(/\r?\n/);
  const campos: Record<string, string> = {};
  for (let i = 0; i < lineas.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lineas[i]!);
    if (!m) continue;
    const clave = m[1]!;
    let valor = m[2]!.trim();
    if (valor === ">" || valor === "|" || valor === ">-" || valor === "|-") {
      const bloque: string[] = [];
      while (i + 1 < lineas.length && /^\s+\S/.test(lineas[i + 1]!)) bloque.push(lineas[++i]!.trim());
      valor = bloque.join(valor.startsWith(">") ? " " : "\n");
    } else if (/^(["']).*\1$/.test(valor)) {
      valor = valor.slice(1, -1);
    }
    campos[clave] = valor;
  }
  return campos;
}

// Valida el contenido: frontmatter, nombre igual a la carpeta y descripción de 1 a 1024 caracteres.
export function validarContenido(texto: string, nombre: string): { descripcion: string } {
  const campos = leerFrontmatter(texto);
  if (!campos) throw new SkillError("skill_sin_frontmatter", 400);
  if (campos.name !== nombre) throw new SkillError("skill_nombre_no_coincide", 400);
  const descripcion = (campos.description ?? "").trim();
  if (descripcion.length === 0) throw new SkillError("skill_sin_descripcion", 400);
  if (descripcion.length > DESCRIPCION_MAX) throw new SkillError("skill_descripcion_larga", 400);
  return { descripcion };
}

function leerArchivo(ruta: string): { texto: string; bytes: number; modificada: string } {
  const stLink = lstatORNull(ruta);
  if (!stLink) throw new SkillError("skill_no_encontrada", 404);
  if (stLink.isSymbolicLink()) throw new SkillError("skill_ruta_no_permitida", 400);
  let fd: number;
  try {
    fd = openSync(ruta, fc.O_RDONLY | fc.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new SkillError("skill_no_encontrada", 404);
    throw new SkillError("skill_ruta_no_permitida", 400);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new SkillError("skill_ruta_no_permitida", 400);
    if (st.size > LIMITE_SKILL) throw new SkillError("skill_demasiado_grande", 413);
    const buffer = Buffer.alloc(st.size);
    let leido = 0;
    while (leido < st.size) {
      const n = readSync(fd, buffer, leido, st.size - leido, leido);
      if (n === 0) break;
      leido += n;
    }
    return { texto: buffer.subarray(0, leido).toString("utf8"), bytes: leido, modificada: st.mtime.toISOString() };
  } finally {
    closeSync(fd);
  }
}

// lstat sin seguir enlaces: un enlace roto cuenta como existente (y se rechaza más adelante).
function lstatORNull(ruta: string) {
  try {
    return lstatSync(ruta);
  } catch {
    return null;
  }
}

function resumenDe(nombre: string, texto: string, bytes: number, modificada: string): SkillResumen {
  let descripcion: string | null = null;
  let valida = false;
  try {
    descripcion = validarContenido(texto, nombre).descripcion;
    valida = true;
  } catch {
    valida = false;
  }
  return { nombre, descripcion, valida, bytes, modificada };
}

// Lista las carpetas con SKILL.md. Las que no tienen nombre válido o no tienen el archivo se ignoran.
export function listarSkills(ambito: AmbitoSkills): SkillResumen[] {
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) return [];
  const resultado: SkillResumen[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory() || entrada.name.length > NOMBRE_MAX || !NOMBRE.test(entrada.name)) continue;
    const ruta = join(dir, entrada.name, ARCHIVO);
    try {
      const archivo = leerArchivo(ruta);
      resultado.push(resumenDe(entrada.name, archivo.texto, archivo.bytes, archivo.modificada));
    } catch (err) {
      // Sin archivo, o que no es un archivo regular (enlace, carpeta): no es una skill. Un archivo demasiado
      // grande sí aparece, marcado como no válido, para que la persona vea por qué no carga.
      if (!(err instanceof SkillError)) throw err;
      if (err.code === "skill_demasiado_grande") {
        const st = lstatORNull(ruta);
        resultado.push({
          nombre: entrada.name,
          descripcion: null,
          valida: false,
          bytes: st?.size ?? 0,
          modificada: st?.mtime.toISOString() ?? "",
        });
      }
    }
  }
  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function leerSkill(ambito: AmbitoSkills, nombre: string): SkillDetalle {
  validarNombre(nombre);
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) throw new SkillError("skill_no_encontrada", 404);
  const archivo = leerArchivo(join(dir, nombre, ARCHIVO));
  return { ...resumenDe(nombre, archivo.texto, archivo.bytes, archivo.modificada), contenido: archivo.texto };
}

// Guarda la skill. Rechaza lo que OpenCode no cargaría y cualquier texto con un secreto conocido:
// esa versión se rechaza en vez de guardarse redactada, para no pisar al editar.
export function guardarSkill(ambito: AmbitoSkills, nombre: string, contenido: string): { creada: boolean } {
  validarNombre(nombre);
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_SKILL) throw new SkillError("skill_demasiado_grande", 413);
  validarContenido(contenido, nombre);
  if (redactar(contenido, valoresDeConfiguracion()) !== contenido) {
    throw new SkillError("skill_contiene_secreto", 400);
  }

  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, true)!;
  const carpeta = join(dir, nombre);
  const datosCarpeta = lstatORNull(carpeta);
  if (!datosCarpeta) mkdirSync(carpeta);
  else if (!datosCarpeta.isDirectory()) throw new SkillError("skill_ruta_no_permitida", 400);

  const destino = join(carpeta, ARCHIVO);
  const creada = lstatORNull(destino) === null;
  const temporal = join(carpeta, `.${ARCHIVO}.${randomUUID()}.tmp`);
  const fd = openSync(temporal, fc.O_WRONLY | fc.O_CREAT | fc.O_EXCL | fc.O_NOFOLLOW, 0o644);
  try {
    const bytes = Buffer.from(contenido, "utf8");
    let escrito = 0;
    while (escrito < bytes.length) escrito += writeSync(fd, bytes, escrito, bytes.length - escrito);
    fsyncSync(fd);
  } catch {
    closeSync(fd);
    unlinkSync(temporal);
    throw new SkillError("skill_no_guardada", 400);
  }
  closeSync(fd);
  try {
    renameSync(temporal, destino);
  } catch {
    unlinkSync(temporal);
    throw new SkillError("skill_no_guardada", 400);
  }
  if (ambito.ambito === "proyecto") {
    try {
      const skillsDir = carpetaSegura(ambito.carpeta, ["skills"], true);
      if (skillsDir) {
        const sub = join(skillsDir, nombre);
        if (!lstatORNull(sub)) mkdirSync(sub, { recursive: true });
        const destVisible = join(sub, ARCHIVO);
        const tmpVisible = join(sub, `.${ARCHIVO}.${randomUUID()}.tmp`);
        const fdVis = openSync(tmpVisible, fc.O_WRONLY | fc.O_CREAT | fc.O_EXCL | fc.O_NOFOLLOW, 0o644);
        try {
          const b = Buffer.from(contenido, "utf8");
          let esc = 0;
          while (esc < b.length) esc += writeSync(fdVis, b, esc, b.length - esc);
          fsyncSync(fdVis);
        } finally {
          closeSync(fdVis);
        }
        renameSync(tmpVisible, destVisible);
      }
    } catch {
      // Si la carpeta skills/ no se puede escribir, no falla la operación principal (.opencode/skills).
    }
  }
  return { creada };
}

// Borra SKILL.md y su carpeta. Si hay otros archivos dentro, no toca nada: esos los quita la persona en su equipo.
export function borrarSkill(ambito: AmbitoSkills, nombre: string): void {
  validarNombre(nombre);
  const { ancla, tramos } = anclaDe(ambito);
  const dir = carpetaSegura(ancla, tramos, false);
  if (!dir) throw new SkillError("skill_no_encontrada", 404);
  const carpeta = join(dir, nombre);
  let st;
  try {
    st = lstatSync(carpeta);
  } catch {
    throw new SkillError("skill_no_encontrada", 404);
  }
  if (!st.isDirectory()) throw new SkillError("skill_ruta_no_permitida", 400);
  const entradas = readdirSync(carpeta);
  if (entradas.some((e) => e !== ARCHIVO)) throw new SkillError("skill_con_archivos", 409);
  if (entradas.length === 1) unlinkSync(join(carpeta, ARCHIVO));
  rmdirSync(carpeta);

  if (ambito.ambito === "proyecto") {
    try {
      const dirVis = carpetaSegura(ambito.carpeta, ["skills"], false);
      if (dirVis) {
        const subVis = join(dirVis, nombre);
        if (lstatORNull(subVis)?.isDirectory()) {
          const destVis = join(subVis, ARCHIVO);
          if (lstatORNull(destVis)?.isFile()) unlinkSync(destVis);
          rmdirSync(subVis);
        }
      }
    } catch {
      // Ignorar fallo secundario en la carpeta visible
    }
  }
}

// Crea la carpeta de skills globales si falta. Se llama al arrancar: así bubblewrap siempre puede montarla en
// solo lectura (si no existiera, el agente podría crearla dentro de ~/.config/opencode, que sí es escribible).
export function prepararCarpetaGlobal(): void {
  const { ancla, tramos } = anclaDe({ ambito: "global" });
  carpetaSegura(ancla, tramos, true);
}
