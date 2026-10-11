// Llamadas a Git desde el servidor. Corren fuera del aislamiento del agente.
//
// Riesgo: el agente escribe dentro del clon (incluido su .git/config). Si el servidor usa ese
// repo tal cual, un filtro, un fsmonitor o una reescritura de URL (url.*.insteadOf) podría
// ejecutar comandos fuera de la sandbox o enviar el token de GitHub a otro host.
// Por eso: (1) los comandos del servidor ignoran hooks, fsmonitor, pager y credenciales del repo;
// (2) antes de operar sobre un repo que el agente pudo tocar, `gitSeguro` quita de su configuración
// local las claves peligrosas. Usa `gitSeguro` para cualquier repo de proyecto o clon.
// Además, `config.worktree` (que Git lee con extensions.worktreeConfig y `config --local` no muestra)
// se quita antes de operar. Y `.git` debe ser una carpeta real: un archivo gitdir o un enlace puede
// apuntar a otro repo, fuera del proyecto.

import { lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export class GitError extends Error {
  constructor(
    readonly code: "git_failed" | "git_timeout",
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export type GitResultado = { code: number; stdout: string; stderr: string };

const TIEMPO_MAX_MS = 120_000;

// Flags que van antes de cualquier subcomando. Anulan lo que pueda haber en .git/config del repo.
const FLAGS_SEGURAS = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.pager=cat",
  "-c", "core.askPass=/bin/false",
  "-c", "credential.helper=",
];

// Claves de configuración que el agente no debe poder usar a través del repo.
const CLAVES_PELIGROSAS: RegExp[] = [
  /^filter\./i,
  /^diff\./i,
  /^url\./i,
  /^http\./i,
  /^credential\./i,
  /^include(if)?\./i,
  /^alias\./i,
  /^gpg\./i,
  /^sendemail\./i,
  /^protocol\./i,
  /^(uploadpack|receive|transfer|pack)\./i,
  /^core\.(fsmonitor|hookspath|sshcommand|pager|askpass|editor|worktree|gitdir|attributesfile|excludesfile|gitproxy|alternaterefscommand)$/i,
  /^remote\.[^.]+\.(pushurl|receivepack|uploadpack|vcs|proxy|mirror)$/i,
];

// Ejecuta git y devuelve la salida sin lanzar error si el código no es 0.
export async function git(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; stdin?: string },
): Promise<GitResultado> {
  const proc = Bun.spawn(["git", ...FLAGS_SEGURAS, ...args], {
    cwd: opts.cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LC_ALL: "C.UTF-8",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
      GIT_CONFIG_NOSYSTEM: "1",
      ...opts.env,
    },
    stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(9), opts.timeoutMs ?? TIEMPO_MAX_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

// Igual que git(), pero lanza GitError si el comando falla. El mensaje es el de Git.
export async function gitOk(args: string[], opts: Parameters<typeof git>[1]): Promise<string> {
  const r = await git(args, opts);
  if (r.code !== 0) {
    throw new GitError("git_failed", (r.stderr || r.stdout).trim().slice(-600) || `git salió con código ${r.code}`);
  }
  return r.stdout;
}

// Quita de la configuración local del repo las claves peligrosas. Devuelve las que quitó.
// Nunca toca la configuración global ni la del sistema. Si `cwd` no es un repo con .git propio,
// no hace nada: `git config --local` subiría por las carpetas y tocaría un repo ajeno.
export async function sanearConfiguracionRepo(cwd: string): Promise<string[]> {
  if (!tieneGitReal(cwd)) return [];
  const lista = await git(["config", "--local", "--name-only", "--list"], { cwd });
  if (lista.code !== 0) return [];
  const claves = [...new Set(lista.stdout.split("\n").map((l) => l.trim()).filter(Boolean))];
  const quitadas: string[] = [];
  for (const clave of claves) {
    if (!CLAVES_PELIGROSAS.some((re) => re.test(clave))) continue;
    const r = await git(["config", "--local", "--unset-all", clave], { cwd });
    if (r.code === 0) quitadas.push(clave);
  }
  return quitadas;
}

// Sanea el repo y luego ejecuta el comando. Úsalo en cualquier repo de proyecto o de clon.
export async function gitSeguro(args: string[], opts: Parameters<typeof git>[1]): Promise<GitResultado> {
  await sanearConfiguracionRepo(opts.cwd);
  return git(args, opts);
}

// Igual que gitOk, pero sanea el repo antes.
export async function gitOkSeguro(args: string[], opts: Parameters<typeof git>[1]): Promise<string> {
  await sanearConfiguracionRepo(opts.cwd);
  return gitOk(args, opts);
}

// `ruta/.git` debe ser una carpeta real con config regular. Un archivo gitdir o un enlace no sirven.
export function tieneGitReal(ruta: string): boolean {
  try {
    const dirGit = join(ruta, ".git");
    return lstatSync(dirGit).isDirectory() && lstatSync(join(dirGit, "config")).isFile();
  } catch {
    return false;
  }
}

// Prepara un repo que el agente pudo escribir, antes de cualquier operación sobre él: quita
// config.worktree y sanea la configuración local. Devuelve false si no hay un .git real.
export async function prepararRepoSeguro(ruta: string): Promise<boolean> {
  if (!tieneGitReal(ruta)) return false;
  try {
    unlinkSync(join(ruta, ".git", "config.worktree"));
  } catch {
    // No existe, o no es un archivo: Git no lo usa como configuración.
  }
  await sanearConfiguracionRepo(ruta);
  return true;
}

// Un repo válido tiene árbol de trabajo. Sirve para decidir si un proyecto puede clonarse.
export async function esRepositorio(cwd: string): Promise<boolean> {
  const r = await git(["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

// Quita usuario y contraseña de una URL antes de mostrarla o guardarla. Así un token que alguien
// pegó en el remoto nunca llega a la API ni a la base.
export function urlSinCredenciales(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    // scp-like (git@host:ruta) u otra forma que URL no entiende: se devuelve sin el usuario.
    return url.replace(/^[^@/]+@/, "");
  }
}

// Borra del texto cualquier valor sensible conocido (p. ej. un token que Git haya repetido en un error).
export function ocultarValores(texto: string, valores: string[]): string {
  let salida = texto;
  for (const v of valores) {
    if (v.length >= 6) salida = salida.split(v).join("[oculto]");
  }
  return salida;
}

// Alias con el nombre que usa workspace.ts.
export const sanearConfiguracion = sanearConfiguracionRepo;
