import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { config } from "../config";
import { hallarEjecutable } from "../ejecutable";


// Aislamiento de los agentes con bubblewrap (bwrap). Cada ejecución ve:
// - su carpeta de trabajo, con escritura (proyecto o carpeta temporal del chat o tarea);
// - el estado de OpenCode en el HOME (claves y configuración), y herramientas en solo lectura;
// - el resto del sistema en solo lectura, sin el repo de Orquestador, sin DATA_DIR,
//   sin otros proyectos, sin el resto del HOME (por ejemplo ~/.ssh) y sin los procesos del servidor.
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

// Estado de OpenCode y herramientas de agente dentro del HOME: lectura y escritura.
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
  const prohibidas = [RAIZ_REPO, config.dataDir, config.projectsDir]
    .filter((r): r is string => !!r && existsSync(r))
    .map((r) => rutaReal(r) ?? resolve(r));
  const rutas = (process.env.TELO_LECTURA_EXTRA ?? "")
    .split(":")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/") && existsSync(r))
    .map((r) => rutaReal(r) ?? r);
  return rutas.filter((r) => !prohibidas.some((p) => contiene(r, p) || contiene(p, r)));
}

// Argumentos de bwrap que van antes del comando del agente. Vacío si el aislamiento está desactivado.
export function prefijoAislamiento(
  cwd: string,
  soloLectura = false,
  adjuntos: { ruta: string; rutaVisible: string }[] = [],
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
  for (const ruta of [...new Set(ocultar)]) args.push("--tmpfs", ruta);

  if (adjuntos.length > 0) {
    args.push("--dir", "/tmp/telo-adjuntos");
    for (const adjunto of adjuntos) args.push("--ro-bind", adjunto.ruta, adjunto.rutaVisible);
  }

  if (home) {
    for (const rel of ESTADO_OPENCODE) {
      const ruta = join(home, rel);
      args.push("--bind-try", ruta, ruta);
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

  // Rutas extra en solo lectura (TELO_LECTURA_EXTRA, separadas por ":"), por ejemplo la carpeta de opencode
  // si está instalado fuera de las rutas por defecto. Nunca se acepta una ruta dentro de lo oculto.
  for (const ruta of lecturaExtra()) args.push("--ro-bind-try", ruta, ruta);

  // La carpeta de trabajo es lo único con escritura fuera del estado de OpenCode.
  args.push(soloLectura ? "--ro-bind" : "--bind", carpeta, carpeta);
  // Si la ejecución es en solo lectura (como el analizador), OpenCode aún necesita escribir
  // su configuración runtime, sesión y su .opencode/.gitignore dentro del workspace.
  // Montamos .opencode con permisos de escritura superpuestos para evitar fallos de EROFS.
  const opencodeEnCwd = join(carpeta, ".opencode");
  try {
    mkdirSync(opencodeEnCwd, { recursive: true });
  } catch {}
  if (soloLectura && existsSync(opencodeEnCwd)) {
    args.push("--bind-try", opencodeEnCwd, opencodeEnCwd);
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
