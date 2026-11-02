import { createHash } from "node:crypto";
import {
  copyFileSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { registrarEvento } from "./eventos";
import { clavePublicaDe, conClaveSsh, urlSshDeGithub } from "./clave-ssh";
import {
  esRepositorio,
  GitError,
  gitOk,
  gitOkSeguro,
  gitSeguro,
  prepararRepoSeguro,
  urlSinCredenciales,
} from "./git";
import { archivosConSecretos, archivosConSecretosEnBlobs, redactar } from "./redaccion";
import { valorSecreto, valoresDeProyecto } from "./secretos";
import { tokenGithubGlobal, autorGit } from "./github-auth";
import { tokenGithubAppParaRepo } from "./github-app";
import { opcionesDeCredenciales } from "./git-credenciales";
import { eliminarPerfilCodex, eliminarPerfilOpenCode, prepararDirectorioOpenCode } from "./runners/aislamiento";
import { enMantenimiento, registrarTrabajo } from "./despliegue";
export { opcionesDeCredenciales } from "./git-credenciales";

// Copias de trabajo de las tareas de proyecto con Git. Cada tarea trabaja en su clon
// (DATA_DIR/tasks/<id>/repo, rama telo/<id8>). Nada sale a GitHub sin aprobación del usuario:
// una sola autorización de subida cubre commit y push, contra el hash del diff.
//
// El clon lo escribe un agente que corre aislado, así que su .git no es de confianza: antes de
// cada operación de Git se sanea su configuración. La subida nunca usa el remoto del clon: usa la
// URL que se guardó al crear el clon en remoto.txt (DATA_DIR/tasks/<id>, fuera del alcance del
// agente), y solo se admite https://github.com/<dueño>/<repo>. Si el proyecto tiene clave SSH
// (clave-ssh.ts), la subida usa la App si está vinculada y da tokens acotados; conserva SSH y
// tokens antiguos como compatibilidad durante la transición.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const TOPE_DIFF = 400 * 1024;
// Tope del escaneo de blobs antes del commit: por archivo y en total (caracteres). Un blob
// que pasa el tope no se recorta y olvidar: queda en `sinVerificar` y bloquea el commit.
const TOPE_ESCANEO_ARCHIVO = 16_000_000;
const TOPE_ESCANEO_TOTAL = 64_000_000;
const TIEMPO_CLON_MS = 10 * 60_000;
const TIEMPO_ESTADO_MS = 5 * 60_000;
const TIEMPO_PUSH_MS = 5 * 60_000;
const MAX_MENSAJE = 200;
const DIAS_CONSERVAR = 14;
const CADA_LIMPIEZA_MS = 6 * 3600_000;
// Archivo con la URL de subida de la tarea, junto al clon y fuera de su alcance.
const NOMBRE_REMOTO = "remoto.txt";
// Único remoto admitido: GitHub por https, sin credenciales, puerto ni otra ruta. Acepta el .git final.
const URL_GITHUB =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_][A-Za-z0-9_.-]*?)(?:\.git)?$/i;

// Patrones de nombre que parecen secretos. Se comparan con el nombre del archivo, en minúsculas.
const PATRONES_SENSIBLES = [
  /^\.env(\.(local|production|prod|staging|dev|development))?$/,
  /\.(pem|key|p12|pfx)$/,
  /^id_(rsa|ed25519)$/,
  /^credentials(\.(json|yaml|yml|env|txt))?$/,
  /(^|[._-])secrets?(\.(json|yaml|yml|env|txt))$/,
];

const SUFIJOS_EJEMPLO = [
  ".example",
  ".sample",
  ".template",
  ".dist",
  ".default",
  ".defaults",
  ".schema",
];

// Error con código para la interfaz. Los códigos se traducen en web/src/lib/model.ts.
export class ErrorTarea extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 502,
    readonly detail?: string,
  ) {
    super(code);
  }
}

export type ArchivoDiff = {
  ruta: string;
  estado: "nuevo" | "modificado" | "borrado" | "renombrado";
  adiciones: number;
  eliminaciones: number;
  binario: boolean;
  sensible: boolean;
};

export type Preparada = {
  cwd: string;
  rama: string | null;
  base_commit: string | null;
  copia: boolean;
};

type FilaTarea = {
  id: string;
  status: string;
  rama: string | null;
  base_commit: string | null;
  project_id: string | null;
  source_branch: string | null;
  source_base_branch: string | null;
  source_pr_number: number | null;
  source_commit: string | null;
};

type FilaAprobacion = {
  commit_sha: string | null;
  diff_hash: string | null;
  detalle: string | null;
  rama: string | null;
  remoto: string | null;
  autenticacion: string | null;
  created_at: string;
};

export type FuenteCredencialGithub = {
  tipo: "github_app" | "credencial_anterior" | "clave_ssh" | "ninguna";
  origen: "app" | "sesion_anterior" | "token_proyecto" | "token_pr_proyecto" | "ssh" | "ninguna";
  etiqueta: string;
  cuenta: string | null;
  instalacion_id: number | null;
};

type Contexto = { clon: string; projectId: string | null; rama: string; base: string };

export function esIdTarea(id: string): boolean {
  return UUID.test(id);
}

export function ramaDeTarea(taskId: string): string {
  return `telo/${taskId.slice(0, 8)}`;
}

// El id de tarea entra en una ruta de disco: se valida antes de usarlo.
function carpetaTarea(taskId: string): string {
  if (!UUID.test(taskId)) throw new ErrorTarea("task_not_found", 404);
  return join(resolve(config.dataDir), "tasks", taskId);
}

export function rutaClon(taskId: string): string {
  return join(carpetaTarea(taskId), "repo");
}

// Quita del texto lo que no debe salir del servidor: tokens, credenciales en URLs y rutas de disco.
export function sanear(texto: string, secreto?: string | null): string {
  let limpio = texto;
  if (secreto) limpio = limpio.split(secreto).join("***");
  const marcas: [string, string][] = [[config.dataDir, "<datos>"]];
  if (config.projectsDir) marcas.push([config.projectsDir, "<proyectos>"]);
  for (const [ruta, marca] of marcas) {
    for (const variante of variantesDeRuta(ruta)) limpio = limpio.split(variante).join(marca);
  }
  limpio = limpio.replace(/(https?:\/\/)[^\s/@]+@/gi, "$1***@").trim();
  // Credenciales con formato conocido y valores de TELO_CLAVE (ver redaccion.ts).
  return redactar(limpio);
}

function variantesDeRuta(ruta: string): string[] {
  const absoluta = resolve(ruta);
  try {
    const real = realpathSync(absoluta);
    return real !== absoluta ? [absoluta, real] : [absoluta];
  } catch {
    return [absoluta];
  }
}

export function mensajeSeguro(err: unknown, secreto?: string | null): string {
  const mensaje = err instanceof Error ? err.message : String(err);
  return sanear(mensaje, secreto).slice(0, 800);
}

// Devuelve la URL normalizada de GitHub (sin .git final) o null si no es un destino permitido.
// Rechaza credenciales, puertos, otros hosts, rutas locales y cualquier otro esquema.
export function urlGithubPermitida(url: string): string | null {
  const m = URL_GITHUB.exec(url.trim());
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

export function esSensible(ruta: string): boolean {
  const nombre = (ruta.split("/").pop() ?? ruta).toLowerCase();
  if (SUFIJOS_EJEMPLO.some((sufijo) => nombre.endsWith(sufijo))) return false;
  if (/\.env\.(example|sample|template|dist|default|test)/.test(nombre)) return false;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|html|css|scss|less)$/.test(nombre)) return false;
  return PATRONES_SENSIBLES.some((patron) => patron.test(nombre));
}

