import { Hono } from "hono";
import { db } from "../db";
import { valorClaveProveedor } from "../claves-proveedor";

// Uso que Telo registró por proveedor y comprobación en vivo de la API de Google Gemini.

type Agregado = {
  costoUsd: number;
  costoEstimadoUsd: number;
  costesEstimados: number;
  costesNoDisponibles: number;
  costesDesconocidos: number;
  tokens: number;
  tokensMedidos: number;
  tokensEstimados: number;
  tokensNoDisponibles: number;
  tokensDesconocidos: number;
  llamadasSinTokens: number;
  llamadas: number;
};

const NOMBRES_PROVEEDOR: Record<string, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  google: "Google (Gemini)",
  openrouter: "OpenRouter",
  groq: "Groq",
  nvidia: "NVIDIA",
  openai: "OpenAI",
};

function nombreProveedor(id: string): string {
  return NOMBRES_PROVEEDOR[id] ?? id;
}

export type GoogleLiveMetrics = {
  conectado: boolean;
  estado: "activo" | "sin_clave" | "clave_invalida" | "rate_limit" | "desconectado";
  mensaje: string;
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
  let mensaje = "No hay clave de Google Gemini configurada en Ajustes.";

  if (claveGoogle) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": claveGoogle },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        conectado = true;
        estado = "activo";
        mensaje = "Clave válida: Telo pudo consultar el catálogo de modelos. Google no expone aquí la cuota ni el saldo.";
      } else if (res.status === 429) {
        conectado = false;
        estado = "rate_limit";
        mensaje = "Google respondió con límite temporal (429). Esta comprobación no determina tu cuota ni su reinicio.";
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        conectado = false;
        estado = "clave_invalida";
        mensaje = "Google rechazó la clave o la configuración de la API. Revisa que la clave corresponda al proyecto y que Gemini API esté habilitada.";
      } else {
        conectado = false;
        estado = "desconectado";
        mensaje = `Google no pudo comprobarse (HTTP ${res.status}).`;
      }
    } catch {
      conectado = false;
      estado = "desconectado";
      mensaje = "No se pudo conectar con Google para validar la clave. Revisa la red e inténtalo de nuevo.";
    }
  }

  const data: GoogleLiveMetrics = {
    conectado,
    estado,
    mensaje,
    ultimaComprobacion: new Date().toISOString(),
  };

  cacheGoogleLive = { at: ahora, data };
  return data;
}

function agregado(provider: string, ventana: string): Agregado {
  const row = db
    .query<{
      costo: number;
      costoEstimado: number;
      costesEstimados: number;
      costesNoDisponibles: number;
      costesDesconocidos: number;
      tokens: number;
      tokensMedidos: number;
      tokensEstimados: number;
      tokensNoDisponibles: number;
      tokensDesconocidos: number;
      llamadasSinTokens: number;
      llamadas: number;
    }, [string, string, string]>(
      `SELECT COALESCE(SUM(cost), 0) AS costo,
              COALESCE(SUM(CASE WHEN cost_precision = 'estimado' THEN cost ELSE 0 END), 0) AS costoEstimado,
              COALESCE(SUM(cost_precision = 'estimado'), 0) AS costesEstimados,
              COALESCE(SUM(cost_precision = 'no_disponible'), 0) AS costesNoDisponibles,
              COALESCE(SUM(cost_precision = 'desconocida'), 0) AS costesDesconocidos,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(CASE WHEN tokens_precision = 'medida' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokensMedidos,
              COALESCE(SUM(CASE WHEN tokens_precision = 'estimado' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokensEstimados,
              COALESCE(SUM(CASE WHEN tokens_precision = 'no_disponible' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokensNoDisponibles,
              COALESCE(SUM(CASE WHEN tokens_precision = 'desconocida' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokensDesconocidos,
              COALESCE(SUM(tokens_precision IN ('no_disponible', 'desconocida')), 0) AS llamadasSinTokens,
              COUNT(*) AS llamadas
         FROM usage
        WHERE (provider = ? OR (? = 'google' AND provider = 'opencode' AND (model LIKE '%gemini%' OR model LIKE '%argon%')))
          AND created_at >= datetime('now', ?)`,
    )
    .get(provider, provider, ventana);
  return {
    costoUsd: Math.round((row?.costo ?? 0) * 10_000) / 10_000,
    costoEstimadoUsd: Math.round((row?.costoEstimado ?? 0) * 10_000) / 10_000,
    costesEstimados: row?.costesEstimados ?? 0,
    costesNoDisponibles: row?.costesNoDisponibles ?? 0,
    costesDesconocidos: row?.costesDesconocidos ?? 0,
    tokens: row?.tokens ?? 0,
    tokensMedidos: row?.tokensMedidos ?? 0,
    tokensEstimados: row?.tokensEstimados ?? 0,
    tokensNoDisponibles: row?.tokensNoDisponibles ?? 0,
    tokensDesconocidos: row?.tokensDesconocidos ?? 0,
    llamadasSinTokens: row?.llamadasSinTokens ?? 0,
    llamadas: row?.llamadas ?? 0,
  };
}

// Proveedores con uso reciente, más OpenCode y Google para mostrar su estado aunque no haya uso.
function proveedoresActivos(): string[] {
  const usados = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM usage WHERE created_at >= datetime('now', '-30 days')")
    .all()
    .map((r) => r.provider);
  return [...new Set([...usados, "opencode", "google"])].sort();
}

export const uso = new Hono();

// GET /api/uso
uso.get("/uso", async (c) => {
  const googleLive = await obtenerMetricasGoogleLive();

  const proveedores = proveedoresActivos().map((id) => {
    const enUltimos30d = db
      .query<{ n: number }, [string, string]>(
        `SELECT COUNT(*) AS n FROM usage
          WHERE (provider = ? OR (? = 'google' AND provider = 'opencode' AND (model LIKE '%gemini%' OR model LIKE '%argon%')))
            AND created_at >= datetime('now', '-30 days')`,
      )
      .get(id, id)!.n;
    return {
      id,
      nombre: nombreProveedor(id),
      ultimas5h: agregado(id, "-5 hours"),
      ultimos7d: agregado(id, "-7 days"),
      mesActual: agregado(id, "start of month"),
      precision: enUltimos30d > 0 ? ("registro_telo" as const) : ("sin_datos" as const),
      ...(id === "google" ? { googleLive } : {}),
    };
  });

  return c.json({ generado: new Date().toISOString(), proveedores, googleLive });
});
