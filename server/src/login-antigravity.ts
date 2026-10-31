import { stripVTControlCharacters } from "node:util";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { carpetaHome } from "./hogar";
import { hallarEjecutable, matarGrupo } from "./ejecutable";
import { registrarTrabajo } from "./despliegue";

const TIEMPO_MAXIMO_MS = 8 * 60_000;
const LONGITUD_SALIDA = 16_000;

export type LoginAntigravity = {
  estado: "inactivo" | "esperando" | "verificando" | "conectado" | "fallido";
  instalada: boolean;
  conectada: boolean;
  url: string | null;
  motivo: string | null;
  iniciada: string | null;
};

type Sesion = LoginAntigravity & {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null;
  cancelada: boolean;
  codigoEnviado: boolean;
  cuentaDetectada: boolean;
  codigoTemporal: string | null;
  cerrando: boolean;
  directorioTemporal: string;
  salidaInterna: string;
};

export class LoginAntigravityError extends Error {
  constructor(readonly code: string, readonly status: 400 | 409 | 503) {
    super(code);
  }
}

let sesion: Sesion | null = null;

function publica(actual = sesion): LoginAntigravity {
  const instalada = existsSync(join(carpetaHome(), ".local", "bin", "agy"));
  return {
    estado: actual?.estado ?? "inactivo",
    instalada,
    conectada: actual?.conectada ?? false,
    url: actual?.url ?? null,
    motivo: actual?.motivo ?? null,
    iniciada: actual?.iniciada ?? null,
  };
}

export function estadoLoginAntigravity(): LoginAntigravity {
  return publica();
}

function entornoRemoto(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: carpetaHome(),
    LC_ALL: "C.UTF-8",
    TERM: "xterm-256color",
    // Antigravity muestra su autorización remota al detectar una sesión SSH.
    // `script` proporciona el PTY real para que el código se pueda devolver al prompt.
    SSH_CLIENT: "127.0.0.1 0 22",
    SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 22",
    SSH_TTY: "/dev/tty",
  };
}

function citarShell(texto: string): string {
  return `'${texto.replace(/'/g, "'\\''")}'`;
}

function extraerUrl(texto: string): string | null {
  const crudo = /https:\/\/[^\s"'<>\])]+/.exec(stripVTControlCharacters(texto))?.[0];
  if (!crudo) return null;
  try {
    const url = new URL(crudo.replace(/[.,;]+$/, ""));
    return url.protocol === "https:" && url.hostname === "accounts.google.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function iniciarLoginAntigravity(): LoginAntigravity {
  if (sesion?.estado === "esperando" || sesion?.estado === "verificando") {
    throw new LoginAntigravityError("login_en_curso", 409);
  }
  const agy = join(carpetaHome(), ".local", "bin", "agy");
  if (!existsSync(agy)) throw new LoginAntigravityError("antigravity_no_instalado", 503);
  const script = hallarEjecutable("script");
  if (!script) throw new LoginAntigravityError("antigravity_terminal_no_disponible", 503);

  let directorioTemporal: string;
  try {
    directorioTemporal = mkdtempSync(join(tmpdir(), "telo-agy-login-"));
  } catch {
    throw new LoginAntigravityError("antigravity_inicio_fallido", 503);
  }
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["setsid", script, "-q", "-e", "-c", `exec ${citarShell(agy)}`, "/dev/null"], {
      cwd: directorioTemporal,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: entornoRemoto(),
    });
  } catch {
    limpiarDirectorioTemporal(directorioTemporal);
    throw new LoginAntigravityError("antigravity_inicio_fallido", 503);
  }

  const actual: Sesion = {
    estado: "esperando",
    instalada: true,
    conectada: false,
    url: null,
    motivo: null,
    iniciada: new Date().toISOString(),
    proc: proc as Bun.Subprocess<"pipe", "pipe", "pipe">,
    cancelada: false,
    codigoEnviado: false,
    cuentaDetectada: false,
    codigoTemporal: null,
    cerrando: false,
    directorioTemporal,
    salidaInterna: "",
  };
  sesion = actual;
  const finalizar = registrarTrabajo();
  void seguir(actual, proc).catch(() => {
    actual.estado = "fallido";
    actual.motivo = "antigravity_login_no_confirmado";
  }).finally(finalizar);
  return publica(actual);
}