// Serializa las operaciones sobre una misma tarea (aprobar, preparar, limpiar).
const cerrojos = new Map<string, Promise<unknown>>();

export function conTarea<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const previo = cerrojos.get(taskId) ?? Promise.resolve();
  const actual = previo.catch(() => {}).then(fn);
  const fin = actual.catch(() => {});
  cerrojos.set(taskId, fin);
  void fin.then(() => {
    if (cerrojos.get(taskId) === fin) cerrojos.delete(taskId);
  });
  return actual;
}

// Antes de leer el repo se sanea su configuración: en un proyecto, el agente pudo escribirla.
async function esRaizGit(ruta: string): Promise<boolean> {
  if (!existsSync(ruta) || !(await prepararRepoSeguro(ruta))) return false;
  if (!(await esRepositorio(ruta))) return false;
  const r = await gitSeguro(["rev-parse", "--show-toplevel"], { cwd: ruta });
  if (r.code !== 0) return false;
  try {
    return realpathSync(r.stdout.trim()) === realpathSync(ruta);
  } catch {
    return false;
  }
}

function esArchivo(ruta: string): boolean {
  try {
    return lstatSync(ruta).isFile();
  } catch {
    return false;
  }
}

// URL de origen del proyecto, sin credenciales (un token pegado en el remoto no se guarda). La
// validación de destino ocurre al subir. Vacío si el proyecto no tiene origen.
async function origenDelProyecto(repoPath: string): Promise<string> {
  const r = await gitSeguro(["config", "--get", "remote.origin.url"], { cwd: repoPath });
  return r.code === 0 ? urlSinCredenciales(r.stdout.trim()) : "";
}

const TIEMPO_SINCRONIZAR_MS = 15_000;

// Token de lectura para traer la punta del remoto a la copia local: la misma cadena de credenciales
// del proyecto (App vinculada, sesión de GitHub o GITHUB_TOKEN del proyecto). Sin remoto de GitHub
// o sin credencial, se intenta la conexión sin autenticación (solo alcanza en repositorios públicos).
async function tokenDeLectura(para: {
  projectId: string | null;
  remoto: string | null;
}): Promise<ReturnType<typeof opcionesDeCredenciales>> {
  if (!para.remoto) return opcionesDeCredenciales(null);
  let token: string | null = null;
  try {
    token = await tokenGithubAppParaRepo(para.remoto, { contents: "read" });
  } catch {
    // La credencial anterior sigue disponible si la App no tiene acceso.
  }
  if (!token) token = tokenGithubGlobal();
  if (!token && para.projectId) token = valorSecreto(para.projectId, "GITHUB_TOKEN");
  return opcionesDeCredenciales(token);
}

// Pone la copia local del proyecto al día con su origin antes de clonarla para la tarea. Una copia
// vieja produce tareas con base desactualizada y subidas rechazadas por non-fast-forward.
// Reglas de seguridad: solo si el HEAD está en una rama, la copia está limpia (los cambios
// pendientes del usuario se respetan), y el avance es fast-forward. Si no hay conexión, credenciales
// u origin, la copia queda como estaba y la tarea sigue con lo disponible.
async function traerRepoLocalAlDia(repoPath: string, projectId: string | null): Promise<string | null> {
  try {
    const rama = (
      await gitOkSeguro(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS })
    ).trim();
    if (!rama || rama === "HEAD") return null;
    const rRemoto = await gitSeguro(["config", "--get", "remote.origin.url"], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS });
    if (rRemoto.code !== 0 || !rRemoto.stdout.trim()) return null;
    const estado = await gitSeguro(["status", "--porcelain", "--untracked-files=no"], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS });
    if (estado.code !== 0 || estado.stdout.trim() !== "") return null;
    const remoto = urlGithubPermitida(urlSinCredenciales(rRemoto.stdout.trim()));
    const credenciales = await tokenDeLectura({ projectId, remoto });
    await gitOkSeguro([...credenciales.args, "fetch", "origin", rama], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS, env: credenciales.env });
    const punta = (
      await gitOkSeguro(["rev-parse", `refs/remotes/origin/${rama}`], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS })
    ).trim();
    const local = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS })).trim();
    if (!punta || punta === local) return null;
    await gitOkSeguro(["merge", "--ff-only", `origin/${rama}`], { cwd: repoPath, timeoutMs: TIEMPO_SINCRONIZAR_MS, env: credenciales.env });
    return punta;
  } catch {
    // Sin conexión o con historial divergente: la copia local queda como está.
    return null;
  }
}

// Antes de cada operación sobre el clon: .git debe ser una carpeta real, se quita config.worktree
// y se sanea la configuración (ver prepararRepoSeguro en git.ts).
async function prepararRepo(clon: string): Promise<void> {
  if (!(await prepararRepoSeguro(clon))) throw new ErrorTarea("task_without_repo", 409);
  if (!(await esRaizGit(clon))) throw new ErrorTarea("task_without_repo", 409);
}

function rutaRemoto(taskId: string): string {
  return join(carpetaTarea(taskId), NOMBRE_REMOTO);
}

// Null si el archivo no existe; si existe, su contenido sin espacios (vacío = el proyecto no tenía origen).
function leerRemoto(taskId: string): string | null {
  const ruta = rutaRemoto(taskId);
  if (!esArchivo(ruta)) return null;
  return readFileSync(ruta, "utf8").trim();
}

// Se escribe en un temporal y se renombra encima: un enlace previo se reemplaza, nunca se sigue.
function escribirRemoto(taskId: string, url: string): void {
  const ruta = rutaRemoto(taskId);
  const temporal = `${ruta}.tmp`;
  rmSync(temporal, { recursive: true, force: true });
  writeFileSync(temporal, url + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporal, ruta);
}

function filaTarea(taskId: string): FilaTarea {
  const fila = db
    .query<
      FilaTarea,
      [string]
    >("SELECT id, status, rama, base_commit, project_id, source_branch, source_base_branch, source_pr_number, source_commit FROM tasks WHERE id = ?")
    .get(taskId);
  if (!fila) throw new ErrorTarea("task_not_found", 404);
  return fila;
}

// Datos para operar sobre el clon. Falla con task_running o task_without_repo.
async function contextoGit(taskId: string): Promise<Contexto> {
  const fila = filaTarea(taskId);
  // En cola también cuenta: el worker la marca "running" justo después de preparar el clon, y no
  // debe haber git del servidor sobre el clon mientras el agente arranca.
  if (fila.status === "running" || fila.status === "queued" || fila.status === "analyzing")
    throw new ErrorTarea("task_running", 409);
  if (!fila.rama || !fila.base_commit) throw new ErrorTarea("task_without_repo", 409);

  const clon = rutaClon(taskId);
  await prepararRepo(clon);
  return { clon, projectId: fila.project_id, rama: fila.rama, base: fila.base_commit };
}

async function existeCommit(clon: string, sha: string): Promise<boolean> {
  if (!SHA.test(sha)) return false;
  const r = await gitSeguro(["cat-file", "-e", `${sha}^{commit}`], { cwd: clon });
  return r.code === 0;
}

