import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { registrarEvento } from "./eventos";
import { clavePublicaDe, conClaveSsh, urlSshDeGithub } from "./clave-ssh";
import {
  esRepositorio,
  gitOk,
  gitOkSeguro,
  gitSeguro,
  prepararRepoSeguro,
  urlSinCredenciales,
} from "./git";
import { archivosConSecretos, redactar } from "./redaccion";
import { valorSecreto, valoresDeProyecto } from "./secretos";
import { tokenGithubGlobal } from "./github-auth";

// Copias de trabajo de las tareas de proyecto con Git. Cada tarea trabaja en su clon
// (DATA_DIR/tasks/<id>/repo, rama telo/<id8>). Nada sale a GitHub sin aprobación del usuario:
// una sola autorización de subida cubre commit y push, contra el hash del diff.
//
// El clon lo escribe un agente que corre aislado, así que su .git no es de confianza: antes de
// cada operación de Git se sanea su configuración. La subida nunca usa el remoto del clon: usa la
// URL que se guardó al crear el clon en remoto.txt (DATA_DIR/tasks/<id>, fuera del alcance del
// agente), y solo se admite https://github.com/<dueño>/<repo>. Si el proyecto tiene clave SSH
// (clave-ssh.ts), la subida va por SSH con esa clave; si no, por HTTPS con su GITHUB_TOKEN.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const TOPE_DIFF = 400 * 1024;
const TOPE_SALIDA_LOG = 5 * 1024 * 1024;
const VENTANA_SALIDA = 512 * 1024;
const TIEMPO_CLON_MS = 10 * 60_000;
const TIEMPO_ESTADO_MS = 5 * 60_000;
const TIEMPO_PUSH_MS = 5 * 60_000;
const MAX_MENSAJE = 200;
const DIAS_CONSERVAR = 14;
const CADA_LIMPIEZA_MS = 6 * 3600_000;
const AVISO_LLENO =
  "[Telo] Registro lleno: a partir de aquí no se guarda más salida (tope de 5 MB).";
// Archivo con la URL de subida de la tarea, junto al clon y fuera de su alcance.
const NOMBRE_REMOTO = "remoto.txt";
// Único remoto admitido: GitHub por https, sin credenciales, puerto ni otra ruta. Acepta el .git final.
const URL_GITHUB =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_][A-Za-z0-9_.-]*?)(?:\.git)?$/i;

// Patrones de nombre que parecen secretos. Se comparan con el nombre del archivo, en minúsculas.
const PATRONES_SENSIBLES = [
  /^\.env(\..*)?$/,
  /\.(pem|key|p12|pfx)$/,
  /^id_(rsa|ed25519)/,
  /^credentials/,
  /secret/,
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
};

type FilaAprobacion = {
  commit_sha: string | null;
  diff_hash: string | null;
  detalle: string | null;
  rama: string | null;
  remoto: string | null;
  created_at: string;
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
  return PATRONES_SENSIBLES.some((patron) => patron.test(nombre));
}

// Serializa las operaciones sobre una misma tarea (aprobar, preparar, limpiar).
const cerrojos = new Map<string, Promise<unknown>>();

function conTarea<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
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
    >("SELECT id, status, rama, base_commit, project_id FROM tasks WHERE id = ?")
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
    const rama = ramaDeTarea(taskId);
    const fila = filaTarea(taskId);
    mkdirSync(carpeta, { recursive: true });

    const nuevo = !existsSync(clon);
    if (nuevo) {
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
    if (nuevo) {
      const head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: clon })).trim();
      base =
        fila.base_commit && (await existeCommit(clon, fila.base_commit)) ? fila.base_commit : head;
      await gitOkSeguro(["checkout", "-B", rama, base], { cwd: clon });
      registrarEvento(taskId, "clon_creado", `Rama ${rama}`);
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

    db.query("UPDATE tasks SET rama = ?, base_commit = ? WHERE id = ?").run(rama, base, taskId);
    return { cwd: clon, rama, base_commit: base, copia: true };
  });
}