export async function enviarCodigoAntigravity(valor: unknown): Promise<LoginAntigravity> {
  const codigo = typeof valor === "string" ? valor.trim() : "";
  if (!/^[a-z0-9-]{4,128}$/i.test(codigo)) throw new LoginAntigravityError("antigravity_codigo_invalido", 400);
  const actual = sesion;
  const proc = actual?.proc;
  if (!actual || actual.estado !== "esperando" || !actual.url || !proc) {
    throw new LoginAntigravityError("antigravity_login_no_espera_codigo", 409);
  }

  actual.codigoEnviado = true;
  actual.codigoTemporal = codigo;
  actual.estado = "verificando";
  actual.salidaInterna = "";
  try {
    proc.stdin.write(`${codigo}\r`);
    await proc.stdin.flush();
  } catch {
    actual.estado = "fallido";
    actual.motivo = "antigravity_login_no_confirmado";
    matarGrupo(proc);
  }
  return publica(actual);
}

export function cancelarLoginAntigravity(): LoginAntigravity {
  if (sesion?.proc && (sesion.estado === "esperando" || sesion.estado === "verificando")) {
    sesion.cancelada = true;
    matarGrupo(sesion.proc);
  }
  return publica();
}

async function leerSalida(flujo: ReadableStream<Uint8Array>, actual: Sesion): Promise<void> {
  const lector = flujo.getReader();
  const decodificador = new TextDecoder();
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    let texto = stripVTControlCharacters(decodificador.decode(value, { stream: true }));
    if (actual.codigoTemporal) texto = texto.replaceAll(actual.codigoTemporal, "[código oculto]");
    actual.salidaInterna = (actual.salidaInterna + texto).slice(-LONGITUD_SALIDA);
    if (!actual.url) actual.url = extraerUrl(actual.salidaInterna);
    const sinUrls = actual.salidaInterna.replace(/https?:\/\/[^\s]+/g, " ");
    if (/\b[^\s@]{1,64}@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(sinUrls)) {
      actual.cuentaDetectada = true;
      const proceso = actual.proc;
      if (proceso && (actual.estado === "esperando" || (actual.estado === "verificando" && actual.codigoEnviado))) {
        actual.estado = "verificando";
        cerrarTui(actual, proceso);
      }
    }
  }
}

function cerrarTui(actual: Sesion, proc: Bun.Subprocess<"pipe", "pipe", "pipe">): void {
  if (actual.cerrando || actual.proc !== proc || actual.estado !== "verificando") return;
  actual.cerrando = true;
  try {
    proc.stdin.write("/exit\r");
    void proc.stdin.flush();
  } catch { /* El CLI ya terminó. */ }
}

function limpiarDirectorioTemporal(ruta: string): void {
  const raiz = resolve(tmpdir()) + sep;
  const objetivo = resolve(ruta);
  if (!objetivo.startsWith(raiz) || !basename(objetivo).startsWith("telo-agy-login-")) return;
  try { rmSync(objetivo, { recursive: true, force: true }); } catch { /* El SO retirará la carpeta temporal. */ }
}

async function seguir(actual: Sesion, proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
  let agotado = false;
  let sinEnlace = false;
  const relojUrl = setTimeout(() => {
    if (!actual.url && !actual.cuentaDetectada && actual.estado === "esperando") {
      sinEnlace = true;
      matarGrupo(proc);
    }
  }, 45_000);
  const reloj = setTimeout(() => {
    agotado = true;
    matarGrupo(proc);
  }, TIEMPO_MAXIMO_MS);
  try {
    const lecturas = Promise.all([leerSalida(proc.stdout, actual), leerSalida(proc.stderr, actual)]);
    const codigoSalida = await proc.exited;
    await Promise.race([lecturas, Bun.sleep(1_000)]);
    if (actual.cancelada) {
      actual.estado = "fallido";
      actual.motivo = "cancelado";
    } else if (agotado) {
      actual.estado = "fallido";
      actual.motivo = "tiempo_agotado";
    } else if (sinEnlace) {
      actual.estado = "fallido";
      actual.motivo = "antigravity_login_sin_enlace";
    } else if ((actual.codigoEnviado || actual.cuentaDetectada) && codigoSalida === 0 && actual.cuentaDetectada) {
      actual.estado = "conectado";
      actual.conectada = true;
      actual.motivo = null;
    } else {
      actual.estado = "fallido";
      actual.motivo = "antigravity_login_no_confirmado";
    }
  } finally {
    clearTimeout(relojUrl);
    clearTimeout(reloj);
    actual.proc = null;
    actual.url = null;
    actual.codigoTemporal = null;
    actual.salidaInterna = "";
    limpiarDirectorioTemporal(actual.directorioTemporal);
  }
}
