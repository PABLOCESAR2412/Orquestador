import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { ErrorClaveSsh, conClaveSsh, urlSshDeGithub } from "./clave-ssh";
import { git, tieneGitReal } from "./git";

// Clonado de repositorios privados de GitHub con la deploy key del proyecto.
// Flujo: el proyecto nace con su carpeta vacía y su clave. El dueño pega la clave en GitHub
// (Settings → Deploy keys; solo lectura basta para clonar) y después Telo clona por SSH.
// La clave se usa solo durante el comando (ver clave-ssh.ts). El agente nunca la recibe, y el
// token de GitHub no interviene: un token daría acceso a todos los repos, la clave solo a uno.

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
  if (/Could not resolve hostname|Connection (timed out|refused|reset)|Network is unreachable/i.test(salida)) {
    return "sin_red_github";
  }
  return "clonado_fallo";
}

export class ErrorClonado extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 409 | 502 | 503 = 502,
  ) {
    super(code);
  }
}

// Un clonado a la vez por proyecto: dos a la vez sobre la misma carpeta se pisarían.
const enCurso = new Set<string>();
const TIEMPO_CLON_MS = 5 * 60_000;

// La carpeta debe existir y estar vacía, o no existir: así el clon nunca mezcla archivos ajenos.
function prepararCarpeta(destino: string): void {
  if (!existsSync(destino)) {
    mkdirSync(destino);
    return;
  }
  if (readdirSync(destino).length > 0) throw new ErrorClonado("carpeta_no_vacia", 409);
}

// Clona el repositorio en `destino` (la carpeta del proyecto, vacía). Si falla, la carpeta vuelve a quedar vacía.
export async function clonarRepositorio(projectId: string, destino: string, urlHttps: string): Promise<void> {
  const sshUrl = urlSshDeGithub(urlHttps);
  if (!sshUrl) throw new ErrorClonado("url_no_valida", 400);
  if (enCurso.has(projectId)) throw new ErrorClonado("clonado_en_curso", 409);

  enCurso.add(projectId);
  // Un HOME temporal y sin configuración global: ni el ~/.gitconfig ni el ~/.ssh del servidor entran en el clon.
  const base = join(config.dataDir, "tmp");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const casa = mkdtempSync(join(base, "clon-"));
  try {
    prepararCarpeta(destino);
    let codigo = 1;
    let salida = "";
    try {
      await conClaveSsh(projectId, async (entorno) => {
        const r = await git(["clone", "--no-recurse-submodules", "--", sshUrl, destino], {
          cwd: dirname(destino),
          timeoutMs: TIEMPO_CLON_MS,
          env: { ...entorno, HOME: casa, GIT_CONFIG_GLOBAL: "/dev/null" },
        });
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

    if (codigo !== 0 || !tieneGitReal(destino)) {
      rmSync(destino, { recursive: true, force: true });
      mkdirSync(destino);
      throw new ErrorClonado(codigoDeErrorClon(salida));
    }
    db.query("UPDATE projects SET clonado_en = datetime('now') WHERE id = ?").run(projectId);
  } finally {
    enCurso.delete(projectId);
    rmSync(casa, { recursive: true, force: true });
  }
}