// Revisa la copia y calcula el estado contra base_commit. Deja los cambios en el índice.
// `completo` es el diff sin truncar: solo lo usa el escaneo antes de commit, nunca sale del servidor.
async function estadoDelClon(ctx: Contexto): Promise<{
  archivos: ArchivoDiff[];
  diff: string;
  completo: string;
  truncado: boolean;
  hash: string | null;
}> {
  await gitOkSeguro(["add", "-A"], { cwd: ctx.clon, timeoutMs: TIEMPO_ESTADO_MS });
  const nombres = await gitOkSeguro(["diff", "--cached", "-M", "--name-status", "-z", ctx.base], {
    cwd: ctx.clon,
  });
  const numeros = await gitOkSeguro(["diff", "--cached", "-M", "--numstat", "-z", ctx.base], {
    cwd: ctx.clon,
  });
  const archivos = combinar(nombres, numeros);
  if (archivos.length === 0)
    return { archivos, diff: "", completo: "", truncado: false, hash: null };

  const texto = await gitOkSeguro(
    ["diff", "--cached", "-M", "--no-color", "--no-ext-diff", "--no-textconv", ctx.base],
    { cwd: ctx.clon },
  );
  // El texto de un binario no muestra su contenido; el hash de los blobs (--raw) sí lo cubre.
  const raw = await gitOkSeguro(
    ["diff", "--cached", "-M", "--raw", "--no-abbrev", "-z", ctx.base],
    { cwd: ctx.clon },
  );
  const hash = createHash("sha256").update(texto).update("\0").update(raw).digest("hex");

  const bytes = new TextEncoder().encode(texto);
  const truncado = bytes.length > TOPE_DIFF;
  const diff = truncado ? new TextDecoder().decode(bytes.subarray(0, TOPE_DIFF)) : texto;
  return { archivos, diff, completo: texto, truncado, hash };
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
      >("SELECT commit_sha, diff_hash, detalle, rama, remoto, created_at FROM task_approvals WHERE task_id = ? AND accion = ? ORDER BY rowid DESC LIMIT 1")
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
                remoto: apPush.remoto ?? "",
                rama: apPush.rama ?? ctx.rama,
                decidida_en: apPush.created_at,
              }
            : null,
      },
    };
  });
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
  const conSecretos = archivosConSecretos(estado.completo, valoresDe(ctx.projectId));
  if (conSecretos.length > 0) {
    throw new ErrorTarea("secreto_detectado", 409, conSecretos.slice(0, 10).join(", "));
  }
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

  const autor = ctx.projectId
    ? db
        .query<
          { author_name: string; author_email: string },
          [string]
        >("SELECT author_name,author_email FROM project_git WHERE project_id=?")
        .get(ctx.projectId)
    : null;
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
  },
): Promise<ResultadoAprobacion> {
  return conTarea(taskId, async () => {
    const ctx = await contextoGit(taskId);
    if (opts.commitEsperado && (await gitOkSeguro(["rev-parse", "HEAD"], {cwd:ctx.clon})).trim() !== opts.commitEsperado)
      throw new ErrorTarea("cambios_cambiaron", 409);
    if (opts.accion === "push") {
      return subirAprobado(taskId, ctx, opts.hash, {
        destinoRama: opts.destinoRama,
        mensaje: opts.mensaje,
      });
    }
    return commitInterno(taskId, ctx, opts.hash, opts.mensaje);
  });
}

// Credenciales de la subida. Se anula cualquier helper global (de la máquina o del repo) y solo
// github.com recibe el token, por un helper con alcance por URL. El token viaja como variable de
// entorno del proceso de Git, nunca en la línea de comandos.
export function opcionesDeCredenciales(token: string | null): {
  args: string[];
  env: Record<string, string>;
} {
  const args = ["-c", "credential.helper="];
  const env: Record<string, string> = {};
  if (token) {
    args.push(
      "-c",
      'credential.https://github.com.helper=!f() { echo username=x-access-token; echo "password=$TELO_GIT_TOKEN"; }; f',
    );
    env.TELO_GIT_TOKEN = token;
  }
  return { args, env };
}

async function subirAprobado(
  taskId: string,
  ctx: Contexto,
  hash: string,
  opts?: { destinoRama?: string; mensaje?: unknown },
): Promise<ResultadoAprobacion> {
  // El destino sale de remoto.txt, no del clon: el agente puede cambiar el origen del clon, pero no esa URL.
  const guardado = leerRemoto(taskId);
  if (!guardado) throw new ErrorTarea("sin_remoto", 409);
  const remoto = urlGithubPermitida(guardado);
  if (!remoto) throw new ErrorTarea("remoto_no_permitido", 409);

  const token = (ctx.projectId ? valorSecreto(ctx.projectId, "GITHUB_TOKEN") || null : null) || tokenGithubGlobal();
  const destinoSsh =
    !token && ctx.projectId && clavePublicaDe(ctx.projectId) ? urlSshDeGithub(remoto) : null;
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
  const refspec = `${head}:refs/heads/${ramaDestino}`;

  const credenciales = opcionesDeCredenciales(token);
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
    const detalle = mensajeSeguro(err, token).slice(0, 600);
    registrarEvento(taskId, "push_fallido", detalle);
    throw new ErrorTarea("push_fallido", 502, detalle);
  }

  db.query(
    "INSERT INTO task_approvals (id, task_id, accion, diff_hash, commit_sha, rama, remoto, detalle) VALUES (?, ?, 'push', ?, ?, ?, ?, NULL)",
  ).run(crypto.randomUUID(), taskId, estado.hash, head, ramaDestino, remoto);
  registrarEvento(taskId, "push_aprobado", `${head.slice(0, 8)} a ${remoto} (${ramaDestino})`);

  return { accion: "push", sha: head, rama: ramaDestino, remoto };
}

