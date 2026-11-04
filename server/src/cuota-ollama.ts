import { createHash } from "node:crypto";
import { valorClaveApiProveedor } from "./claves-proveedor";

type VentanaOllama = { nombre: string; restantePorcentaje: number; reiniciaEn: string | null };

export type BalanceOllama = {
  estado: "activo" | "sin_clave" | "clave_invalida" | "rate_limit" | "no_disponible";
  incluidos: { restanteUsd: number; limiteUsd: number | null; reiniciaEn: string | null } | null;
  compradosUsd: number | null;
  ventanas: VentanaOllama[];
  comprobadoEn: string;
};

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function fecha(valor: unknown): string | null {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor)) ? new Date(valor).toISOString() : null;
}

function resultado(estado: BalanceOllama["estado"]): BalanceOllama {
  return { estado, incluidos: null, compradosUsd: null, ventanas: [], comprobadoEn: new Date().toISOString() };
}

export async function consultarBalanceOllama(clave: string, solicitar: typeof fetch = fetch): Promise<BalanceOllama> {
  try {
    const respuesta = await solicitar("https://ollama.com/api/balance", {
      headers: { Accept: "application/json", Authorization: `Bearer ${clave}` },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (respuesta.status === 401 || respuesta.status === 403) return resultado("clave_invalida");
    if (respuesta.status === 429) return resultado("rate_limit");
    if (!respuesta.ok) return resultado("no_disponible");
    const datos = await respuesta.json() as {
      included?: {
        balance_usd?: unknown;
        allowance_usd?: unknown;
        period?: { until?: unknown };
        session?: { remaining_percent?: unknown; resets_at?: unknown };
        weekly?: { remaining_percent?: unknown; resets_at?: unknown };
      };
      purchased?: { balance_usd?: unknown };
    } | null;
    const restantes = numero(datos?.included?.balance_usd);
    const compradosUsd = numero(datos?.purchased?.balance_usd);
    const ventanas = ([
      ["Sesión", datos?.included?.session],
      ["Semanal", datos?.included?.weekly],
    ] as const).flatMap(([nombre, ventana]) => {
      const restantePorcentaje = numero(ventana?.remaining_percent);
      return restantePorcentaje !== null && restantePorcentaje <= 100
        ? [{ nombre, restantePorcentaje, reiniciaEn: fecha(ventana?.resets_at) }]
        : [];
    });
    const incluidos = restantes === null ? null : {
      restanteUsd: restantes,
      limiteUsd: numero(datos?.included?.allowance_usd),
      reiniciaEn: fecha(datos?.included?.period?.until),
    };
    if (!incluidos && compradosUsd === null && !ventanas.length) return resultado("no_disponible");
    return { ...resultado("activo"), incluidos, compradosUsd, ventanas };
  } catch {
    return resultado("no_disponible");
  }
}

let cache: { claveId: string; hasta: number; consulta: Promise<BalanceOllama> } | null = null;

export async function obtenerBalanceOllama(): Promise<BalanceOllama> {
  const clave = valorClaveApiProveedor("ollama");
  if (!clave) {
    cache = null;
    return resultado("sin_clave");
  }
  const claveId = createHash("sha256").update(clave).digest("hex");
  if (cache?.claveId === claveId && Date.now() < cache.hasta) return cache.consulta;
  cache = { claveId, hasta: Date.now() + 60_000, consulta: consultarBalanceOllama(clave) };
  return cache.consulta;
}
