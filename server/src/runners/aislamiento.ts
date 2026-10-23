import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { config } from "../config";
import { carpetaEntregables } from "../entregables";
import { hallarEjecutable } from "../ejecutable";


// Aislamiento de los agentes con bubblewrap (bwrap). Cada ejecución ve:
// - su carpeta de trabajo, con escritura (proyecto o carpeta temporal del chat o tarea);
// - su perfil de OpenCode por conversación o tarea (sesiones; auth.json en solo lectura),
//   y herramientas en solo lectura;
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
const ESTADO_OPENCODE = [
  ".local/share/opencode",
  ".local/state/opencode",
  ".cache/opencode",
];
// Herramientas instaladas en el HOME: solo lectura.
const HERRAMIENTAS = [".local/bin", ".opencode", ".bun", ".gitconfig", ".config/git", ".config/opencode", ".codex"];

export function aislamientoActivo(): boolean {
  return process.env.TELO_AISLAMIENTO !== "desactivado";
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
  return join(config.dataDir, "perfiles-opencode", sello);
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
  const perfil = rutaPerfilOpenCode(id);
  for (const ruta of ["data/opencode", "state/opencode", "cache/opencode"]) {
    mkdirSync(join(perfil, ruta), { recursive: true, mode: 0o700 });
  }
  return perfil;
}

export function eliminarPerfilOpenCode(id: string): void {
  rmSync(rutaPerfilOpenCode(id), { recursive: true, force: true });
}

function authJsonOpenCode(home: string): string | null {
  const candidatos = [
    join(home, ".local", "share", "opencode", "auth.json"),
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "opencode", "auth.json") : null,
    join(home, ".config", "opencode", "auth.json"),
    join(home, ".opencode", "auth.json"),
  ].filter((ruta): ruta is string => Boolean(ruta));
  for (const ruta of candidatos) {
    if (existsSync(ruta)) return rutaReal(ruta) ?? ruta;
  }
  return null;
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
    "--die-with-parent",
  ];
  // /tmp propio y vacío para cada ejecución. Sin esto, /tmp es de solo lectura dentro del sandbox y OpenCode
  // falla al escribir su TMPDIR. Va después de "--ro-bind / /" y antes de lo que se monta encima.
  args.push("--tmpfs", "/tmp");
  for (const ruta of [...new Set([...ocultar, ...rutasSensibles()])]) args.push("--tmpfs", ruta);

  if (adjuntos.length > 0) {
    args.push("--dir", "/tmp/telo-adjuntos");
    for (const adjunto of adjuntos) args.push("--ro-bind", adjunto.ruta, adjunto.rutaVisible);
  }

  if (home) {
    if (perfilOpenCodeDir) {
      const raizPerfiles = join(rutaReal(config.dataDir) ?? resolve(config.dataDir), "perfiles-opencode");
      const perfilReal = rutaReal(perfilOpenCodeDir);
      if (!perfilReal || !dentro(perfilReal, raizPerfiles)) {
        throw new AislamientoError("carpeta_no_permitida", "El perfil de OpenCode no está dentro del almacenamiento de Telo.");
      }
      const destino = "/tmp/telo-opencode-profile";
      args.push("--dir", destino, "--bind", perfilReal, destino);
      const authJson = authJsonOpenCode(home);
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
    } else {
      for (const rel of ESTADO_OPENCODE) {
        const ruta = join(home, rel);
        args.push("--bind-try", ruta, ruta);
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
  }

  // Rutas extra en solo lectura (TELO_LECTURA_EXTRA, separadas por ":"), por ejemplo la carpeta de opencode
  // si está instalado fuera de las rutas por defecto. Nunca se acepta una ruta dentro de lo oculto.
  for (const ruta of lecturaExtra()) args.push("--ro-bind-try", ruta, ruta);

  // La carpeta de trabajo es lo único con escritura fuera del estado de OpenCode.
  args.push(soloLectura ? "--ro-bind" : "--bind", carpeta, carpeta);
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
  args.push("--chdir", carpeta, "--");
  return args;
}
