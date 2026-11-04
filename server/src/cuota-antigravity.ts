import { redactar } from "./redaccion";
import { hallarEjecutable } from "./ejecutable";
import { carpetaHome } from "./hogar";
import { entornoSecretServiceAntigravity } from "./runtime-antigravity";

export type CuotaAntigravity = {
  estado: "activo" | "sin_cli" | "sin_sesion" | "no_disponible";
  respuesta: string | null;
  plan: string | null;
  grupos: { nombre: string; ventanas: { id: string; nombre: string; restantePorcentaje: number | null; restante: number | null; unidad: string | null; reiniciaEn: string | null }[] }[];
  detalle: string | null;
  comprobadoEn: string;
};

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : undefined;
}

function texto(...valores: unknown[]): string | null {
  return valores.find((valor): valor is string => typeof valor === "string" && valor.trim().length > 0)?.trim().slice(0, 120) ?? null;
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function extraerGrupos(datos: Record<string, unknown> | undefined): CuotaAntigravity["grupos"] {
  if (!Array.isArray(datos?.groups)) return [];
  return datos.groups.flatMap((entrada, indice) => {
    const grupo = objeto(entrada);
    if (!Array.isArray(grupo?.buckets)) return [];
    const ventanas = grupo.buckets.flatMap((entrada, indice) => {
      const ventana = objeto(entrada);
      if (!ventana || ventana.disabled === true || ventana.is_disabled === true || ventana.isDisabled === true) return [];
      const restanteInfo = objeto(ventana.remaining);
      const fraccion = numero(ventana.remaining_fraction ?? ventana.remainingFraction ?? restanteInfo?.remaining_fraction ?? restanteInfo?.remainingFraction);
      const restantePorcentaje = fraccion !== null && fraccion <= 1 ? fraccion * 100 : null;
      const restante = numero(ventana.remaining_amount ?? ventana.remainingAmount ?? restanteInfo?.remaining_amount ?? restanteInfo?.remainingAmount);
      if (restantePorcentaje === null && restante === null) return [];
      const periodo = texto(ventana.window, ventana.window_name, ventana.windowName);
      const etiqueta = texto(ventana.display_name, ventana.displayName, ventana.name);
      const semanal = periodo === "weekly" || etiqueta?.toLowerCase() === "weekly limit remaining";
      const sesion = periodo === "5h" || etiqueta?.toLowerCase() === "five hour limit remaining";
      const id = texto(ventana.id, ventana.bucket_id, ventana.bucketId) ?? String(indice);
      return [{
        id,
        nombre: semanal ? "Semanal · 7 d" : sesion ? "Sesión · 5 h" : etiqueta ?? periodo ?? "Cuota",
        restantePorcentaje,
        restante,
        unidad: texto(ventana.unit, restanteInfo?.unit),
        reiniciaEn: texto(ventana.reset_time, ventana.resetTime, restanteInfo?.reset_time, restanteInfo?.resetTime),
      }];
    });
    if (!ventanas.length) return [];
    return [{ nombre: texto(grupo.name, grupo.display_name, grupo.displayName) ?? `Grupo ${indice + 1}`, ventanas }];
  });
}

const TTL_MS = 60_000;
const TIEMPO_MAXIMO_MS = 20_000;
let cache: { hasta: number; cuota: CuotaAntigravity } | null = null;
let consulta: Promise<CuotaAntigravity> | null = null;

export function interpretarUsoAntigravity(stdout: string, stderr: string, codigo: number, ahora = Date.now()): CuotaAntigravity {
  const salida = redactar(stdout).trim();
  const diagnostico = redactar(stderr).trim();
  let json: Record<string, unknown> | undefined;
  try { json = objeto(JSON.parse(salida)); } catch { /* Algunas versiones solo imprimen texto. */ }

  const datos = objeto(objeto(json?.command)?.data) ?? objeto(json?.response) ?? objeto(json?.data) ?? json;
  const grupos = extraerGrupos(datos);
  const respuesta = typeof json?.response === "string" ? json.response.trim() : salida;
  const error = typeof json?.error === "string" ? json.error.trim() : "";
  const textoError = `${error}\n${diagnostico}\n${respuesta}`;
  const estado: CuotaAntigravity["estado"] = codigo === 0 && (!json?.status || json.status === "SUCCESS") && Boolean(respuesta || grupos.length)
    ? "activo"
    : /authentication required|sign[ -]?in required|no cached credentials|credential.*not found|keyring|secret service/i.test(textoError)
      ? "sin_sesion"
      : "no_disponible";

  return {
    estado,
    respuesta: estado === "activo" && !grupos.length && (!json || typeof json.response === "string") ? respuesta.slice(0, 8_000) : null,
    plan: estado === "activo" ? texto(datos?.plan_tier, datos?.planTier, datos?.plan, json?.plan_tier, json?.planTier, json?.plan) : null,
    grupos: estado === "activo" ? grupos : [],
    detalle: estado === "activo" ? null : (error || diagnostico || respuesta || "Antigravity no devolvió información de cuota.").slice(0, 1_000),
    comprobadoEn: new Date(ahora).toISOString(),
  };
}

function fallida(estado: CuotaAntigravity["estado"], detalle: string | null = null): CuotaAntigravity {
  return { estado, respuesta: null, plan: null, grupos: [], detalle, comprobadoEn: new Date().toISOString() };
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
