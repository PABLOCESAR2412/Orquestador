import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { ErrorClaveSsh, conClaveSsh, urlSshDeGithub } from "./clave-ssh";
import { git, gitSeguro, tieneGitReal } from "./git";
import { redactar } from "./redaccion";

// Clonado de repositorios de GitHub.
// Flujo: primero se pregunta a GitHub sin credenciales si el repo es público (`ls-remote`). Si lo es,
// se clona por HTTPS sin clave. Si pide credenciales, es privado y se clona por SSH con la deploy key
// del proyecto. La clave se usa solo durante el comando (ver clave-ssh.ts): el agente nunca la recibe,
// y el token de GitHub no interviene (un token daría acceso a todos los repos, la clave solo a uno).
// Cada comando que corre se entrega a quien llama (`alComando`) para mostrarlo en el chat.

// Acepta https://github.com/<dueño>/<repo>(.git) y git@github.com:<dueño>/<repo>(.git). Devuelve la URL https normalizada.
const PATRON_GITHUB =
  /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/;

export function urlGithubNormalizada(entrada: string): { url: string; repo: string } | null {
  const m = PATRON_GITHUB.exec(entrada.trim());
  if (!m) return null;
  return { url: `https://github.com/${m[1]}/${m[2]}`, repo: m[2] };
}

// Traduce la salida de Git a un código para la interfaz. Nunca se muestra el texto original:
// trae rutas y el nombre del host.
export function codigoDeErrorClon(salida: string): string {
  if (/Permission denied|publickey/i.test(salida)) return "clave_no_autorizada";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(salida)) return "host_no_verificado";
  if (/Repository not found|does not appear to be a git repository/i.test(salida)) return "repo_no_encontrado";
  if (/Could not resolve host|Connection (timed out|refused|reset)|Failed to connect|Network is unreachable/i.test(salida)) {
    return "sin_red_github";
  }
  return "clonado_fallo";
}

export class ErrorClonado extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 502 | 503 = 502,
  ) {
    super(code);
  }
}

export type Visibilidad = "publico" | "privado";

// GitHub pide credenciales lo mismo para un repo privado que para uno que no existe: en ambos
// casos el repo "parece privado". Sin credenciales no hay forma de distinguirlos.
const PIDE_CREDENCIALES = /could not read Username|could not read Password|terminal prompts disabled|Authentication failed|Repository not found/i;

// Visibilidad a partir de `git ls-remote` sin credenciales. Null si no se puede saber (red, host, etc.).
export function visibilidadDe(codigo: number, salida: string): Visibilidad | null {
  if (codigo === 0) return "publico";
  if (PIDE_CREDENCIALES.test(salida)) return "privado";
  return null;
}

// Un comando que el servidor ejecutó durante el clonado. `salida` ya viene sin rutas ni secretos.
export type ComandoClonado = { comando: string; codigo: number; salida: string };
export type AlComando = (comando: ComandoClonado) => void;

export type ResultadoClonado = {
  visibilidad: Visibilidad;
  rama: string | null;
  ultimo_commit: string | null;
};

// Un clonado o una revisión a la vez por proyecto: dos a la vez sobre la misma carpeta se pisarían.
const enCurso = new Set<string>();
const TIEMPO_SONDA_MS = 30_000;
const TIEMPO_CLON_MS = 5 * 60_000;
const MAX_SALIDA = 2000;

export function clonadoEnCurso(projectId: string): boolean {
  return enCurso.has(projectId);
}

// La carpeta debe existir y estar vacía, o no existir: así el clon nunca mezcla archivos ajenos.
export function carpetaDisponible(destino: string): boolean {
  if (!existsSync(destino)) return true;
  return readdirSync(destino).length === 0;
}

function prepararCarpeta(destino: string): void {
  if (!existsSync(destino)) {
    mkdirSync(destino);
    return;
  }
  if (readdirSync(destino).length > 0) throw new ErrorClonado("carpeta_no_vacia", 409);
}

// Un HOME temporal y sin configuración global: ni el ~/.gitconfig ni el ~/.ssh del servidor entran en el clon.
function casaTemporal(): string {
  const base = join(config.dataDir, "tmp");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(base, "clon-"));
}

function entornoAislado(casa: string): Record<string, string> {
  return { HOME: casa, GIT_CONFIG_GLOBAL: "/dev/null" };
}

// Quita de la salida las rutas del servidor y los secretos conocidos antes de mostrarla.
function sanearSalida(texto: string, rutas: string[]): string {
  let limpio = texto;
  for (const ruta of rutas) limpio = limpio.split(ruta).join("<carpeta>");
  // Lo que cuelga de DATA_DIR (temporales de la clave, respaldos) tampoco sale del servidor.
  limpio = limpio.split(config.dataDir).join("<servidor>");
  return redactar(limpio.trim()).slice(0, MAX_SALIDA);
}

function codigoDeSonda(salida: string): ErrorClonado {
  const codigo = codigoDeErrorClon(salida);
  if (codigo === "clonado_fallo") return new ErrorClonado("verificacion_fallo", 502);
  return new ErrorClonado(codigo, codigo === "sin_red_github" ? 503 : 502);
}

