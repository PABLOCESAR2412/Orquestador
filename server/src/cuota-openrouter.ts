import { valorClaveProveedor } from "./claves-proveedor";

export type CuotaOpenRouter = {
  estado: "consultado" | "sin_clave" | "clave_invalida" | "rate_limit" | "no_disponible";
  mensaje: string;
  usoUsd: number | null;
  limiteUsd: number | null;
  restanteUsd: number | null;
  reinicio: string | null;
  esGratis: boolean | null;
  solicitudesGratis: { limite: number; usadas: number; restantes: number } | null;
  comprobadoEn: string;
};

type Numero = number | null;
type DatosClave = {
  limit?: unknown;
  limit_remaining?: unknown;
  usage?: unknown;
  limit_reset?: unknown;
  is_free_tier?: unknown;
  free_model_daily_requests?: { limit?: unknown; used?: unknown; remaining?: unknown };
};

const TTL_MS = 60_000;
let cache: { at: number; datos: CuotaOpenRouter } | null = null;

function numero(valor: unknown): Numero {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.max(0, valor) : null;
}

function resultado(estado: CuotaOpenRouter["estado"], mensaje: string): CuotaOpenRouter {
  return {
    estado, mensaje, usoUsd: null, limiteUsd: null, restanteUsd: null,
    reinicio: null, esGratis: null, solicitudesGratis: null,
    comprobadoEn: new Date().toISOString(),
  };
}

export async function obtenerCuotaOpenRouter(
  forzar = false,
  obtenerClave: () => string | null = () => valorClaveProveedor("openrouter"),
): Promise<CuotaOpenRouter> {
  if (!forzar && cache && Date.now() - cache.at < TTL_MS) return cache.datos;

  const clave = obtenerClave();
  let datos: CuotaOpenRouter;
  if (!clave) {
    datos = resultado("sin_clave", "No hay una clave de OpenRouter configurada.");
  } else {
    try {
      const respuesta = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${clave}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (respuesta.status === 401 || respuesta.status === 403) {
        datos = resultado("clave_invalida", "OpenRouter rechazó la clave. Revísala en Ajustes.");
      } else if (respuesta.status === 429) {
        datos = resultado("rate_limit", "OpenRouter limitó temporalmente la consulta del saldo.");
      } else if (!respuesta.ok) {
        datos = resultado("no_disponible", `OpenRouter no pudo consultar los límites (HTTP ${respuesta.status}).`);
      } else {
        const cuerpo = await respuesta.json().catch(() => null) as { data?: DatosClave } | null;
        const cuenta = cuerpo?.data;
        if (!cuenta || typeof cuenta !== "object") {
          datos = resultado("no_disponible", "OpenRouter no devolvió los datos de la clave.");
        } else {
          const free = cuenta.free_model_daily_requests;
          const limite = numero(cuenta.limit);
          const uso = numero(cuenta.usage);
          datos = {
            estado: "consultado",
            mensaje: "Límites de la clave consultados directamente en OpenRouter.",
            usoUsd: uso,
            limiteUsd: limite,
            restanteUsd: numero(cuenta.limit_remaining),
            reinicio: typeof cuenta.limit_reset === "string" ? cuenta.limit_reset.slice(0, 40) : null,
            esGratis: typeof cuenta.is_free_tier === "boolean" ? cuenta.is_free_tier : null,
            solicitudesGratis: free ? {
              limite: numero(free.limit) ?? 0,
              usadas: numero(free.used) ?? 0,
              restantes: numero(free.remaining) ?? 0,
            } : null,
            comprobadoEn: new Date().toISOString(),
          };
        }
      }
    } catch {
      datos = resultado("no_disponible", "No se pudo conectar con OpenRouter para consultar el saldo y las solicitudes gratis.");
    }
  }

  cache = { at: Date.now(), datos };
  return datos;
}
