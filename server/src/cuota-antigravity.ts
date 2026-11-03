import { redactar } from "./redaccion";
import { hallarEjecutable } from "./ejecutable";
import { carpetaHome } from "./hogar";
import { entornoSecretServiceAntigravity } from "./runtime-antigravity";

export type CuotaAntigravity = {
  estado: "activo" | "sin_cli" | "sin_sesion" | "no_disponible";
  respuesta: string | null;
  detalle: string | null;
  comprobadoEn: string;
};
type RespuestaHeadless = { status?: unknown; response?: unknown; error?: unknown };

const TTL_MS = 60_000;
const TIEMPO_MAXIMO_MS = 20_000;
let cache: { hasta: number; cuota: CuotaAntigravity } | null = null;
let consulta: Promise<CuotaAntigravity> | null = null;

export function interpretarUsoAntigravity(stdout: string, stderr: string, codigo: number, ahora = Date.now()): CuotaAntigravity {
  const salida = redactar(stdout).trim();
  const diagnostico = redactar(stderr).trim();
  let json: RespuestaHeadless | null = null;
  try { json = JSON.parse(salida) as RespuestaHeadless; } catch { /* Algunas versiones solo imprimen texto. */ }

  const respuesta = typeof json?.response === "string" ? json.response.trim() : salida;
  const error = typeof json?.error === "string" ? json.error.trim() : "";
  const textoError = `${error}\n${diagnostico}\n${respuesta}`;
  const estado: CuotaAntigravity["estado"] = codigo === 0 && (!json?.status || json.status === "SUCCESS") && Boolean(respuesta)
    ? "activo"
    : /authentication required|sign[ -]?in required|no cached credentials|credential.*not found|keyring|secret service/i.test(textoError)
      ? "sin_sesion"
      : "no_disponible";

  return {
    estado,
    respuesta: estado === "activo" ? respuesta.slice(0, 8_000) : null,
    detalle: estado === "activo" ? null : (error || diagnostico || respuesta || "Antigravity no devolvió información de cuota.").slice(0, 1_000),
    comprobadoEn: new Date(ahora).toISOString(),
  };
}

function fallida(estado: CuotaAntigravity["estado"], detalle: string | null = null): CuotaAntigravity {
  return { estado, respuesta: null, detalle, comprobadoEn: new Date().toISOString() };
}

async function consultar(): Promise<CuotaAntigravity> {
  const agy = hallarEjecutable("agy");
  if (!agy) return fallida("sin_cli");

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const proceso = Bun.spawn([agy, "-p", "/usage", "--output-format", "json"], {
      cwd: carpetaHome(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: carpetaHome(),
        ...entornoSecretServiceAntigravity(),
      },
    });
    proc = proceso;
    const resultado = await Promise.race([
      Promise.all([
        new Response(proceso.stdout).text(),
        new Response(proceso.stderr).text(),
        proceso.exited,
      ]),
      new Promise<never>((_, rechazar) => {
        timeout = setTimeout(() => {
          try { proc?.kill(); } catch { /* La CLI ya terminó. */ }
          rechazar(new Error("Antigravity no respondió a la consulta de cuota."));
        }, TIEMPO_MAXIMO_MS);
      }),
    ]);
    return interpretarUsoAntigravity(resultado[0], resultado[1], resultado[2]);
  } catch (error) {
    return fallida("no_disponible", error instanceof Error ? redactar(error.message) : "No se pudo consultar Antigravity.");
  } finally {
    if (timeout) clearTimeout(timeout);
    try { proc?.kill(); } catch { /* La CLI ya terminó. */ }
  }
}

export async function obtenerCuotaAntigravity(forzar = false): Promise<CuotaAntigravity> {
  if (!forzar && cache && Date.now() < cache.hasta) return cache.cuota;
  if (!consulta) consulta = consultar().finally(() => { consulta = null; });
  const cuota = await consulta;
  cache = { hasta: Date.now() + TTL_MS, cuota };
  return cuota;
}