function esCarpetaReal(ruta: string): boolean {
  try {
    return lstatSync(ruta).isDirectory();
  } catch {
    return false;
  }
}

function prepararDestinoSkills(ruta: string): void {
  let existente = resolve(ruta);
  while (true) {
    try {
      const info = lstatSync(existente);
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(existente) !== existente)
        throw new Error("El destino de skills contiene enlaces o no es una carpeta real.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const padre = dirname(existente);
      if (padre === existente) throw error;
      existente = padre;
    }
  }
  mkdirSync(ruta, { recursive: true });
}

// La reanudación vuelve a copiar sobre un destino que el agente pudo modificar.
export function copiarCarpetaSana(origen: string, destino: string): void {
  if (!lstatSync(origen).isDirectory()) throw new Error("El origen de la copia no es una carpeta real.");
  prepararDestinoSkills(destino);
  for (const entrada of readdirSync(origen, { withFileTypes: true })) {
    if (entrada.isSymbolicLink()) continue;
    const de = join(origen, entrada.name);
    const a = join(destino, entrada.name);
    if (entrada.isDirectory()) copiarCarpetaSana(de, a);
    else if (entrada.isFile()) {
      try {
        if (!lstatSync(a).isFile()) throw new Error("El archivo de destino de skills no es regular.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // Reemplazar el archivo evita escribir a través de un enlace duro preexistente.
      const temporal = join(destino, `.telo-skill-${crypto.randomUUID()}.tmp`);
      try {
        copyFileSync(de, temporal, fsConstants.COPYFILE_EXCL);
        renameSync(temporal, a);
      } finally {
        rmSync(temporal, { force: true });
      }
    }
  }
}

// Sincroniza las carpetas de skills del proyecto hacia el clon del workspace,
// asegurando que las skills locales y no commiteadas estén disponibles para el agente.
export async function sincronizarSkillsDeProyecto(repoPath: string, clon: string): Promise<void> {
  const opencodeDir = prepararDirectorioOpenCode(clon);

  // Pre-crea .opencode/.gitignore para que OpenCode no intente crearlo sobre un sistema de archivos solo lectura
  const gitignorePath = join(opencodeDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "*\n!.gitignore\n!skills/\n", { encoding: "utf-8", flag: "wx" });
  }

  // Asegura que Git en el clon ignore completamente la carpeta .opencode para que las skills
  // sincronizadas no aparezcan jamás como archivos modificados o pendientes de commit en el repo del proyecto.
  const gitDir = join(clon, ".git");
  if (existsSync(gitDir)) {
    const infoDir = join(gitDir, "info");
    mkdirSync(infoDir, { recursive: true });
    const excludeFile = join(infoDir, "exclude");
    let contenido = existsSync(excludeFile) ? readFileSync(excludeFile, "utf-8") : "";
    if (!contenido.includes(".opencode")) {
      contenido = `${contenido.trim()}\n.opencode\n.opencode/\n`;
      writeFileSync(excludeFile, contenido.trim() + "\n", "utf-8");
    }
  }

  const manifiesto = join(clon, ".git", "telo-skills.json");
  let anteriores: string[] = [];
  if (existsSync(manifiesto)) {
    const stat = lstatSync(manifiesto);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("El manifiesto de skills no es seguro.");
    const datos: unknown = JSON.parse(readFileSync(manifiesto, "utf8"));
    if (!Array.isArray(datos) || !datos.every((p) => typeof p === "string")) throw new Error("El manifiesto de skills no es válido.");
    anteriores = datos;
  }
  const actuales: string[] = [];
  for (const relativa of [".opencode/skills", "skills"]) {
    const origen = join(repoPath, relativa), destino = join(clon, relativa);
    prepararDestinoSkills(destino);
    const nombres = esCarpetaReal(origen) ? readdirSync(origen, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && existsSync(join(origen, e.name, "SKILL.md"))).map((e) => e.name) : [];
    for (const entrada of readdirSync(destino, { withFileTypes: true })) {
      const ruta = join(destino, entrada.name), clave = `${relativa}/${entrada.name}`;
      if (nombres.includes(entrada.name) || !existsSync(join(ruta, "SKILL.md"))) continue;
      if (!entrada.isDirectory() || entrada.isSymbolicLink()) throw new Error("Una skill retirada contiene un enlace no seguro.");
      if (!anteriores.includes(clave)) {
        const tracked = await gitSeguro(["ls-files", "--", clave], { cwd: clon });
        if (tracked.code !== 0 || tracked.stdout.trim()) throw new Error(`Revisa la skill retirada ${clave} del clon antiguo antes de reanudar; sus archivos versionados se conservan.`);
      }
      // Preserva también cambios locales: se retira del descubrimiento, nunca se destruye.
      const archivo = join(config.dataDir, "skills-retiradas", crypto.randomUUID());
      prepararDestinoSkills(archivo);
      renameSync(ruta, join(archivo, entrada.name));
    }
    if (esCarpetaReal(origen)) copiarCarpetaSana(origen, destino);
    actuales.push(...nombres.map((nombre) => `${relativa}/${nombre}`));
  }
  const temporal = `${manifiesto}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporal, JSON.stringify(actuales), { flag: "wx", mode: 0o600 });
  renameSync(temporal, manifiesto);
}

// Prepara la carpeta de trabajo de una tarea. Sin repo Git, la tarea usa la carpeta del proyecto.
export function prepararCopia(
  taskId: string,
  repoPath: string,
  _projectId: string | null,
): Promise<Preparada> {
  return conTarea(taskId, async () => {
    if (!(await esRaizGit(repoPath))) {
      throw new ErrorTarea("proyecto_sin_git", 409);
    }

    const carpeta = carpetaTarea(taskId);
    const clon = join(carpeta, "repo");
    const fila = filaTarea(taskId);
    // Una corrección de PR mantiene su rama; una publicación directa se corrige en una rama nueva.
    const rama = fila.source_branch && fila.source_pr_number ? fila.source_branch : ramaDeTarea(taskId);
    if (fila.source_branch && (await gitSeguro(["check-ref-format", "--branch", fila.source_branch], { cwd: repoPath })).code !== 0)
      throw new ErrorTarea("rama_fuente_invalida", 409);
    mkdirSync(carpeta, { recursive: true });

    const nuevo = !existsSync(clon);
    let traido: string | null = null;
    if (nuevo) {
      traido = await traerRepoLocalAlDia(repoPath, _projectId);
      try {
        await gitOk(["clone", "--local", "--no-hardlinks", "--template=", repoPath, clon], {
          cwd: carpeta,
          timeoutMs: TIEMPO_CLON_MS,
        });
      } catch (err) {
        // Un clon a medias no se reutiliza: se quita para que el siguiente intento empiece limpio.
        rmSync(clon, { recursive: true, force: true });
        throw err;
      }
    }

    // Antes de cualquier otra operación: en un reanudado, el .git lo pudo tocar el agente.
    await prepararRepo(clon);
    // El clon no conserva remoto: la subida usa solo remoto.txt, nunca el origen del clon.
    await gitSeguro(["remote", "remove", "origin"], { cwd: clon });
    // La URL se fija al crear el clon. En un reanudado solo se escribe si el archivo falta.
    if (nuevo || leerRemoto(taskId) === null) {
      const configurado = _projectId
        ? db
            .query<
              { remote: string | null },
              [string]
            >("SELECT remote FROM project_git WHERE project_id=?")
            .get(_projectId)?.remote
        : null;
      escribirRemoto(taskId, configurado ?? (await origenDelProyecto(repoPath)));
    }

    let base: string;
    if ((nuevo || !fila.base_commit) && fila.source_branch) {
        const remoto = leerRemoto(taskId);
        const baseBranch = fila.source_base_branch;
        if (!remoto || !urlGithubPermitida(remoto)) throw new ErrorTarea("sin_remoto", 409);
        if (baseBranch && (await gitSeguro(["check-ref-format", "--branch", baseBranch], { cwd: clon })).code !== 0)
          throw new ErrorTarea("rama_base_invalida", 409);
        const credenciales = await tokenDeLectura({ projectId: fila.project_id, remoto });
        await gitOkSeguro([
          ...credenciales.args, "fetch", "--no-tags", remoto,
          `+refs/heads/${fila.source_branch}:refs/telo/source`,
          ...(baseBranch ? [`+refs/heads/${baseBranch}:refs/telo/base`] : []),
        ], { cwd: clon, timeoutMs: TIEMPO_CLON_MS, env: credenciales.env });
        const head = (await gitOkSeguro(["rev-parse", "refs/telo/source"], { cwd: clon })).trim();
        if (fila.source_commit && (!/^[a-f0-9]{40,64}$/i.test(fila.source_commit) || head !== fila.source_commit))
          throw new ErrorTarea("publicacion_cambiada", 409, "La rama recibió otro commit desde la revisión de la publicación. Prepara una revisión nueva antes de corregirla.");
        base = baseBranch ? (await gitOkSeguro(["rev-parse", "refs/telo/base"], { cwd: clon })).trim() : head;
        await gitOkSeguro(["checkout", "-B", rama, head], { cwd: clon });
        if (baseBranch) {
        const autor = autorGit(fila.project_id
          ? db.query<{ author_name: string; author_email: string }, [string]>("SELECT author_name,author_email FROM project_git WHERE project_id=?").get(fila.project_id)
          : null);
        const merge = await gitSeguro([
          "-c", `user.name=${autor?.author_name ?? "Telo"}`,
          "-c", `user.email=${autor?.author_email ?? "telo@localhost"}`,
          "merge", "--no-edit", "refs/telo/base",
        ], { cwd: clon, timeoutMs: TIEMPO_CLON_MS });
        if (merge.code !== 0) {
          const sinResolver = (await gitOkSeguro(["diff", "--name-only", "--diff-filter=U"], { cwd: clon })).trim();
          if (!sinResolver) throw new ErrorTarea("rama_fuente_no_preparable", 409, mensajeSeguro(new Error(merge.stderr || merge.stdout)));
          registrarEvento(taskId, "conflictos_pr_preparados", sinResolver.split("\n").slice(0, 20).join(", "));
        }
        }
    } else if (nuevo) {
      const head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: clon })).trim();
      base =
        fila.base_commit && (await existeCommit(clon, fila.base_commit)) ? fila.base_commit : head;
      await gitOkSeguro(["checkout", "-B", rama, base], { cwd: clon });
      registrarEvento(taskId, "clon_creado", `Rama ${rama}${traido ? `; copia local llevada a ${traido.slice(0, 8)}` : ""}`);
    } else {
      // Reanudar: se queda en la rama de la tarea sin reiniciarla, así los commits del agente se conservan.
      const actual = (
        await gitOkSeguro(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: clon })
      ).trim();
      if (actual !== rama) {
        const existe =
          (
            await gitSeguro(["show-ref", "--verify", "--quiet", `refs/heads/${rama}`], {
              cwd: clon,
            })
          ).code === 0;
        await gitOkSeguro(["checkout", ...(existe ? [] : ["-B"]), rama], { cwd: clon });
      }
      base = fila.base_commit ?? (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: clon })).trim();
    }

    await sincronizarSkillsDeProyecto(repoPath, clon);
    db.query("UPDATE tasks SET rama = ?, base_commit = ? WHERE id = ?").run(rama, base, taskId);
    return { cwd: clon, rama, base_commit: base, copia: true };
  });
}

/** Inspecciona conflictos entre las ramas remotas de un PR sin modificar el árbol de trabajo. */
export async function detectarConflictosPullRequest(
  taskId: string,
  remotoEntrada: string,
  ramaBase: string,
  ramaFuente: string,
): Promise<string[]> {
  const remoto = urlGithubPermitida(remotoEntrada);
  if (!remoto) return [];
  const ctx = await contextoGit(taskId);
  if (
    (await gitSeguro(["check-ref-format", "--branch", ramaBase], { cwd: ctx.clon })).code !== 0 ||
    (await gitSeguro(["check-ref-format", "--branch", ramaFuente], { cwd: ctx.clon })).code !== 0
  ) return [];
  const credenciales = await tokenDeLectura({ projectId: ctx.projectId, remoto });
  await gitOkSeguro([
    ...credenciales.args, "fetch", "--no-tags", remoto,
    `+refs/heads/${ramaBase}:refs/telo/diagnostico/base`,
    `+refs/heads/${ramaFuente}:refs/telo/diagnostico/head`,
  ], { cwd: ctx.clon, timeoutMs: TIEMPO_CLON_MS, env: credenciales.env });
  const base = (await gitOkSeguro(["rev-parse", "refs/telo/diagnostico/base"], { cwd: ctx.clon })).trim();
  const head = (await gitOkSeguro(["rev-parse", "refs/telo/diagnostico/head"], { cwd: ctx.clon })).trim();
  const resultado = await gitSeguro(["merge-tree", "--write-tree", base, head], {
    cwd: ctx.clon,
    timeoutMs: TIEMPO_CLON_MS,
  });
  const salida = `${resultado.stdout}\n${resultado.stderr}`;
  const rutas = new Set<string>();
  for (const coincidencia of salida.matchAll(/CONFLICT\s+\([^)]+\):\s+Merge conflict in (.+)$/gm)) {
    const ruta = coincidencia[1]?.trim();
    if (ruta && ruta.length <= 500) rutas.add(ruta);
  }
  return [...rutas].slice(0, 30);
}

// Revisa la copia y calcula el estado contra base_commit. Deja los cambios en el índice.
// `completo` es el diff sin truncar: solo lo usa el escaneo antes de commit, nunca sale del servidor.
// `escaneo` conserva por separado el contenido original de los archivos añadidos o modificados: con
// `.gitattributes` el agente puede marcar un archivo binario y el diff no mostraría su contenido,
// pero el blob del índice sí lo trae, y los secretos no se feascan sobre lo que el agente controle.
async function estadoDelClon(ctx: Contexto): Promise<{
  archivos: ArchivoDiff[];
  diff: string;
  completo: string;
  escaneo: { ruta: string; contenido: string }[];
  // Archivos cuya captura no se pudo verificar completo (ilegible o sobre el tope):
  // el commit no entra mientras quede alguno sin revisar.
  sinVerificar: string[];
  truncado: boolean;
  hash: string | null;
}> {
  await gitSeguro(["reset", "HEAD", "--", ".opencode"], { cwd: ctx.clon });
  await gitOkSeguro(["add", "-A"], { cwd: ctx.clon, timeoutMs: TIEMPO_ESTADO_MS });
  await gitSeguro(["reset", "HEAD", "--", ".opencode"], { cwd: ctx.clon });
  const nombres = await gitOkSeguro(
    ["diff", "--cached", "-M", "--name-status", "-z", ctx.base, "--", ":!.opencode", ":!.opencode/*"],
    { cwd: ctx.clon },
  );
  const numeros = await gitOkSeguro(
    ["diff", "--cached", "-M", "--numstat", "-z", ctx.base, "--", ":!.opencode", ":!.opencode/*"],
    { cwd: ctx.clon },
  );
  const archivos = combinar(nombres, numeros).filter(
    (a) => !a.ruta.startsWith(".opencode/") && a.ruta !== ".opencode",
  );
  if (archivos.length === 0)
    return { archivos, diff: "", completo: "", escaneo: [], sinVerificar: [], truncado: false, hash: null };

  const texto = await gitOkSeguro(
    ["diff", "--cached", "-M", "--no-color", "--no-ext-diff", "--no-textconv", ctx.base, "--", ":!.opencode", ":!.opencode/*"],
    { cwd: ctx.clon },
  );
  // El texto de un binario no muestra su contenido; el hash de los blobs (--raw) sí lo cubre.
  const raw = await gitOkSeguro(
    ["diff", "--cached", "-M", "--raw", "--no-abbrev", "-z", ctx.base, "--", ":!.opencode", ":!.opencode/*"],
    { cwd: ctx.clon },
  );
  const hash = createHash("sha256").update(texto).update("\0").update(raw).digest("hex");

  const bytes = new TextEncoder().encode(texto);
  const truncado = bytes.length > TOPE_DIFF;
  const diff = truncado ? new TextDecoder().decode(bytes.subarray(0, TOPE_DIFF)) : texto;

  // Contenido original de los blobs añadidos o modificados (los borrados no traen nada que
  // escanear), leído del índice: no pasa por los atributos del worktree que el agente puede
  // escribir. Sin topes silenciosos: un blob ilegible o demasiado grande queda en `sinVerificar`
  // y el commit se bloquea — nada entra a Git sin haberse revisado entero.
  const escaneo: { ruta: string; contenido: string }[] = [];
  let total = texto.length;
  const sinVerificar: string[] = [];
  for (const archivo of archivos.filter((a) => a.estado !== "borrado")) {
    if (total > TOPE_ESCANEO_TOTAL) {
      sinVerificar.push(archivo.ruta);
      continue;
    }
    try {
      const blob = await gitOkSeguro(["cat-file", "blob", `:0:${archivo.ruta}`], {
        cwd: ctx.clon,
        timeoutMs: TIEMPO_ESTADO_MS,
      });
      if (blob.length > TOPE_ESCANEO_ARCHIVO || total + blob.length > TOPE_ESCANEO_TOTAL) {
        sinVerificar.push(archivo.ruta);
        continue;
      }
      escaneo.push({ ruta: archivo.ruta, contenido: blob });
      total += blob.length + archivo.ruta.length + 3;
    } catch {
      // Si el blob no se puede leer, no es verificable: no entra hasta que se aclare.
      sinVerificar.push(archivo.ruta);
    }
  }
  return { archivos, diff, completo: texto, escaneo, sinVerificar, truncado, hash };
}

// Valores de los secretos del proyecto de la tarea (incluido GITHUB_TOKEN), para ocultarlos.
function valoresDe(projectId: string | null): string[] {
  const global = tokenGithubGlobal();
  return [...(projectId ? valoresDeProyecto(projectId) : []), ...(global ? [global] : [])];
}

type Cuenta = { adiciones: number; eliminaciones: number; binario: boolean };

// Lee --numstat -z: "adiciones\teliminaciones\truta", y en renombrados, la ruta vacía seguida de origen y destino.
function leerNumstat(z: string): Map<string, Cuenta> {
  const t = z.split("\0");
  const mapa = new Map<string, Cuenta>();
  for (let i = 0; i < t.length; ) {
    const cabecera = t[i++];
    if (!cabecera) continue;
    const [a, d, ...resto] = cabecera.split("\t");
    let ruta = resto.join("\t");
    if (ruta === "") {
      i++; // origen del renombrado
      ruta = t[i++] ?? "";
    }
    mapa.set(ruta, {
      adiciones: a === "-" ? 0 : Number(a) || 0,
      eliminaciones: d === "-" ? 0 : Number(d) || 0,
      binario: a === "-" && d === "-",
    });
  }
  return mapa;
}

function estadoDe(codigo: string): ArchivoDiff["estado"] {
  if (codigo === "A" || codigo === "C") return "nuevo";
  if (codigo === "D") return "borrado";
  if (codigo === "R") return "renombrado";
  return "modificado";
}

// Lee --name-status -z: "M\0ruta\0", y en copias o renombrados, "R100\0origen\0destino\0".
function combinar(nombres: string, numeros: string): ArchivoDiff[] {
  const cuentas = leerNumstat(numeros);
  const t = nombres.split("\0");
  const archivos: ArchivoDiff[] = [];
  for (let i = 0; i < t.length; ) {
    const codigo = t[i++];
    if (!codigo) continue;
    let anterior: string | null = null;
    let ruta: string | undefined;
    if (codigo.startsWith("R") || codigo.startsWith("C")) {
      anterior = t[i++] ?? null;
      ruta = t[i++];
    } else {
      ruta = t[i++];
    }
    if (ruta === undefined) break;
    const cuenta = cuentas.get(ruta) ?? { adiciones: 0, eliminaciones: 0, binario: false };
    archivos.push({
      ruta,
      estado: estadoDe(codigo[0]),
      adiciones: cuenta.adiciones,
      eliminaciones: cuenta.eliminaciones,
      binario: cuenta.binario,
      sensible: esSensible(ruta) || (anterior !== null && esSensible(anterior)),
    });
  }
  return archivos;
}

function aprobacionDe(taskId: string, accion: "commit" | "push"): FilaAprobacion | null {
  return (
    db
      .query<
        FilaAprobacion,
        [string, string]
      >("SELECT commit_sha, diff_hash, detalle, rama, remoto, autenticacion, created_at FROM task_approvals WHERE task_id = ? AND accion = ? ORDER BY rowid DESC LIMIT 1")
      .get(taskId, accion) ?? null
  );
}

// Estado completo para la pantalla de revisión (GET /api/tasks/:id/diff).
export function diffDeTarea(taskId: string) {
  return conTarea(taskId, async () => {
    const ctx = await contextoGit(taskId);
    const estado = await estadoDelClon(ctx);
    const commit = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
    // Solo se muestra la URL si es un destino permitido, sin credenciales ni rutas locales.
    const remotoUrl = urlGithubPermitida(leerRemoto(taskId) ?? "");

    const ap = aprobacionDe(taskId, "commit");
    const apPush = aprobacionDe(taskId, "push");
    return {
      estado: estado.archivos.length === 0 ? ("sin_cambios" as const) : ("con_cambios" as const),
      rama: ctx.rama,
      base_commit: ctx.base,
      commit,
      archivos: estado.archivos,
      // El hash se calcula sobre el diff original; lo que se muestra va redactado.
      diff: redactar(estado.diff, valoresDe(ctx.projectId)),
      truncado: estado.truncado,
      hash: estado.hash,
      remoto_url: remotoUrl,
      remoto: remotoUrl !== null,
      aprobaciones: {
        // "pendiente": el commit aprobado ya no es el HEAD (hay cambios nuevos después).
        commit:
          ap && ap.commit_sha
            ? {
                estado: ap.commit_sha === commit ? ("aprobada" as const) : ("pendiente" as const),
                sha: ap.commit_sha,
                hash: ap.diff_hash ?? "",
                decidida_en: ap.created_at,
                mensaje: ap.detalle ?? "",
              }
            : null,
        push:
          apPush && apPush.commit_sha
            ? {
                sha: apPush.commit_sha,
                // Hash del diff aprobado: deja saber si EL TRABAJO de este diff ya está subido,
                // aunque un rebase sobre la punta de la base cambie el SHA del commit.
                hash: apPush.diff_hash ?? "",
                remoto: apPush.remoto ?? "",
                rama: apPush.rama ?? ctx.rama,
                autenticacion: parsearFuenteCredencialGithub(apPush.autenticacion),
                decidida_en: apPush.created_at,
              }
            : null,
      },
      identidad_git: db.query<{ author_name: string }, [string]>("SELECT author_name FROM project_git WHERE project_id=?").get(ctx.projectId ?? "")?.author_name ?? "Telo",
    };
  });
}

function parsearFuenteCredencialGithub(texto: string | null): FuenteCredencialGithub | null {
  if (!texto) return null;
  try {
    const valor = JSON.parse(texto) as Partial<FuenteCredencialGithub>;
    if (
      (valor.tipo === "github_app" || valor.tipo === "credencial_anterior" || valor.tipo === "clave_ssh" || valor.tipo === "ninguna") &&
      typeof valor.etiqueta === "string"
    ) {
      return {
        tipo: valor.tipo,
        origen: valor.origen ?? "ninguna",
        etiqueta: valor.etiqueta,
        cuenta: typeof valor.cuenta === "string" ? valor.cuenta : null,
        instalacion_id: typeof valor.instalacion_id === "number" ? valor.instalacion_id : null,
      };
    }
  } catch { /* Compatibilidad con aprobaciones anteriores sin método guardado. */ }
  return null;
}

function mensajeDeCommit(taskId: string, valor: unknown): string {
  const porDefecto = `Cambios de la tarea ${taskId.slice(0, 8)}`;
  if (valor === undefined || valor === null) return porDefecto;
  if (typeof valor !== "string") throw new ErrorTarea("invalid_mensaje", 400);
  const limpio = valor.trim();
  if (!limpio) return porDefecto;
  if ([...limpio].length > MAX_MENSAJE || limpio.includes("\0"))
    throw new ErrorTarea("invalid_mensaje", 400);
  return limpio;
}

export type ResultadoAprobacion = {
  accion: "commit" | "push";
  sha: string;
  rama: string;
  remoto?: string;
};

// Función interna de commit ejecutada dentro del cerrojo de la tarea.
async function commitInterno(
  taskId: string,
  ctx: Contexto,
  hash: string,
  mensajeValor?: unknown,
): Promise<ResultadoAprobacion> {
  const mensaje = mensajeDeCommit(taskId, mensajeValor);
  const estado = await estadoDelClon(ctx);
  if (estado.archivos.length === 0) throw new ErrorTarea("sin_cambios", 409);
  if (estado.hash !== hash) throw new ErrorTarea("cambios_cambiaron", 409);
  if (estado.archivos.some((a) => a.sensible)) throw new ErrorTarea("archivo_sensible", 409);
  const valores = valoresDe(ctx.projectId);
  const conSecretos = [...new Set([...archivosConSecretos(estado.completo, valores), ...archivosConSecretosEnBlobs(estado.escaneo, valores)])];
  if (conSecretos.length > 0) {
    throw new ErrorTarea("secreto_detectado", 409, conSecretos.slice(0, 10).join(", "));
  }
  // Un archivo que el escáner no pudo leer completo no entra: ni alto ni truncado por capas silenciosas.
  if (estado.sinVerificar.length > 0)
    throw new ErrorTarea(
      "escaneo_incompleto",
      409,
      `No se pudo verificar el contenido completo de: ${estado.sinVerificar.slice(0, 8).join(", ")}`,
    );
  const hayNuevo = await gitSeguro(["diff", "--cached", "--quiet", "HEAD"], { cwd: ctx.clon });
  if (hayNuevo.code === 0) {
    const shaActual = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
    const previa = aprobacionDe(taskId, "commit");
    if (previa?.commit_sha !== shaActual || previa.diff_hash !== estado.hash) {
      db.query("INSERT INTO task_approvals (id,task_id,accion,diff_hash,commit_sha,rama,detalle) VALUES (?,?,'commit',?,?,?,?)").run(crypto.randomUUID(),taskId,estado.hash,shaActual,ctx.rama,mensaje);
      registrarEvento(taskId, "commit_aprobado", `${shaActual.slice(0,8)} en ${ctx.rama}`);
    }
    return { accion: "commit", sha: shaActual, rama: ctx.rama };
  }

  const autor = autorGit(ctx.projectId
    ? db
        .query<
          { author_name: string; author_email: string },
          [string]
        >("SELECT author_name,author_email FROM project_git WHERE project_id=?")
        .get(ctx.projectId)
    : null);
  await gitOkSeguro(
    [
      "-c",
      `user.name=${autor?.author_name ?? "Telo"}`,
      "-c",
      `user.email=${autor?.author_email ?? "telo@localhost"}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      mensaje,
    ],
    { cwd: ctx.clon },
  );
  const sha = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
  db.query(
    "INSERT INTO task_approvals (id, task_id, accion, diff_hash, commit_sha, rama, remoto, detalle) VALUES (?, ?, 'commit', ?, ?, ?, NULL, ?)",
  ).run(crypto.randomUUID(), taskId, estado.hash, sha, ctx.rama, mensaje);
  registrarEvento(taskId, "commit_aprobado", `${sha.slice(0, 8)} en ${ctx.rama}`);
  return { accion: "commit", sha, rama: ctx.rama };
}

