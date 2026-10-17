import { Hono } from "hono";
import { db } from "../db";
import { cuotaRestanteUsd, nombreProveedor } from "./cuotas";
import { valorClaveProveedor } from "../claves-proveedor";

// Uso que Telo registró por proveedor y comprobación en vivo de la API de Google Gemini.

type Agregado = { costoUsd: number; tokens: number; llamadas: number };

export type GoogleLiveMetrics = {
  conectado: boolean;
  estado: "activo" | "agotado" | "sin_clave" | "clave_invalida" | "desconectado";
  mensaje: string;
  limiteRpd: number;
  llamadasHoy: number;
  restantesRpd: number;
  porcentajeRestante: number;
  limiteRpm: number;
  tokensHoy: number;
  costoHoyUsd: number;
  ultimaComprobacion: string;
};

let cacheGoogleLive: { at: number; data: GoogleLiveMetrics } | null = null;
const TTL_LIVE_MS = 60_000;

export async function obtenerMetricasGoogleLive(forzar = false): Promise<GoogleLiveMetrics> {
  const ahora = Date.now();
  if (!forzar && cacheGoogleLive && ahora - cacheGoogleLive.at < TTL_LIVE_MS) {
    return cacheGoogleLive.data;
  }

  const claveGoogle = valorClaveProveedor("google");
  let conectado = false;
  let estado: GoogleLiveMetrics["estado"] = "sin_clave";
  let mensaje = "No hay clave de Google Gemini configurada en Ajustes";

  if (claveGoogle) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(claveGoogle)}`, {
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        conectado = true;
        estado = "activo";
        mensaje = "Conectado a Google AI Studio (API en vivo activa)";
      } else if (res.status === 429) {
        conectado = false;
        estado = "agotado";
        mensaje = "Límite de cuota o rate-limit alcanzado en Google AI Studio (429)";
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        conectado = false;
        estado = "clave_invalida";
        mensaje = "Clave de Google Gemini no válida o sin permisos (HTTP " + res.status + ")";
      } else {
        conectado = false;
        estado = "desconectado";
        mensaje = "Respuesta inusual de Google AI Studio (HTTP " + res.status + ")";
      }
    } catch (err: unknown) {
      conectado = false;
      estado = "desconectado";
      const errTexto = err instanceof Error ? err.message : String(err);
      mensaje = "Sin conexión con la API de Google: " + errTexto;
    }
  }

  // Agregado de las últimas 24 horas para Google Gemini en Telo
  const row = db
    .query<{ llamadas: number; tokens: number; costo: number }, []>(
      `SELECT COUNT(*) AS llamadas,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS costo
         FROM usage
        WHERE provider = 'google'
          AND created_at >= datetime('now', '-24 hours')`,
    )
    .get();

  const limiteRpd = 1500;
  const llamadasHoy = row?.llamadas ?? 0;
  const tokensHoy = row?.tokens ?? 0;
  const costoHoyUsd = Math.round((row?.costo ?? 0) * 10_000) / 10_000;
  const restantesRpd = Math.max(0, limiteRpd - llamadasHoy);
  const porcentajeRestante = Math.round((restantesRpd / limiteRpd) * 100);

  if (estado === "activo" && restantesRpd === 0) {
    estado = "agotado";
    mensaje = "Cuota diaria estimada de 1,500 peticiones alcanzada";
  }

  const data: GoogleLiveMetrics = {
    conectado,
    estado,
    mensaje,
    limiteRpd,
    llamadasHoy,
    restantesRpd,
    porcentajeRestante,
    limiteRpm: 15,
    tokensHoy,
    costoHoyUsd,
    ultimaComprobacion: new Date().toISOString(),
  };

  cacheGoogleLive = { at: ahora, data };
  return data;
}

function agregado(provider: string, ventana: string): Agregado {
  const row = db
    .query<{ costo: number; tokens: number; llamadas: number }, [string, string]>(
      `SELECT COALESCE(SUM(cost), 0) AS costo,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COUNT(*) AS llamadas
         FROM usage WHERE provider = ? AND created_at >= datetime('now', ?)`,
    )
    .get(provider, ventana);
  return {
    costoUsd: Math.round((row?.costo ?? 0) * 10_000) / 10_000,
    tokens: row?.tokens ?? 0,
    llamadas: row?.llamadas ?? 0,
  };
}

// Proveedores: los que tienen uso en 30 días, los que tienen cuentas anotadas, OpenCode y Google.
function proveedoresActivos(): string[] {
  const usados = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM usage WHERE created_at >= datetime('now', '-30 days')")
    .all()
    .map((r) => r.provider);
  const conCuentas = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM quota_accounts")
    .all()
    .map((r) => r.provider);
  return [...new Set([...usados, ...conCuentas, "opencode", "google"])].sort();
}

export const uso = new Hono();

// GET /api/uso
uso.get("/uso", async (c) => {
  const googleLive = await obtenerMetricasGoogleLive();

  const proveedores = proveedoresActivos().map((id) => {
    const enUltimos30d = db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM usage WHERE provider = ? AND created_at >= datetime('now', '-30 days')",
      )
      .get(id)!.n;
    return {
      id,
      nombre: nombreProveedor(id),
      ultimas5h: agregado(id, "-5 hours"),
      ultimos7d: agregado(id, "-7 days"),
      cuotaRestanteUsd: cuotaRestanteUsd(id),
      precision: enUltimos30d > 0 ? ("medida_telo" as const) : ("sin_datos" as const),
      ...(id === "google" ? { googleLive } : {}),
    };
  });

  return c.json({ generado: new Date().toISOString(), proveedores, googleLive });
});