// Al cancelar: el clon se borra solo si no tiene nada que revisar (ni cambios ni commits nuevos).
export function limpiarCopiaCancelada(taskId: string): Promise<void> {
  if (!UUID.test(taskId)) return Promise.resolve();
  return conTarea(taskId, async () => {
    if (!existsSync(rutaClon(taskId))) return;
    let limpio = false;
    try {
      const ctx = await contextoGit(taskId);
      const pendientes = (
        await gitOkSeguro(["status", "--porcelain", "--untracked-files=all"], { cwd: ctx.clon })
      ).trim();
      const head = (await gitOkSeguro(["rev-parse", "HEAD"], { cwd: ctx.clon })).trim();
      limpio = pendientes === "" && head === ctx.base;
    } catch {
      limpio = false;
    }
    if (limpio) rmSync(rutaClon(taskId), { recursive: true, force: true });
  });
}

// La antigüedad no descarta trabajo: solo borra copias limpias sin commits pendientes de subir.
export async function limpiarCopias(): Promise<void> {
  const filas = db
    .query<{ id: string }, []>(
      `SELECT id FROM tasks WHERE conversation_id IS NULL AND status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL
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
      if (!vieja || !existsSync(rutaClon(id))) return;
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
    });
  }
}

let temporizadorLimpieza: ReturnType<typeof setInterval> | null = null;

// Limpia al arrancar y cada 6 horas. Llamarlo una sola vez desde el worker.
export function iniciarLimpieza(): void {
  const correr = () => {
    limpiarCopias().catch((err) => console.error("Limpieza de copias:", mensajeSeguro(err)));
  };
  correr();
  if (!temporizadorLimpieza) {
    temporizadorLimpieza = setInterval(correr, CADA_LIMPIEZA_MS);
    temporizadorLimpieza.unref?.();
  }
}

// Registro de la salida del agente: DATA_DIR/tasks/<id>/salida.log, con tope de 5 MB.
export type RegistroSalida = { linea: (texto: string) => void; cerrar: () => void };

export function abrirRegistroSalida(taskId: string): RegistroSalida {
  const carpeta = carpetaTarea(taskId);
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, "salida.log");

  // En una tarea sin repo el agente escribe en esta misma carpeta: un enlace no debe redirigir el registro.
  try {
    if (!lstatSync(ruta).isFile()) rmSync(ruta, { recursive: true, force: true });
  } catch {
    // no existe todavía
  }

  let fd: number | null = null;
  try {
    fd = openSync(
      ruta,
      fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    fd = null;
  }
  let tamano = fd !== null ? statSync(ruta).size : 0;
  let lleno = tamano >= TOPE_SALIDA_LOG;
  const codificador = new TextEncoder();

  return {
    linea(texto: string) {
      if (fd === null || lleno) return;
      const bytes = codificador.encode(texto + "\n").length;
      try {
        if (tamano + bytes > TOPE_SALIDA_LOG) {
          lleno = true;
          writeSync(fd, AVISO_LLENO + "\n");
          return;
        }
        writeSync(fd, texto + "\n");
        tamano += bytes;
      } catch {
        lleno = true;
      }
    },
    cerrar() {
      if (fd === null) return;
      try {
        closeSync(fd);
      } catch {
        // ya cerrado
      }
      fd = null;
    },
  };
}

// Últimas 512 KB del registro. Si se recortó, la primera línea parcial se descarta.
export async function leerSalida(taskId: string): Promise<{ texto: string; truncado: boolean }> {
  const ruta = join(carpetaTarea(taskId), "salida.log");
  try {
    if (!lstatSync(ruta).isFile()) return { texto: "", truncado: false };
  } catch {
    return { texto: "", truncado: false };
  }
  const archivo = Bun.file(ruta);
  const total = archivo.size;
  const inicio = Math.max(0, total - VENTANA_SALIDA);
  let texto = await archivo.slice(inicio, total).text();
  const truncado = inicio > 0;
  if (truncado) {
    const corte = texto.indexOf("\n");
    if (corte >= 0) texto = texto.slice(corte + 1);
  }
  // La salida pasa por la redacción también al leerla: cubre lo que se guardó antes de ampliar las reglas.
  const fila = db
    .query<{ project_id: string | null }, [string]>("SELECT project_id FROM tasks WHERE id = ?")
    .get(taskId);
  return { texto: redactar(texto, valoresDe(fila?.project_id ?? null)), truncado };
}