// Aprueba un commit o una subida. Siempre contra el hash del diff que vio el usuario.
export async function aprobarTarea(
  taskId: string,
  opts: {
    accion: "commit" | "push";
    hash: string;
    mensaje?: unknown;
    destinoRama?: string;
    commitEsperado?: string;
    autenticacion?: FuenteCredencialGithub;
  },
): Promise<ResultadoAprobacion> {
  return conTarea(taskId, async () => {
    const ctx = await contextoGit(taskId);
    if (opts.commitEsperado && (await gitOkSeguro(["rev-parse", "HEAD"], {cwd:ctx.clon})).trim() !== opts.commitEsperado)
      throw new ErrorTarea("cambios_cambiaron", 409);
    if (opts.accion === "push") {
      if (!opts.autenticacion || opts.autenticacion.tipo === "ninguna")
        throw new ErrorTarea("credenciales_git_faltantes", 409);
      return subirAprobado(taskId, ctx, opts.hash, {
        destinoRama: opts.destinoRama,
        mensaje: opts.mensaje,
        autenticacion: opts.autenticacion,
      });
    }
    return commitInterno(taskId, ctx, opts.hash, opts.mensaje);
  });
}

async function subirAprobado(
  taskId: string,
  ctx: Contexto,
  hash: string,
  opts?: { destinoRama?: string; mensaje?: unknown; autenticacion?: FuenteCredencialGithub },
): Promise<ResultadoAprobacion> {
  // El destino sale de remoto.txt, no del clon: el agente puede cambiar el origen del clon, pero no esa URL.
  const guardado = leerRemoto(taskId);
  if (!guardado) throw new ErrorTarea("sin_remoto", 409);
  const remoto = urlGithubPermitida(guardado);
  if (!remoto) throw new ErrorTarea("remoto_no_permitido", 409);

  const fuente = opts?.autenticacion;
  let token: string | null = null;
  let destinoSsh: string | null = null;
  if (fuente?.tipo === "github_app") {
    token = await tokenGithubAppParaRepo(remoto, { contents: "write" });
  } else if (fuente?.origen === "sesion_anterior") {
    token = tokenGithubGlobal();
  } else if (fuente?.origen === "token_proyecto" && ctx.projectId) {
    token = valorSecreto(ctx.projectId, "GITHUB_TOKEN");
  } else if (fuente?.tipo === "clave_ssh" && fuente.origen === "ssh" && ctx.projectId && clavePublicaDe(ctx.projectId)) {
    destinoSsh = urlSshDeGithub(remoto);
  }
  if (fuente?.tipo !== "github_app" && fuente?.tipo !== "credencial_anterior" && fuente?.tipo !== "clave_ssh")
    throw new ErrorTarea("credenciales_git_faltantes", 409);
  if (!token && !destinoSsh) throw new ErrorTarea("credenciales_git_faltantes", 409);

  let head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
  let aprobacion = aprobacionDe(taskId, "commit");

  // Si no se ha aprobado el commit explícitamente o hay cambios pendientes, se crea el commit automáticamente
  // para no bloquear al usuario con "commit_requerido".
  if (!aprobacion || aprobacion.commit_sha !== head || aprobacion.diff_hash !== hash) {
    const estado = await estadoDelClon(ctx);
    if (estado.archivos.length > 0) {
      const commitRes = await commitInterno(taskId, ctx, hash, opts?.mensaje);
      head = commitRes.sha;
      aprobacion = aprobacionDe(taskId, "commit");
    } else if (!aprobacion || aprobacion.commit_sha !== head) {
      throw new ErrorTarea("commit_requerido", 409);
    }
  }

  const estado = await estadoDelClon(ctx);
  if (estado.hash !== hash) throw new ErrorTarea("cambios_cambiaron", 409);
  if (!aprobacion || aprobacion.diff_hash !== estado.hash) throw new ErrorTarea("commit_requerido", 409);

  // Rama destino: si se especifica (ej. "main" o "master") se usa directamente; de lo contrario la rama de tarea.
  const ramaDestino = opts?.destinoRama?.trim() || ctx.rama;
  const credenciales = opcionesDeCredenciales(token);
  // Subida directa a otra rama (la base): la punta del remoto pudo avanzar desde el clon. Se
  // reintegra el trabajo de la tarea antes de subir para que el push sea fast-forward; si no se
  // puede reintegrar sin conflictos, la subida falla con instrucciones concretas para el usuario.
  if (ramaDestino !== ctx.rama && !destinoSsh) {
    const nuevoHead = await reintegrarSobrePunta(taskId, ctx, credenciales, remoto, ramaDestino, head);
    if (nuevoHead) head = nuevoHead;
  }
  const refspec = `${head}:refs/heads/${ramaDestino}`;
  try {
    if (destinoSsh && ctx.projectId) {
      await conClaveSsh(ctx.projectId, (entorno) =>
        gitOkSeguro([...opcionesDeCredenciales(null).args, "push", destinoSsh, refspec], {
          cwd: ctx.clon,
          env: entorno,
          timeoutMs: TIEMPO_PUSH_MS,
        }),
      );
    } else {
      await gitOkSeguro([...credenciales.args, "push", remoto, refspec], {
        cwd: ctx.clon,
        env: credenciales.env,
        timeoutMs: TIEMPO_PUSH_MS,
      });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let detalle = mensajeSeguro(err, token).slice(0, 600);
    if (/denied to deploy key|deploy key does not have write access|key does not have write access/i.test(raw)) {
      detalle = "La clave Deploy Key de GitHub no tiene permisos de escritura. Ve a Settings > Deploy keys en el repositorio de GitHub y marca la casilla 'Allow write access'.";
    } else if (/protected branch|GH006|GH013|repository rule violation|pre-receive hook declined|push declined due to repository rule/i.test(raw)) {
      detalle = `GitHub rechazó la subida a '${ramaDestino}' por una regla de protección del repositorio. Sube la rama de la tarea (${ctx.rama}) y abre un Pull Request, o revisa en GitHub las reglas que permiten actualizar '${ramaDestino}'.`;
    } else if (/fetch first|non-fast-forward|not a fast-forward/i.test(raw)) {
      detalle = `La rama '${ramaDestino}' en GitHub tiene commits que tu commit no incluye. En vez de subirla directo, prepara la subida en la rama de la tarea y abre un Pull Request.`;
    }
    registrarEvento(taskId, "push_fallido", detalle);
    throw new ErrorTarea("push_fallido", 502, detalle);
  }

  db.query(
    "INSERT INTO task_approvals (id, task_id, accion, diff_hash, commit_sha, rama, remoto, detalle, autenticacion) VALUES (?, ?, 'push', ?, ?, ?, ?, NULL, ?)",
  ).run(crypto.randomUUID(), taskId, estado.hash, head, ramaDestino, remoto, JSON.stringify(fuente));
  registrarEvento(taskId, "push_aprobado", `${head.slice(0, 8)} a ${remoto} (${ramaDestino})`);

  return { accion: "push", sha: head, rama: ramaDestino, remoto };
}

// Comprueba la punta actual de la rama destino en el remoto antes de una subida directa. Si avanzó
// respecto al commit base del clon, trae esa rama y reubica el trabajo de la tarea encima (rebase).
// Devuelve el HEAD nuevo cuando reubicó; null cuando el remoto no avanzó (o no se pudo leer su
// punta, dejando que el propio push responda con su error). Con conflictos cancela todo y lanza
// la explicación para que el usuario elija rama de tarea y PR, o una tarea nueva.
export async function reintegrarSobrePunta(
  taskId: string,
  ctx: Contexto,
  credenciales: { args: string[]; env: Record<string, string> },
  remoto: string,
  ramaDestino: string,
  head: string,
): Promise<string | null> {
  let punta = "";
  try {
    const salida = await gitOkSeguro(
      [...credenciales.args, "ls-remote", remoto, `refs/heads/${ramaDestino}`],
      { cwd: ctx.clon, env: credenciales.env, timeoutMs: TIEMPO_SINCRONIZAR_MS },
    );
    punta = salida.trim().split(/\s+/)[0] ?? "";
  } catch {
    return null;
  }
  if (!punta || punta === ctx.base || punta === head) return null;
  try {
    await gitOkSeguro([...credenciales.args, "fetch", remoto, ramaDestino], {
      cwd: ctx.clon,
      env: credenciales.env,
      timeoutMs: TIEMPO_CLON_MS,
    });
    const autor = autorGit(ctx.projectId
      ? db
          .query<
            { author_name: string | null; author_email: string | null },
            [string]
          >("SELECT author_name,author_email FROM project_git WHERE project_id=?")
          .get(ctx.projectId)
      : null);
    await gitOkSeguro(
      [
        "-c",
        `user.name=${autor?.author_name ?? "Telo"}`,
        "-c",
        `user.email=${autor?.author_email ?? "telo@localhost"}`,
        "-c",
        "commit.gpgsign=false",
        "rebase",
        "FETCH_HEAD",
      ],
      { cwd: ctx.clon, timeoutMs: TIEMPO_CLON_MS },
    );
    const nuevo = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
    registrarEvento(
      taskId,
      "push_reintegrado",
      `La rama '${ramaDestino}' avanzó; el commit se reubica sobre ${nuevo.slice(0, 8)} antes de subir.`,
    );
    return nuevo;
  } catch (err) {
    await gitSeguro(["rebase", "--abort"], { cwd: ctx.clon });
    const razon = err instanceof GitError ? mensajeSeguro(err) : "";
    const detalle = `La rama '${ramaDestino}' en GitHub avanzó desde tu clon y el commit no se pudo reubicar automáticamente${razon ? ` (${razon})` : ""}. Pide la subida otra vez eligiendo la rama de la tarea (${ctx.rama}) para abrir un Pull Request, o crea una tarea nueva sobre la rama actualizada.`;
    registrarEvento(taskId, "push_fallido", detalle);
    throw new ErrorTarea("push_fallido", 502, detalle);
  }
}

// Al cancelar: el clon se borra solo si no tiene nada que revisar (ni cambios ni commits nuevos).
export function limpiarCopiaCancelada(taskId: string): Promise<void> {
  if (!UUID.test(taskId) || enMantenimiento()) return Promise.resolve();
  const finalizar = registrarTrabajo();
  return conTarea(taskId, async () => {
    if (enMantenimiento()) return;
    if (!existsSync(rutaClon(taskId))) return;
    let limpio = false;
    try {
      const ctx = await contextoGit(taskId);
      const pendientes = (
        await gitOkSeguro(["status", "--porcelain", "--untracked-files=all", "--ignored"], { cwd: ctx.clon })
      ).trim();
      const head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
      // Con --ignored, un clon con entregables excluidos por .gitignore NO cuenta como limpio:
      // cancelar deja la copia para que el trabajo ignorado sobreviva (igual criterio que limpiarCopias).
      limpio = pendientes === "" && head === ctx.base;
    } catch {
      limpio = false;
    }
    if (limpio) rmSync(rutaClon(taskId), { recursive: true, force: true });
  }).finally(finalizar);
}

// La antigüedad no descarta trabajo: solo borra copias limpias sin commits pendientes de subir.
export async function limpiarCopias(): Promise<void> {
  if (enMantenimiento()) return;
  const finalizar = registrarTrabajo();
  try {
  const filas = db
    .query<{ id: string }, []>(
      `SELECT id FROM tasks WHERE status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL
       AND finished_at < datetime('now', '-${DIAS_CONSERVAR} days')`,
    )
    .all();
  for (const { id } of filas) {
    if (!UUID.test(id)) continue;
    await conTarea(id, async () => {
      const vieja = db
        .query<{ id: string }, [string]>(
          `SELECT id FROM tasks WHERE id = ? AND status IN ('done', 'failed', 'cancelled')
           AND finished_at < datetime('now', '-${DIAS_CONSERVAR} days')`,
        )
        .get(id);
      if (!vieja) return;
      if (existsSync(rutaClon(id))) {
        try {
          const ctx = await contextoGit(id);
          const pendientes = (
            await gitOkSeguro(["status", "--porcelain", "--untracked-files=all", "--ignored"], {
              cwd: ctx.clon,
            })
          ).trim();
          if (pendientes !== "") return;
          const head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
          const subida = aprobacionDe(id, "push");
          if (head !== ctx.base && head !== subida?.commit_sha) return;
        } catch {
          // Ante metadatos o Git dañados, conservar para revisión manual.
          return;
        }
        rmSync(rutaClon(id), { recursive: true, force: true });
      }

      // Si la tarea terminó hace más de 30 días y el clon ya no existe, purgar logs y carpeta contenedora
      const muyVieja = db
        .query<{ conversation_id: string | null }, [string]>(
          `SELECT conversation_id FROM tasks WHERE id = ? AND status IN ('done', 'failed', 'cancelled')
           AND finished_at < datetime('now', '-30 days')`,
        )
        .get(id);
      if (muyVieja) {
        if (!muyVieja.conversation_id) {
          eliminarPerfilOpenCode(id);
          eliminarPerfilCodex(id);
        }
        if (existsSync(carpetaTarea(id)) && !existsSync(rutaClon(id))) {
          rmSync(carpetaTarea(id), { recursive: true, force: true });
        }
      }
    });
  }
  } finally { finalizar(); }
}

let temporizadorLimpieza: ReturnType<typeof setInterval> | null = null;

// Días que se conservan los registros ligados a tareas terminadas (eventos, planes,
// aprobaciones y solicitudes de repositorio). Las tareas mismas se conservan: son la
// historia del usuario.TELO_RETENCION_DIAS lo ajusta; 0 desactiva la purga.
const DIAS_RETENCION = Number(process.env.TELO_RETENCION_DIAS ?? 120);

// Purga el historial de tareas terminadas hace mucho. Sin esto la base crece sin techo:
// hoy (14 oct 2026) el VM suma 789 eventos y 65 solicitudes de acciones en 6 días.
export async function purgarHistorial(): Promise<number> {
  if (!Number.isFinite(DIAS_RETENCION) || DIAS_RETENCION <= 0) return 0;
  const cortadas: string[] = [];
  for (const [tabla, condicion] of [
    ["task_events", ""],
    ["task_plans", ""],
    ["task_approvals", ""],
    // Las solicitudes sin tarea siguen siendo bitácora de chats: se conservan.
    ["repository_actions", "task_id IS NOT NULL"],
  ] as const) {
    const n = db
      .query<{ n: number }, []>(
        `WITH terminadas AS (
           SELECT id FROM tasks WHERE status IN ('done', 'failed', 'cancelled')
             AND finished_at IS NOT NULL AND finished_at < datetime('now', '-${DIAS_RETENCION} days')
         )
         DELETE FROM ${tabla} WHERE 1=1 ${condicion ? `AND ${condicion}` : ""}
           AND task_id IN (SELECT id FROM terminadas) RETURNING rowid`,
      )
      .all().length;
    if (n > 0) cortadas.push(`${tabla}: ${n}`);
  }
  if (cortadas.length > 0) console.info(`Purga de historial (anteriores a ${DIAS_RETENCION} días): ${cortadas.join(", ")}`);
  return cortadas.reduce((total, linea) => total + Number(linea.split(": ")[1] ?? 0), 0);
}

// Limpia al arrancar y cada 6 horas. Llamarlo una sola vez desde el worker.
export function iniciarLimpieza(): void {
  const correr = () => {
    limpiarCopias().catch((err) => console.error("Limpieza de copias:", mensajeSeguro(err)));
    purgarHistorial().catch((err) => console.error("Purga de historial:", mensajeSeguro(err)));
  };
  correr();
  if (!temporizadorLimpieza) {
    temporizadorLimpieza = setInterval(correr, CADA_LIMPIEZA_MS);
    temporizadorLimpieza.unref?.();
  }
}

// Registro y lectura de la salida del agente delegados a workspace-registro.ts
export { abrirRegistroSalida, leerSalida, type RegistroSalida } from "./workspace-registro";
