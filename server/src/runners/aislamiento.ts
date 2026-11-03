import { createHash } from "node:crypto";
import { constants, closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "../config";
import { carpetaEntregables } from "../entregables";
import { hallarEjecutable } from "../ejecutable";
import { archivosSesionAntigravity } from "../antigravity";


// Aislamiento de los agentes con bubblewrap (bwrap). Cada ejecución ve:
// - su carpeta de trabajo, con escritura (proyecto o carpeta temporal del chat o tarea);
// - perfiles de OpenCode y Codex por conversación o tarea; Codex conserva escritura para
//   sus sesiones y su estado, mientras autenticación y configuración global quedan en solo lectura;
//   las herramientas también quedan en solo lectura;
// - el resto del sistema en solo lectura, sin el repo de Orquestador, sin DATA_DIR,
//   sin otros proyectos, sin el resto del HOME (por ejemplo ~/.ssh), sin los procesos del
//   servidor y sin los archivos sensibles del VM (archivo de entorno del servicio y clave
//   privada de la GitHub App, ampliable con TELO_OCULTAR_EXTRA).
// Si bwrap no está instalado, la ejecución se niega: no se corre el agente sin aislarlo.
// TELO_AISLAMIENTO=desactivado solo para desarrollo local.

export class AislamientoError extends Error {
  constructor(
    readonly code: "aislamiento_no_disponible" | "carpeta_no_permitida",
    mensaje: string,
  ) {
    super(mensaje);
  }
}

// server/src/runners -> raíz del repo
const RAIZ_REPO = resolve(import.meta.dir, "../../..");

// Estado compartido de compatibilidad para ejecuciones directas sin perfil persistente.
// Herramientas instaladas en el HOME: solo lectura.
const HERRAMIENTAS = [".local/bin", ".opencode/bin", ".opencode/lib", ".opencode/node_modules", ".bun", ".cache/hyperframes"];

export function aislamientoActivo(): boolean {
  return process.env.TELO_AISLAMIENTO !== "desactivado";
}

export function requisitosCodexDenieganLecturaSensibles(contenido: string, home: string): boolean {
  try {
    const requisitos = Bun.TOML.parse(contenido) as {
      permissions?: { filesystem?: { deny_read?: unknown } };
    };
    const denegaciones = requisitos.permissions?.filesystem?.deny_read;
    const requeridas = [
      join(resolve(home), ".codex", "auth.json"),
      "/tmp/telo-codex-global/auth.json",
      join(resolve(home), ".codex", "config.toml"),
      "/tmp/telo-codex-global/config.toml",
    ];
    return Array.isArray(denegaciones) && requeridas.every((ruta) => denegaciones.includes(ruta));
  } catch {
    return false;
  }
}

export function verificarPoliticaCredencialesCodex(home: string): void {
  const ruta = "/etc/codex/requirements.toml";
  try {
    const directorio = lstatSync(dirname(ruta));
    const stat = lstatSync(ruta);
    if (
      !directorio.isDirectory() || directorio.isSymbolicLink() || (directorio.mode & 0o022) !== 0 ||
      !stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 ||
      (process.platform === "linux" && (directorio.uid !== 0 || stat.uid !== 0))
    ) {
      throw new Error("permisos no confiables");
    }
    if (requisitosCodexDenieganLecturaSensibles(readFileSync(ruta, "utf8"), home)) return;
  } catch {
    // Falla cerrado: si la política no está instalada o no es de solo lectura para el servicio,
    // no se inicia Codex con la credencial expuesta a sus herramientas.
  }
  throw new Error("Codex requiere la política del sistema que impide leer su credencial desde las herramientas. Instálala con: sudo ./deploy/instalar-politica-codex.sh orquestador");
}

function rutaReal(ruta: string): string | null {
  try {
    return realpathSync(ruta);
  } catch {
    return null;
  }
}

function dentro(ruta: string, raiz: string): boolean {
  return ruta.startsWith(raiz + sep);
}

function rutaPerfilOpenCode(id: string): string {
  const sello = createHash("sha256").update(id).digest("hex");
  return join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-opencode", sello);
}

function rutaPerfilCodex(id: string): string {
  const sello = createHash("sha256").update(id).digest("hex");
  return join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-codex", sello);
}

function rutaPerfilCommandCode(id: string): string {
  const sello = createHash("sha256").update(id).digest("hex");
  return join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-commandcode", sello);
}

export function autenticacionCommandCode(): string | null {
  const home = process.env.HOME && process.env.HOME !== "/" ? process.env.HOME : "";
  if (!home) return null;
  const archivo = join(home, ".commandcode", "auth.json");
  try {
    const stat = lstatSync(archivo);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > 1_000_000 || realpathSync(archivo) !== archivo) return null;
    const datos: unknown = JSON.parse(readFileSync(archivo, "utf8"));
    if (!datos || typeof datos !== "object" || Array.isArray(datos) || Object.keys(datos).length === 0) return null;
    return archivo;
  } catch { return null; }
}

