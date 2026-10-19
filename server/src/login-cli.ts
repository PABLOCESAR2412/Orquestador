import { stripVTControlCharacters } from "node:util";
import { carpetaHome } from "./hogar";
import { redactar, valoresDeConfiguracion } from "./redaccion";
import { hallarEjecutable, lanzarEnGrupo, matarGrupo } from "./ejecutable";


// Inicio de sesión de Codex con la cuenta de ChatGPT, por código de dispositivo, ejecutado en el servidor.
// La app muestra la URL y el código que imprime el CLI. El token nunca sale del servidor ni llega a la base:
// la app consulta `codex login status` sin leer ni devolver credenciales. El sandbox monta ~/.codex
// como herramienta de solo lectura para que Codex pueda autenticarse sin modificar el estado global.
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
  // El CLI confirma su estado local de autenticación; no se devuelven credenciales.
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

let comprobacion: { clave: string; hasta: number; conectada: boolean } | null = null;
let consulta: { clave: string; promesa: Promise<boolean> } | null = null;

// El CLI conoce tanto auth.json como el almacén del sistema. Nunca se lee ni devuelve su contenido.
export async function sesionCodexConectada(forzar = false): Promise<boolean> {
  const codex = hallarEjecutable(PROGRAMA);
  if (!codex) return false;
  const clave = `${codex}\0${carpetaHome()}\0${process.env.CODEX_HOME ?? ""}`;
  if (!forzar && comprobacion?.clave === clave && comprobacion.hasta > Date.now()) return comprobacion.conectada;
  if (consulta?.clave === clave) {
    if (!forzar) return consulta.promesa;
    await consulta.promesa;
  }
  const promesa = (async () => {
    let proc: ReturnType<typeof Bun.spawn> | undefined;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    let conectada = false;
    try {
      proc = Bun.spawn([codex, "login", "status"], { env: entornoMinimo(), stdout: "ignore", stderr: "ignore" });
      const proceso = proc;
      reloj = setTimeout(() => { try { proceso.kill(); } catch { /* Ya terminó. */ } }, 5000);
      conectada = await proceso.exited === 0;
    } catch { /* Un CLI ausente o que falla no confirma la sesión. */ }
    finally { if (reloj) clearTimeout(reloj); }
    comprobacion = { clave, hasta: Date.now() + 30_000, conectada };
    return conectada;
  })();
  consulta = { clave, promesa };
  try { return await promesa; }
  finally { if (consulta?.promesa === promesa) consulta = null; }
}

function entornoMinimo(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
    ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
  };
}

// Primera URL y primer código de dispositivo (cuatro caracteres, guion y al menos cuatro más).
export function interpretarSalidaLoginCodex(texto: string): { url: string | null; codigo: string | null; salida: string } {
  const salida = redactar(stripVTControlCharacters(texto), valoresDeConfiguracion()).slice(-SALIDA_MAXIMA);
  return {
    url: /https?:\/\/[^\s"'<>)\]]+/.exec(salida)?.[0] ?? null,
    codigo: /\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/.exec(salida)?.[0] ?? null,
    salida,
  };
}

export async function estadoLoginCodex(): Promise<LoginCodex> {
  return {
    estado: sesion?.estado ?? "inactivo",
    conectada: await sesionCodexConectada(),
    url: sesion?.url ?? null,
    codigo: sesion?.codigo ?? null,
    salida: sesion?.salida ?? "",
    motivo: sesion?.motivo ?? null,
    iniciada: sesion?.iniciada ?? null,
  };
}

export async function iniciarLoginCodex(): Promise<LoginCodex> {
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
  if (await sesionCodexConectada(true)) {
    if (sesion) {
      sesion.estado = "conectado";
      sesion.motivo = null;
    }
    return estadoLoginCodex();
  }
  return estadoLoginCodex();
}

export async function cancelarLoginCodex(): Promise<LoginCodex> {
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
    const { url, codigo, salida } = interpretarSalidaLoginCodex(acumulado);
    actual.salida = salida;
    actual.url = url ?? actual.url;
    actual.codigo = codigo ?? actual.codigo;
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
    // El intento debe terminar bien y el CLI debe confirmar su estado de autenticación.
    if (codigoSalida === 0 && await sesionCodexConectada(true)) {
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
