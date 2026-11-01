import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";
import { hallarEjecutable, lanzarEnGrupo, matarGrupo } from "./ejecutable";
import { registrarTrabajo } from "./despliegue";

const COMANDO_ANTIGRAVITY = `script="$(mktemp)"; trap 'rm -f "$script"' EXIT; curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --max-filesize 1048576 https://antigravity.google/cli/install.sh -o "$script"; test -s "$script"; bash -n "$script"; bash "$script"`;

// Instalación de herramientas desde la app. La API recibe solo un identificador de esta lista, nunca un
// comando. Las acciones usan parámetros fijos y entorno mínimo (sin TELO_* ni claves).
// OpenCode se instala con npm dentro de ~/.opencode: esa carpeta ya es visible (solo lectura) para el agente
// en bubblewrap, así que no hace falta tocar TELO_LECTURA_EXTRA.

type Accion = {
  nombre: string;
  // Texto que ve la persona antes de confirmar. Debe coincidir con `argv`.
  comando: string;
  programa: string;
  argv: (prefijo: string) => string[];
  // Ejecutable que deja la instalación, dentro de la carpeta de instalación.
  ejecutable: (prefijo: string) => string;
  // Nombre con el que el servidor lo busca en PATH.
  binario: string;
};

const ACCIONES = {
  opencode: {
    nombre: "OpenCode",
    comando: "npm install -g --prefix ~/.opencode opencode-ai@1.19.5",
    programa: "npm",
    argv: (prefijo) => ["install", "-g", "--prefix", prefijo, "opencode-ai@1.19.5"],
    ejecutable: (prefijo) => join(prefijo, "bin", "opencode"),
    binario: "opencode",
  },
  codex: {
    nombre: "Codex",
    comando: "npm install -g --prefix ~/.opencode @openai/codex@0.166.0",
    programa: "npm",
    argv: (prefijo) => ["install", "-g", "--prefix", prefijo, "@openai/codex@0.166.0"],
    ejecutable: (prefijo) => join(prefijo, "bin", "codex"),
    binario: "codex",
  },
  antigravity: {
    nombre: "Antigravity CLI",
    comando: COMANDO_ANTIGRAVITY,
    programa: "bash",
    argv: () => ["-e", "-u", "-o", "pipefail", "-c", COMANDO_ANTIGRAVITY],
    ejecutable: () => join(carpetaHome(), ".local", "bin", "agy"),
    binario: "agy",
  },
  hermes: {
    nombre: "Hermes Agent",
    comando: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser --skip-computer-use",
    programa: "bash",
    argv: () => ["-o", "pipefail", "-c", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive --skip-browser --skip-computer-use"],
    ejecutable: () => join(carpetaHome(), ".local", "bin", "hermes"),
    binario: "hermes",
  },
} satisfies Record<string, Accion>;

export type HerramientaInstalable = keyof typeof ACCIONES;
export type EstadoInstalacion = "inactiva" | "instalando" | "lista" | "error";

export type InstalacionPublica = {
  herramienta: HerramientaInstalable;
  nombre: string;
  comando: string;
  estado: EstadoInstalacion;
  // El CLI se encuentra en PATH del servidor (independiente de si esta app lo instaló).
  instalada: boolean;
  iniciada: string | null;
  terminada: string | null;
  // Código legible (ver errorText en la web). null si no hay error.
  motivo: string | null;
  // Últimas líneas de la salida del instalador, redactadas.
  salida: string;
};

type Interna = Omit<InstalacionPublica, "instalada"> & { codigo: number | null };

const TIEMPO_MAXIMO_MS = 10 * 60_000;
const SALIDA_MAXIMA = 12_000;

const estados = new Map<HerramientaInstalable, Interna>();

export class InstalacionError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 503,
  ) {
    super(code);
  }
}

export function esInstalable(id: string): id is HerramientaInstalable {
  return Object.hasOwn(ACCIONES, id);
}

function carpetaDeInstalacion(): string {
  return join(carpetaHome(), ".opencode");
}