function escribirArchivoPerfilSeguro(ruta: string, contenido: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(ruta, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new AislamientoError("carpeta_no_permitida", "El archivo de política Command Code no es seguro.");
    writeFileSync(fd, contenido, "utf8");
  } finally { if (fd !== null) closeSync(fd); }
}

export function prepararPerfilCommandCode(id: string): string {
  const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-commandcode");
  const perfil = rutaPerfilCommandCode(id);
  for (const ruta of [raiz, perfil, join(perfil, ".commandcode"), join(perfil, ".agents")]) {
    mkdirSync(ruta, { recursive: true, mode: 0o700 });
    const stat = lstatSync(ruta);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(ruta) !== ruta) {
      throw new AislamientoError("carpeta_no_permitida", "El perfil de Command Code contiene una ruta no segura.");
    }
  }
  const settings = join(perfil, ".commandcode", "settings.json");
  const reglas = { permissions: { deny: [
    "Read(//tmp/telo-commandcode-home/.commandcode/auth.json)",
    "Read(//tmp/telo-commandcode-global/auth.json)",
    "Read(//tmp/telo-commandcode-home/.commandcode/settings.json)",
    "Edit(//tmp/telo-commandcode-home/.commandcode/settings.json)",
    "Shell(*auth.json*)", "Shell(*telo-commandcode-global*)",
    "Shell(git commit:*)", "Shell(git push:*)", "Shell(gh pr create:*)",
    "Shell(vercel deploy:*)", "Shell(wrangler deploy:*)", "Shell(npm publish:*)",
  ] } };
  try {
    const stat = lstatSync(settings);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(settings) !== settings) {
      throw new AislamientoError("carpeta_no_permitida", "La política Command Code no es segura.");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  escribirArchivoPerfilSeguro(settings, JSON.stringify(reglas));
  return perfil;
}

export function eliminarPerfilCommandCode(id: string): void {
  rmSync(rutaPerfilCommandCode(id), { recursive: true, force: true });
}

