import { existsSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { config } from "../config";

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

// Estado de OpenCode dentro del HOME: lectura y escritura.
const ESTADO_OPENCODE = [".local/share/opencode", ".config/opencode", ".local/state/opencode", ".cache/opencode"];
// Herramientas instaladas en el HOME: solo lectura.
const HERRAMIENTAS = [".local/bin", ".opencode", ".bun", ".gitconfig", ".config/git"];

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

// Nunca se da lectura al repo, a DATA_DIR ni a la carpeta de proyectos (los demás se ocultan).
// El HOME sí puede ser fuente: opencode suele vivir ahí.
function lecturaExtra(): string[] {
  const prohibidas = [RAIZ_REPO, config.dataDir, config.projectsDir]
    .filter((r): r is string => !!r && existsSync(r))
    .map((r) => rutaReal(r) ?? resolve(r));
  const rutas = (process.env.TELO_LECTURA_EXTRA ?? "")
    .split(":")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("/") && existsSync(r))
    .map((r) => rutaReal(r) ?? r);
  return rutas.filter((r) => !prohibidas.some((p) => r === p || dentro(r, p)));
}

// Argumentos de bwrap que van antes del comando del agente. Vacío si el aislamiento está desactivado.
export function prefijoAislamiento(cwd: string): string[] {
  if (!aislamientoActivo()) return [];

  const carpeta = rutaReal(cwd);
  if (!carpeta || !carpetaPermitida(carpeta)) {
    throw new AislamientoError(
      "carpeta_no_permitida",
      "La carpeta de trabajo no está permitida para un agente.",
    );
  }
  if (!Bun.which("bwrap")) {
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
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    // Sin esto, el agente vería los procesos del servidor y podría leer su entorno (TELO_CLAVE).
    "--unshare-pid",
    "--unshare-ipc",
    "--die-with-parent",
  ];
  for (const ruta of [...new Set(ocultar)]) args.push("--tmpfs", ruta);

  if (home) {
    for (const rel of ESTADO_OPENCODE) {
      const ruta = join(home, rel);
      args.push("--bind-try", ruta, ruta);
    }
    for (const rel of HERRAMIENTAS) {
      const ruta = join(home, rel);
      args.push("--ro-bind-try", ruta, ruta);
    }
  }

  // Rutas extra en solo lectura (TELO_LECTURA_EXTRA, separadas por ":"), por ejemplo la carpeta de opencode
  // si está instalado fuera de las rutas por defecto. Nunca se acepta una ruta dentro de lo oculto.
  for (const ruta of lecturaExtra()) args.push("--ro-bind-try", ruta, ruta);

  // La carpeta de trabajo es lo único con escritura fuera del estado de OpenCode.
  args.push("--bind", carpeta, carpeta, "--chdir", carpeta, "--");
  return args;
}
