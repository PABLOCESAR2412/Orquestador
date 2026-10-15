import { existsSync } from "node:fs";
import { join } from "node:path";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";
import { hallarEjecutable, lanzarEnGrupo, matarGrupo } from "./ejecutable";


// Inicio de sesión de Codex con la cuenta de ChatGPT, por código de dispositivo, ejecutado en el servidor.
// La app muestra la URL y el código que imprime el CLI. El token nunca sale del servidor ni llega a la base:
// la app solo comprueba que exista el archivo de sesión, sin leer su contenido. Los agentes no lo ven
// (~/.codex no está en la lista de bubblewrap).
//
// Comando: `codex login --device-auth`. Confirmar en el VM con `codex login --help` antes de dar por bueno.

const PROGRAMA = "codex";
const ARGUMENTOS = ["login", "--device-auth"];
const TIEMPO_MAXIMO_MS = 15 * 60_000;
const SALIDA_MAXIMA = 4_000;

export class LoginError extends Error {
  constructor(
    readonly code: string,
    readonly status: 409 | 503,
  ) {
    super(code);
  }
}

export type EstadoLoginCodex = "inactivo" | "esperando" | "conectado" | "fallido";

export type LoginCodex = {
  estado: EstadoLoginCodex;
  // Hay archivo de sesión en el servidor. Solo indica que existe; nunca se lee.
  conectada: boolean;
  url: string | null;
  codigo: string | null;
  // Últimas líneas de la salida del CLI, redactadas.
  salida: string;
  motivo: string | null;
  iniciada: string | null;
};

type Sesion = {
  estado: EstadoLoginCodex;
  iniciada: string;
  motivo: string | null;
  url: string | null;
  codigo: string | null;
  salida: string;
  proc: Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe"> | null;
  cancelada: boolean;
};

let sesion: Sesion | null = null;

// Rutas que indican sesión. Se calculan en cada uso: el HOME puede cambiar después de cargar el módulo.
function archivosAuth(): string[] {
  const home = carpetaHome();
  const codexHome = process.env.CODEX_HOME;
  return [
    ...(codexHome ? [join(codexHome, "auth.json")] : []),
    join(home, ".codex", "auth.json"),
    join(home, ".config", "codex", "auth.json"),
    join(home, ".codex", "config.json"),
    join(home, ".config", "codex", "config.json"),
    join(home, ".codex", "session.json"),
  ];
}

export function sesionCodexConectada(): boolean {
  return archivosAuth().some((ruta) => existsSync(ruta));
}

function entornoMinimo(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
  };
}

// Primera URL y primer código de dispositivo (cuatro caracteres, guion y al menos cuatro más).
function extraer(texto: string): { url: string | null; codigo: string | null } {
  return {
    url: /https?:\/\/[^\s"'<>)\]]+/.exec(texto)?.[0] ?? null,
    codigo: /\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/.exec(texto)?.[0] ?? null,
  };
}

function limpiar(texto: string): string {
  return redactar(texto, valoresDeConfiguracion()).slice(-SALIDA_MAXIMA);
}

export function estadoLoginCodex(): LoginCodex {
  return {
    estado: sesion?.estado ?? "inactivo",
    conectada: sesionCodexConectada(),
    url: sesion?.url ?? null,
    codigo: sesion?.codigo ?? null,
    salida: sesion?.salida ?? "",
    motivo: sesion?.motivo ?? null,
    iniciada: sesion?.iniciada ?? null,
  };
}

export function iniciarLoginCodex(): LoginCodex {
  if (sesion?.estado === "esperando") throw new LoginError("login_en_curso", 409);
  if (hallarEjecutable(PROGRAMA) === null) throw new LoginError("codex_no_instalado", 503);

  let proc: Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;
  try {
    proc = lanzarEnGrupo([PROGRAMA, ...ARGUMENTOS], entornoMinimo(), "pipe");
  } catch {
    throw new LoginError("codex_no_instalado", 503);
  }

  const actual: Sesion = {
    estado: "esperando",
    iniciada: new Date().toISOString(),
    motivo: null,
    url: null,
    codigo: null,
    salida: "",
    proc,
    cancelada: false,
  };
  sesion = actual;
  void seguir(actual, proc);
  return estadoLoginCodex();
}

export async function confirmarLoginCodex(): Promise<LoginCodex> {
  if (sesionCodexConectada()) {
    if (sesion) sesion.estado = "conectado";
    return estadoLoginCodex();
  }
  // Si el CLI está en ejecución, enviar Enter en caso de que esté esperando confirmación interactiva
  if (sesion?.estado === "esperando" && sesion.proc) {
    try {
      const stdin = sesion.proc.stdin;
      if (stdin && typeof stdin === "object" && "write" in stdin) {
        // Enviar salto de línea
        (stdin as { write: (d: Uint8Array) => void; flush?: () => void }).write(new TextEncoder().encode("\n"));
        (stdin as { flush?: () => void }).flush?.();
      }
    } catch {
      // Ignorar si el stdin no admite escritura
    }
    await Bun.sleep(1200);
    if (sesionCodexConectada()) {
      sesion.estado = "conectado";
    }
  }
  return estadoLoginCodex();
}

export function cancelarLoginCodex(): LoginCodex {
  if (sesion?.estado === "esperando" && sesion.proc) {
    sesion.cancelada = true;
    matarGrupo(sesion.proc);
  }
  return estadoLoginCodex();
}

// Lee la salida mientras el CLI espera a la persona, para mostrar la URL y el código en cuanto aparecen.
async function volcar(flujo: ReadableStream<Uint8Array>, actual: Sesion): Promise<void> {
  const lector = flujo.getReader();
  const decodificador = new TextDecoder();
  let acumulado = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    acumulado += decodificador.decode(value, { stream: true });
    actual.salida = limpiar(acumulado);
    const { url, codigo } = extraer(actual.salida);
    actual.url ??= url;
    actual.codigo ??= codigo;
  }
}

async function seguir(actual: Sesion, proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
  let agotado = false;
  const reloj = setTimeout(() => {
    agotado = true;
    matarGrupo(proc);
  }, TIEMPO_MAXIMO_MS);
  try {
    const lecturas = Promise.all([volcar(proc.stdout, actual), volcar(proc.stderr, actual)]);
    const codigoSalida = await proc.exited;
    // Espera la última salida, pero no más de un segundo: un hijo que se haya escapado del grupo no debe bloquear.
    await Promise.race([lecturas, Bun.sleep(1000)]);
    // Éxito = salida 0 y archivo de sesión presente. Si ya había sesión y el intento falla, no cuenta como conectado.
    if (codigoSalida === 0 && sesionCodexConectada()) {
      actual.estado = "conectado";
    } else {
      actual.estado = "fallido";
      actual.motivo = actual.cancelada ? "cancelado" : agotado ? "tiempo_agotado" : "login_no_completado";
    }
  } catch {
    actual.estado = "fallido";
    actual.motivo = "login_no_completado";
  } finally {
    clearTimeout(reloj);
    actual.proc = null;
  }
}