export async function prepararPerfilCodex(id: string, sessionId?: string | null): Promise<string> {
  const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-codex");
  mkdirSync(raiz, { recursive: true, mode: 0o700 });
  const raizStat = lstatSync(raiz);
  if (raizStat.isSymbolicLink() || !raizStat.isDirectory() || realpathSync(raiz) !== raiz) {
    throw new AislamientoError("carpeta_no_permitida", "La carpeta de perfiles de Codex no es segura.");
  }
  const perfil = rutaPerfilCodex(id);
  mkdirSync(perfil, { recursive: true, mode: 0o700 });
  const stat = lstatSync(perfil);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(perfil) !== perfil) {
    throw new AislamientoError("carpeta_no_permitida", "El perfil de Codex no es seguro.");
  }
  if (sessionId && /^[0-9a-fA-F-]{1,128}$/.test(sessionId)) {
    const home = process.env.HOME && process.env.HOME !== "/" ? process.env.HOME : "";
    const codexHome = process.env.CODEX_HOME?.trim() ? resolve(process.env.CODEX_HOME) : home ? join(home, ".codex") : "";
    const sesionesReales = codexHome ? rutaReal(join(codexHome, "sessions")) : null;
    if (sesionesReales) {
      for await (const archivo of new Bun.Glob(`**/*${sessionId}.jsonl`).scan({ cwd: sesionesReales, onlyFiles: true, followSymlinks: false })) {
        const origen = join(sesionesReales, archivo);
        const origenReal = rutaReal(origen);
        const origenStat = lstatSync(origen);
        if (!origenReal || !dentro(origenReal, sesionesReales) || !origenStat.isFile() || origenStat.isSymbolicLink()) continue;
        const rutaRelativa = relative(sesionesReales, origenReal);
        const destino = join(perfil, "sessions", rutaRelativa);
        if (rutaRelativa.startsWith("..") || resolve(destino) !== destino) continue;
        let directorio = perfil;
        for (const parte of relative(perfil, dirname(destino)).split(sep).filter(Boolean)) {
          directorio = join(directorio, parte);
          try { mkdirSync(directorio, { mode: 0o700 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          const directorioStat = lstatSync(directorio);
          if (directorioStat.isSymbolicLink() || !directorioStat.isDirectory() || realpathSync(directorio) !== directorio) {
            throw new AislamientoError("carpeta_no_permitida", "La ruta de sesión Codex no es segura.");
          }
        }
        try {
          const destinoStat = lstatSync(destino);
          if (destinoStat.isSymbolicLink() || !destinoStat.isFile()) throw new AislamientoError("carpeta_no_permitida", "El archivo de sesión Codex no es seguro.");
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          copyFileSync(origenReal, destino, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
  }
  return perfil;
}

export function eliminarPerfilCodex(id: string): void {
  rmSync(rutaPerfilCodex(id), { recursive: true, force: true });
}

function rutaPerfilAntigravity(id: string): string {
  return join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-antigravity", createHash("sha256").update(id).digest("hex"));
}

export function configuracionAntigravityAislada(home: string, cwd: string, soloLectura: boolean, adjuntos: { rutaVisible: string }[] = []) {
  return {
    enableTerminalSandbox: true,
    toolPermission: "proceed-in-sandbox",
    allowNonWorkspaceAccess: false,
    artifactReviewPolicy: "always-proceed",
    permissions: {
      allow: [`read_file(${cwd})`, `read_file(${join(home, ".agents", "skills")})`, ...HERRAMIENTAS.map(ruta => `read_file(${join(home, ruta)})`), ...adjuntos.map(a => `read_file(${a.rutaVisible})`), "read_url(*)"],
      // Las reglas read_file también gobiernan los montajes del sandbox nativo de comandos.
      // No permitir command(*): también autorizaría ejecuciones fuera de ese sandbox.
      deny: [`read_file(${join(home, ".gemini")})`, `write_file(${join(home, ".gemini")})`,
        `write_file(${join(cwd, ".agents")})`, `write_file(${join(cwd, ".gemini")})`,
        ...(soloLectura ? ["write_file(*)"] : [])],
    },
  };
}

export function prepararPerfilAntigravity(id: string, cwd: string, soloLectura = false, adjuntos: { rutaVisible: string }[] = []): string {
  const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-antigravity");
  const perfil = rutaPerfilAntigravity(id);
  for (const carpeta of [raiz, perfil, join(perfil, "antigravity-cli")]) {
    mkdirSync(carpeta, { recursive: true, mode: 0o700 });
    const stat = lstatSync(carpeta);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(carpeta) !== carpeta) throw new AislamientoError("carpeta_no_permitida", "El perfil de Antigravity no es seguro.");
  }
  const ajustes = join(perfil, "antigravity-cli", "settings.json");
  if (existsSync(ajustes)) {
    const stat = lstatSync(ajustes);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(ajustes) !== ajustes) throw new AislamientoError("carpeta_no_permitida", "La configuración de Antigravity no es segura.");
  }
  const home = process.env.HOME;
  if (!home || home === "/") throw new AislamientoError("carpeta_no_permitida", "Antigravity requiere el HOME del usuario del servicio.");
  writeFileSync(ajustes, JSON.stringify(configuracionAntigravityAislada(home, cwd, soloLectura, adjuntos)), { mode: 0o600 });
  return perfil;
}

export function eliminarPerfilAntigravity(id: string): void {
  rmSync(rutaPerfilAntigravity(id), { recursive: true, force: true });
}

function archivoConfiguracionCodex(home: string, nombre: string): string | null {
  const carpetaCodex = process.env.CODEX_HOME?.trim() ? resolve(process.env.CODEX_HOME) : join(home, ".codex");
  const ruta = join(carpetaCodex, nombre);
  try {
    const stat = lstatSync(ruta);
    return stat.isFile() && !stat.isSymbolicLink() ? rutaReal(ruta) : null;
  } catch {
    return null;
  }
}

export function prepararDirectorioOpenCode(carpeta: string): string {
  const destino = join(carpeta, ".opencode");
  try {
    const info = lstatSync(destino);
    if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(destino) !== destino)
      throw new Error("Directorio no seguro");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new AislamientoError("carpeta_no_permitida", "La carpeta .opencode del workspace no es segura.");
    mkdirSync(destino, { mode: 0o700 });
  }
  return destino;
}

// Una sesión por conversación permite reanudarla sin compartir las sesiones entre chats.
// Las tareas sin chat usan su propio ID y la limpieza de tareas purga el perfil tras la retención.
export function prepararPerfilOpenCode(id: string): string {
  const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-opencode");
  mkdirSync(raiz, { recursive: true, mode: 0o700 });
  const perfil = rutaPerfilOpenCode(id);
  for (const ruta of [raiz, perfil, ...["data", "state", "cache"].flatMap((parte) => [join(perfil, parte), join(perfil, parte, "opencode")])]) {
    try { mkdirSync(ruta, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = lstatSync(ruta);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(ruta) !== ruta) {
      throw new AislamientoError("carpeta_no_permitida", "El perfil de OpenCode contiene una ruta no segura.");
    }
  }
  return perfil;
}

export function eliminarPerfilOpenCode(id: string): void {
  rmSync(rutaPerfilOpenCode(id), { recursive: true, force: true });
}

// Carpetas donde un agente puede trabajar: un proyecto registrado (dentro de TELO_PROYECTOS_DIR)
// o la carpeta temporal de un chat o de una tarea (dentro de DATA_DIR).
export function carpetaPermitida(cwd: string): boolean {
  const destino = rutaReal(cwd);
  if (!destino) return false;

  const datos = resolve(config.dataDir);
  const zonas = [join(datos, "chat-workspace"), join(datos, "tasks")].map((z) => rutaReal(z) ?? z);
  if (zonas.some((z) => destino === z || dentro(destino, z))) return true;

  // Un proyecto es una carpeta dentro de la raíz de proyectos, nunca la raíz misma.
  const proyectos = config.projectsDir ? rutaReal(config.projectsDir) : null;
  return proyectos !== null && dentro(destino, proyectos);
}

// Verdadero si `raiz` es `ruta` o una carpeta que la contiene.
function contiene(raiz: string, ruta: string): boolean {
  return ruta === raiz || ruta.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep);
}

// Nunca se da lectura al repo, a DATA_DIR ni a la carpeta de proyectos, ni a una carpeta que los
// contenga (por ejemplo el HOME o /): eso reabriría lo que el aislamiento oculta.
// El HOME sí puede ser fuente de una ruta concreta: opencode suele vivir ahí.
function lecturaExtra(): string[] {
  const prohibidas = [RAIZ_REPO, config.dataDir, config.projectsDir, ...rutasSensibles()]
    .filter((r): r is string => !!r && existsSync(r))
    .map((r) => rutaReal(r) ?? resolve(r));
  const rutas = (process.env.TELO_LECTURA_EXTRA ?? "")
    .split(":")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/") && existsSync(r))
    .map((r) => rutaReal(r) ?? r);
  return rutas.filter((r) => !prohibidas.some((p) => contiene(r, p) || contiene(p, r)));
}

// Archivos sensibles del VM que `--ro-bind / /` dejaría legibles si nadie los ocultara:
// el archivo de entorno del servicio (TELO_CLAVE y la clave maestra) y la clave privada
// de la GitHub App (legible por el servicio para firmar, y por tanto por el agente).
// TELO_OCULTAR_EXTRA añade más rutas (separadas por ":"), igual que TELO_LECTURA_EXTRA.
function rutasSensibles(): string[] {
  const claveApp = config.githubAppPrivateKeyPath;
  const extra = (process.env.TELO_OCULTAR_EXTRA ?? "")
    .split(":")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/") && existsSync(r))
    .map((r) => rutaReal(r) ?? r);
  // Solo rutas existentes: si la ruta no existe, bwrap intentaría crear el punto de montaje dentro de la
  // vista de "/" en solo lectura y moriría con "Read-only file system". Si no existe, tampoco hay nada que ocultar.
  return ["/etc/orquestador", ...(claveApp && existsSync(claveApp) ? [rutaReal(claveApp) ?? resolve(claveApp)] : []), ...extra].filter(
    (r) => existsSync(r),
  );
}

// Argumentos de bwrap que van antes del comando del agente. Vacío si el aislamiento está desactivado.
export function prefijoAislamiento(
  cwd: string,
  soloLectura = false,
  adjuntos: { ruta: string; rutaVisible: string }[] = [],
  perfilOpenCodeDir?: string,
  opencodeConfigDir?: string,
  opencodeSubagentesTracePath?: string,
  opencodeMcpConfigPath?: string,
  opencodeActividadTracePath?: string,
  perfilCodexDir?: string,
  redDir?: string,
  perfilAntigravityDir?: string,
  perfilCommandCodeDir?: string,
): string[] {
  if (!aislamientoActivo()) return [];

  const carpeta = rutaReal(cwd);
  if (!carpeta || !carpetaPermitida(carpeta)) {
    throw new AislamientoError(
      "carpeta_no_permitida",
      "La carpeta de trabajo no está permitida para un agente.",
    );
  }
  if (!hallarEjecutable("bwrap")) {
    throw new AislamientoError(
      "aislamiento_no_disponible",
      "Falta bubblewrap en el servidor, así que el agente no puede correr aislado. Instálalo con: sudo apt install bubblewrap",
    );
  }

  const home = process.env.HOME && process.env.HOME !== "/" ? process.env.HOME : "";
  const authCommandCode = perfilCommandCodeDir ? autenticacionCommandCode() : null;
  if (perfilCommandCodeDir && !authCommandCode) {
    throw new AislamientoError("carpeta_no_permitida", "Command Code necesita una sesión válida en ~/.commandcode/auth.json.");
  }
  const configuracionCodexGlobal = perfilCodexDir && home
    ? ["auth.json", "config.toml", "requirements.toml"].flatMap((nombre) => {
      const ruta = archivoConfiguracionCodex(home, nombre);
      return ruta ? [{ nombre, ruta }] : [];
    })
    : [];
  let perfilCodexReal: string | null = null;
  if (perfilCodexDir) {
    const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-codex");
    const perfilReal = rutaReal(perfilCodexDir);
    const stat = lstatSync(perfilCodexDir);
    if (!perfilReal || !dentro(perfilReal, raizPerfiles) || !stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AislamientoError("carpeta_no_permitida", "El perfil de Codex no está dentro del almacenamiento de Telo.");
    }
    perfilCodexReal = perfilReal;
    for (const { nombre } of configuracionCodexGlobal) {
      const destinoArchivo = join(perfilReal, nombre);
      try {
        writeFileSync(destinoArchivo, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const archivo = lstatSync(destinoArchivo);
      if (!archivo.isFile() || archivo.isSymbolicLink() || archivo.nlink !== 1 || realpathSync(destinoArchivo) !== destinoArchivo) {
        throw new AislamientoError("carpeta_no_permitida", `El archivo ${nombre} del perfil Codex no es seguro.`);
      }
    }
  }
  let perfilCommandCodeReal: string | null = null;
  let politicaCommandCode: string | null = null;
  if (perfilCommandCodeDir) {
    const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-commandcode");
    const perfilReal = rutaReal(perfilCommandCodeDir);
    const stat = lstatSync(perfilCommandCodeDir);
    if (!perfilReal || !dentro(perfilReal, raizPerfiles) || !stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AislamientoError("carpeta_no_permitida", "El perfil de Command Code no está dentro del almacenamiento de Telo.");
    }
    perfilCommandCodeReal = perfilReal;
    politicaCommandCode = join(perfilReal, ".commandcode", "settings.json");
    const politicaStat = lstatSync(politicaCommandCode);
    if (!politicaStat.isFile() || politicaStat.isSymbolicLink() || politicaStat.nlink !== 1 || rutaReal(politicaCommandCode) !== politicaCommandCode) {
      throw new AislamientoError("carpeta_no_permitida", "La política Command Code no es segura.");
    }
  }

  // Se ocultan con un tmpfs vacío. El orden importa: primero lo oculto, luego lo que se monta encima.
  const ocultar = [config.dataDir, RAIZ_REPO, config.projectsDir, home]
    .filter((ruta): ruta is string => !!ruta && existsSync(ruta))
    .map((ruta) => rutaReal(ruta) ?? resolve(ruta));
  const args = [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    // Sin esto, el agente vería los procesos del servidor y podría leer su entorno (TELO_CLAVE).
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-net",
    "--die-with-parent",
  ];
  // /tmp propio y vacío para cada ejecución. Sin esto, /tmp es de solo lectura dentro del sandbox y OpenCode
  // falla al escribir su TMPDIR. Va después de "--ro-bind / /" y antes de lo que se monta encima.
  args.push("--tmpfs", "/tmp", "--tmpfs", "/run", "--cap-drop", "ALL");
  if (perfilCodexReal && configuracionCodexGlobal.length) {
    args.push("--dir", "/tmp/telo-codex-global");
    for (const archivo of configuracionCodexGlobal) {
      const destino = join("/tmp/telo-codex-global", archivo.nombre);
      args.push("--bind", join(perfilCodexReal, archivo.nombre), destino, "--ro-bind", archivo.ruta, destino);
    }
  }
  for (const ruta of [...new Set([...ocultar, ...rutasSensibles()])]) args.push("--tmpfs", ruta);

  if (adjuntos.length > 0) {
    args.push("--dir", "/tmp/telo-adjuntos");
    for (const adjunto of adjuntos) args.push("--ro-bind", adjunto.ruta, adjunto.rutaVisible);
  }

  if (home) {
    if (perfilAntigravityDir) {
      const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-antigravity");
      const perfil = rutaReal(perfilAntigravityDir);
      if (!perfil || !dentro(perfil, raiz) || !lstatSync(perfilAntigravityDir).isDirectory() || lstatSync(perfilAntigravityDir).isSymbolicLink()) throw new AislamientoError("carpeta_no_permitida", "El perfil de Antigravity no está dentro del almacenamiento de Telo.");
      const archivos = archivosSesionAntigravity(home);
      if (!archivos.length) throw new Error("Antigravity necesita su sesión de archivos del login SSH. Una sesión que solo vive en el keyring no puede usarse dentro del aislamiento. Inicia agy por SSH como usuario orquestador y comprueba que guarda la sesión en ese servidor.");
      const destino = join(home, ".gemini");
      args.push("--dir", destino, "--bind", perfil, destino);
      for (const archivo of archivos) {
        const placeholder = join(perfil, archivo.relativa);
        try { writeFileSync(placeholder, "", { flag: "wx", mode: 0o600 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        const stat = lstatSync(placeholder);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(placeholder) !== placeholder) throw new AislamientoError("carpeta_no_permitida", "El montaje de sesión de Antigravity no es seguro.");
        args.push("--ro-bind", archivo.ruta, join(destino, archivo.relativa));
      }
    }
    if (perfilCodexReal) {
      const destino = join(home, ".codex");
      args.push("--dir", destino, "--bind", perfilCodexReal, destino);
      for (const archivo of configuracionCodexGlobal) {
        // Bubblewrap resuelve los orígenes en el host, no en los destinos ya montados.
        args.push("--ro-bind", archivo.ruta, join(destino, archivo.nombre));
      }
    }
    if (perfilCommandCodeReal && politicaCommandCode && authCommandCode) {
      args.push("--dir", "/tmp/telo-commandcode-global", "--ro-bind", authCommandCode, "/tmp/telo-commandcode-global/auth.json");
      args.push("--dir", "/tmp/telo-commandcode-home", "--bind", perfilCommandCodeReal, "/tmp/telo-commandcode-home");
      args.push("--ro-bind", politicaCommandCode, "/tmp/telo-commandcode-home/.commandcode/settings.json");
      args.push("--ro-bind", "/tmp/telo-commandcode-global/auth.json", "/tmp/telo-commandcode-home/.commandcode/auth.json");
      args.push("--dir", "/tmp/telo-commandcode-home/.agents/skills", "--ro-bind-try", join(home, ".config", "opencode", "skills"), "/tmp/telo-commandcode-home/.agents/skills");
    }
    if (perfilOpenCodeDir) {
      const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-opencode");
      const perfilReal = rutaReal(perfilOpenCodeDir);
      if (!perfilReal || !dentro(perfilReal, raizPerfiles)) {
        throw new AislamientoError("carpeta_no_permitida", "El perfil de OpenCode no está dentro del almacenamiento de Telo.");
      }
      const destino = "/tmp/telo-opencode-profile";
      args.push("--dir", destino, "--bind", perfilReal, destino);
      const authJson = redDir ? join(redDir, "auth.json") : null;
      if (authJson) {
        const authDestino = join(perfilReal, "data", "opencode", "auth.json");
        if (!existsSync(authDestino)) {
          try {
            writeFileSync(authDestino, "{}", { encoding: "utf8", flag: "wx", mode: 0o600 });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
        args.push("--ro-bind-try", authJson, join(destino, "data", "opencode", "auth.json"));
      }
    }
    // Las skills globales las edita la app y la persona, no el agente: se montan en solo lectura encima del
    // estado de OpenCode (bwrap aplica el montaje posterior). Así un agente no deja instrucciones para los demás.
    const skillsGlobales = join(home, ".config", "opencode", "skills");
    args.push("--ro-bind-try", skillsGlobales, skillsGlobales);
    // Codex descubre las skills globales en ~/.agents/skills. Se expone la misma carpeta de Telo,
    // sin duplicar archivos ni permitir que el agente edite las instrucciones globales.
    args.push("--dir", join(home, ".agents"));
    args.push("--ro-bind-try", skillsGlobales, join(home, ".agents", "skills"));
    for (const rel of HERRAMIENTAS) {
      const ruta = join(home, rel);
      args.push("--ro-bind-try", ruta, ruta);
    }
  }

  if (opencodeConfigDir) {
    const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-subagente");
    const perfilReal = rutaReal(opencodeConfigDir);
    if (!perfilReal || !dentro(perfilReal, raizPerfiles)) {
      throw new AislamientoError("carpeta_no_permitida", "La configuración de subagentes no está dentro del almacenamiento de Telo.");
    }
    args.push("--dir", "/tmp/telo-opencode-config", "--ro-bind", perfilReal, "/tmp/telo-opencode-config");
    const gitignore = join(perfilReal, ".gitignore");
    try {
      writeFileSync(gitignore, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const gitignoreStat = lstatSync(gitignore);
    if (
      !gitignoreStat.isFile() ||
      gitignoreStat.isSymbolicLink() ||
      gitignoreStat.nlink !== 1 ||
      realpathSync(gitignore) !== gitignore
    ) {
      throw new AislamientoError("carpeta_no_permitida", "El .gitignore temporal de OpenCode no es seguro.");
    }
    // OpenCode inicializa la carpeta de configuración escribiendo este archivo. El resto sigue en solo lectura.
    args.push("--bind", gitignore, "/tmp/telo-opencode-config/.gitignore");
    if (opencodeSubagentesTracePath) {
      const captura = rutaReal(opencodeSubagentesTracePath);
      const esperada = join(perfilReal, "subagentes.ndjson");
      if (!captura || captura !== esperada || !lstatSync(captura).isFile()) {
        throw new AislamientoError("carpeta_no_permitida", "El registro temporal de subagentes no es seguro.");
      }
      // La configuración y los perfiles siguen en solo lectura. Solo se habilita escritura
      // en este archivo NDJSON temporal para que el plugin reporte actividad en vivo.
      args.push("--bind", captura, "/tmp/telo-opencode-config/subagentes.ndjson");
    }
  }

  if (opencodeMcpConfigPath) {
    const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-mcp");
    const configuracionReal = rutaReal(opencodeMcpConfigPath);
    const stat = lstatSync(opencodeMcpConfigPath);
    if (!configuracionReal || !dentro(configuracionReal, raizPerfiles) || !stat.isFile() || stat.isSymbolicLink()) {
      throw new AislamientoError("carpeta_no_permitida", "La configuración temporal de conexiones no es segura.");
    }
    args.push("--dir", "/tmp/telo-mcp-config");
    args.push("--ro-bind", configuracionReal, "/tmp/telo-mcp-config/opencode.json");
    if (opencodeActividadTracePath) {
      const captura = rutaReal(opencodeActividadTracePath);
      const carpeta = dirname(configuracionReal);
      const plugin = join(carpeta, "seguimiento.js");
      const statCaptura = lstatSync(opencodeActividadTracePath);
      const statPlugin = lstatSync(plugin);
      if (!captura || captura !== join(carpeta, "actividad.ndjson") || !statCaptura.isFile() || statCaptura.isSymbolicLink() || statCaptura.nlink !== 1 ||
        !statPlugin.isFile() || statPlugin.isSymbolicLink() || statPlugin.nlink !== 1 || rutaReal(plugin) !== plugin) {
        throw new AislamientoError("carpeta_no_permitida", "El registro temporal de actividad no es seguro.");
      }
      args.push("--ro-bind", plugin, "/tmp/telo-mcp-config/seguimiento.js", "--bind", captura, "/tmp/telo-mcp-config/actividad.ndjson");
    }
  }

  // Rutas extra en solo lectura (TELO_LECTURA_EXTRA, separadas por ":"), por ejemplo la carpeta de opencode
  // si está instalado fuera de las rutas por defecto. Nunca se acepta una ruta dentro de lo oculto.
  for (const ruta of lecturaExtra()) args.push("--ro-bind-try", ruta, ruta);

  // La carpeta de trabajo es lo único con escritura fuera del estado de OpenCode.
  args.push(soloLectura ? "--ro-bind" : "--bind", carpeta, carpeta);
  if (perfilAntigravityDir) {
    // Los hooks/plugins del clon no pueden ejecutar código con la sesión del runtime.
    for (const nombre of [".agents", ".gemini"]) {
      const ruta = join(carpeta, nombre);
      if (!existsSync(ruta)) continue;
      if (!lstatSync(ruta).isDirectory() || lstatSync(ruta).isSymbolicLink() || rutaReal(ruta) !== ruta) throw new AislamientoError("carpeta_no_permitida", "La configuración local de Antigravity no es segura.");
      args.push("--tmpfs", ruta);
    }
  }
  const entregables = carpetaEntregables(carpeta);
  mkdirSync(entregables, { recursive: true });
  args.push("--dir", entregables, soloLectura ? "--ro-bind" : "--bind", entregables, entregables);
  // Si la ejecución es en solo lectura (como el analizador), OpenCode aún necesita escribir
  // su configuración runtime, sesión y su .opencode/.gitignore dentro del workspace.
  // El runtime del analizador es temporal: nunca se vuelve escribible una fuente del
  // workspace después de montar el proyecto en solo lectura.
  const opencodeEnCwd = prepararDirectorioOpenCode(carpeta);
  if (soloLectura && existsSync(opencodeEnCwd)) {
    args.push("--tmpfs", opencodeEnCwd);
    // El runtime temporal no debe ocultar los datos y scripts de las skills del proyecto.
    const skills = join(opencodeEnCwd, "skills");
    if (existsSync(skills)) {
      if (!lstatSync(skills).isDirectory() || lstatSync(skills).isSymbolicLink() || rutaReal(skills) !== skills) {
        throw new AislamientoError("carpeta_no_permitida", "La carpeta de skills del workspace no es segura.");
      }
      args.push("--dir", skills, "--ro-bind", skills, skills);
    }
  }
  // El servidor es el único que escribe Git: commit y push pasan por aprobación.
  const git = join(carpeta, ".git");
  if (existsSync(git)) {
    if (!lstatSync(git).isDirectory())
      throw new AislamientoError(
        "carpeta_no_permitida",
        "La carpeta .git del workspace no es segura.",
      );
    if (!soloLectura) args.push("--ro-bind", git, git);
  }
  if (redDir) {
    const raiz = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-red");
    const real = rutaReal(redDir);
    if (!real || !dentro(real, raiz) || lstatSync(redDir).isSymbolicLink() ||
      !lstatSync(join(real, "broker.sock")).isSocket() || !hallarEjecutable("python3")) {
      throw new AislamientoError("carpeta_no_permitida", "El puente de red aislado no está disponible; comprueba python3 y el broker.");
    }
    args.push("--dir", "/tmp/telo-network", "--ro-bind", real, "/tmp/telo-network");
  }
  args.push("--chdir", carpeta, "--");
  if (redDir) args.push("python3", "/tmp/telo-network/bridge.py");
  return args;
}