// Añade la carpeta de instalación al PATH de este proceso si el ejecutable ya está ahí. Así, tras instalar
// (o tras reiniciar el servidor) el CLI se encuentra sin tocar el archivo de servicio de systemd.
export function asegurarRutaInstalada(): void {
  const rutas = [join(carpetaHome(), ".opencode", "bin"), join(carpetaHome(), ".local", "bin")];
  for (const bin of rutas) {
    if (!existsSync(bin)) continue;
    const actual = (process.env.PATH ?? "").split(":");
    if (!actual.includes(bin)) process.env.PATH = [bin, ...actual].filter(Boolean).join(":");
  }
}

function instalada(id: HerramientaInstalable): boolean {
  return hallarEjecutable(ACCIONES[id].binario) !== null;
}

function publica(id: HerramientaInstalable): InstalacionPublica {
  const { codigo: _codigo, ...resto } = estados.get(id) ?? inactiva(id);
  return { ...resto, instalada: instalada(id) };
}

function inactiva(id: HerramientaInstalable): Interna {
  return {
    herramienta: id,
    nombre: ACCIONES[id].nombre,
    comando: ACCIONES[id].comando,
    estado: "inactiva",
    iniciada: null,
    terminada: null,
    motivo: null,
    salida: "",
    codigo: null,
  };
}

export function estadoInstalacion(id: HerramientaInstalable): InstalacionPublica {
  return publica(id);
}

// Entorno de npm: el mínimo más HOME (para ~/.npmrc y la caché). Nada de variables del servidor.
function entornoInstalacion(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
    npm_config_update_notifier: "false",
  };
}

export function iniciarInstalacion(id: string): InstalacionPublica {
  if (!esInstalable(id)) throw new InstalacionError("herramienta_desconocida", 404);
  if (estados.get(id)?.estado === "instalando") throw new InstalacionError("instalacion_en_curso", 409);
  if (instalada(id)) throw new InstalacionError("ya_instalada", 409);

  const accion = ACCIONES[id];
  if (hallarEjecutable(accion.programa) === null) {
    throw new InstalacionError(["antigravity", "hermes"].includes(id) ? "bash_no_disponible" : "npm_no_disponible", 503);
  }
  if (["antigravity", "hermes"].includes(id) && hallarEjecutable("curl") === null) throw new InstalacionError("curl_no_disponible", 503);

  const prefijo = carpetaDeInstalacion();
  if (id === "opencode" || id === "codex") mkdirSync(prefijo, { recursive: true });

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = lanzarEnGrupo([accion.programa, ...accion.argv(prefijo)], entornoInstalacion());
  } catch {
    throw new InstalacionError(["antigravity", "hermes"].includes(id) ? "bash_no_disponible" : "npm_no_disponible", 503);
  }

  estados.set(id, {
    ...inactiva(id),
    estado: "instalando",
    iniciada: new Date().toISOString(),
  });
  const finalizar = registrarTrabajo();
  void seguir(id, proc).catch(() => console.error("No se pudo registrar el resultado de la instalación")).finally(finalizar);
  return publica(id);
}

// Espera a que npm termine (o al tiempo máximo) y deja el resultado en el estado.
async function seguir(id: HerramientaInstalable, proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
  let agotado = false;
  const reloj = setTimeout(() => {
    agotado = true;
    matarGrupo(proc);
  }, TIEMPO_MAXIMO_MS);
  let salida = "";
  let codigo: number | null = null;
  try {
    const [out, err, cod] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    salida = out + err;
    codigo = cod;
  } catch {
    codigo = null;
  } finally {
    clearTimeout(reloj);
  }

  const texto = redactar(salida, valoresDeConfiguracion()).slice(-SALIDA_MAXIMA);
  const accion = ACCIONES[id];
  let motivo: string | null = null;
  if (agotado) motivo = "tiempo_agotado";
  else if (codigo !== 0) motivo = "npm_fallo";
  else if (!existsSync(accion.ejecutable(carpetaDeInstalacion()))) motivo = "no_visible_tras_instalar";
  else asegurarRutaInstalada();

  if (!motivo && !instalada(id)) motivo = "no_visible_tras_instalar";

  estados.set(id, {
    ...(estados.get(id) ?? inactiva(id)),
    estado: motivo ? "error" : "lista",
    terminada: new Date().toISOString(),
    motivo,
    salida: texto,
    codigo,
  });
}