// Pregunta a GitHub sin credenciales. No escribe nada en disco.
async function sondear(url: string, casa: string, rutas: string[], alComando?: AlComando): Promise<Visibilidad> {
  const args = ["ls-remote", "--heads", url];
  const r = await git(args, { cwd: casa, timeoutMs: TIEMPO_SONDA_MS, env: entornoAislado(casa) });
  const salida = `${r.stderr}\n${r.stdout}`;
  alComando?.({
    comando: `git ${args.join(" ")}`,
    codigo: r.code,
    salida: sanearSalida(r.code === 0 ? r.stdout : salida, rutas),
  });
  const visibilidad = visibilidadDe(r.code, salida);
  if (!visibilidad) throw codigoDeSonda(salida);
  return visibilidad;
}

// Revisa si un repo de GitHub es público o privado sin usar ninguna clave. Pensado para el formulario de proyecto nuevo.
export async function verificarRepositorio(
  entrada: string,
): Promise<{ url: string; repo: string; visibilidad: Visibilidad }> {
  const origen = urlGithubNormalizada(entrada);
  if (!origen) throw new ErrorClonado("invalid_github_url", 400);
  const casa = casaTemporal();
  try {
    const visibilidad = await sondear(origen.url, casa, [casa]);
    return { url: origen.url, repo: origen.repo, visibilidad };
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

// Clona el repositorio en `destino` (la carpeta del proyecto, vacía). Si falla, la carpeta vuelve a quedar vacía.
export async function clonarRepositorio(
  projectId: string,
  destino: string,
  urlEntrada: string,
  alComando?: AlComando,
): Promise<ResultadoClonado> {
  const origen = urlGithubNormalizada(urlEntrada);
  if (!origen) throw new ErrorClonado("url_no_valida", 400);
  if (enCurso.has(projectId)) throw new ErrorClonado("clonado_en_curso", 409);

  enCurso.add(projectId);
  const casa = casaTemporal();
  try {
    prepararCarpeta(destino);
    const rutas = [destino, casa];
    const visibilidad = await sondear(origen.url, casa, rutas, alComando);

    const ejecutar = (url: string, env: Record<string, string>) =>
      git(["clone", "--no-recurse-submodules", "--", url, destino], {
        cwd: dirname(destino),
        timeoutMs: TIEMPO_CLON_MS,
        env: { ...env, ...entornoAislado(casa) },
      });

    let codigo = 1;
    let salida = "";
    let comando = "";
    if (visibilidad === "publico") {
      comando = `git clone --no-recurse-submodules ${origen.url} .`;
      const r = await ejecutar(origen.url, {});
      codigo = r.code;
      salida = `${r.stderr}\n${r.stdout}`;
    } else {
      const sshUrl = urlSshDeGithub(origen.url);
      if (!sshUrl) throw new ErrorClonado("url_no_valida", 400);
      comando = `git clone --no-recurse-submodules ${sshUrl} .`;
      try {
        await conClaveSsh(projectId, async (entorno) => {
          const r = await ejecutar(sshUrl, entorno);
          codigo = r.code;
          salida = `${r.stderr}\n${r.stdout}`;
        });
      } catch (err) {
        if (err instanceof ErrorClaveSsh) {
          // Sin clave todavía es un paso pendiente (409); sin cifrado en el servidor, el servicio no puede clonar (503).
          throw new ErrorClonado(err.code, err.code === "clave_no_encontrada" ? 409 : 503);
        }
        throw err;
      }
    }

    const correcto = codigo === 0 && tieneGitReal(destino);
    alComando?.({ comando, codigo: correcto ? 0 : codigo || 1, salida: sanearSalida(salida, rutas) });
    if (!correcto) {
      rmSync(destino, { recursive: true, force: true });
      mkdirSync(destino);
      throw new ErrorClonado(codigoDeErrorClon(salida));
    }

    // Comprobación de lo clonado: rama y último commit. Son lecturas del clon recién hecho.
    const leer = (args: string[]) => leerDato(args, destino, casa, alComando, rutas);
    const rama = await leer(["symbolic-ref", "--short", "-q", "HEAD"]);
    const ultimo = await leer(["log", "-1", "--format=%h %s"]);

    db.query("UPDATE projects SET clonado_en = datetime('now') WHERE id = ?").run(projectId);
    return { visibilidad, rama, ultimo_commit: ultimo };
  } finally {
    enCurso.delete(projectId);
    rmSync(casa, { recursive: true, force: true });
  }
}

// Lee un dato de un repo recién clonado y lo registra como comando. Null si no se pudo leer.
async function leerDato(
  args: string[],
  destino: string,
  casa: string,
  alComando: AlComando | undefined,
  rutas: string[],
) {
  const r = await gitSeguro(args, { cwd: destino, timeoutMs: 10_000, env: entornoAislado(casa) });
  const salida = r.code === 0 ? r.stdout : `${r.stderr}\n${r.stdout}`;
  alComando?.({ comando: `git ${args.join(" ")}`, codigo: r.code, salida: sanearSalida(salida, rutas) });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
