import { Hono } from "hono";
import { db } from "../db";
import { valorClaveProveedor } from "../claves-proveedor";
import { obtenerCuotaOpenCode } from "../cuota-opencode";
import { obtenerCuotaOpenRouter } from "../cuota-openrouter";

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

type RechazoModelo = {
  categoria: "cuota" | "limite_temporal" | "acceso" | "modelo";
  estadoHttp: number | null;
  fecha: string;
};

type UsoModelo = {
  modelo: string;
  ejecucionesDesdeReinicioDiario: number;
  tokensDesdeReinicioDiario: number;
  tokensMedidosDesdeReinicioDiario: number;
  tokensEstimadosDesdeReinicioDiario: number;
  ejecucionesUltimas24h: number;
  tokensUltimas24h: number;
  tokensMedidosUltimas24h: number;
  tokensEstimadosUltimas24h: number;
  ejecucionesUltimoMinuto: number;
  tokensUltimoMinuto: number;
  ejecucionesUltimos30d: number;
  ultimoRechazo: RechazoModelo | null;
};

const NOMBRES_PROVEEDOR: Record<string, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  antigravity: "Antigravity CLI",
  google: "Google (Gemini)",
  openrouter: "OpenRouter",
  commandcode: "Command Code Go",
  groq: "Groq",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  xai: "xAI (Grok)",
  deepseek: "DeepSeek",
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

export type LimitesOpenAI = {
  estado: "consultado" | "sin_configurar" | "sin_permisos" | "no_disponible";
  mensaje: string;
  limites: { modelo: string; rpm: number | null; tpm: number | null; rpd: number | null }[];
  ultimaComprobacion: string;
};

export type UsoOpenAIAdmin = {
  estado: "consultado" | "sin_configurar" | "sin_permisos" | "no_disponible";
  mensaje: string;
  desde: string;
  costoUsd30d: number | null;
  tokensEntrada30d: number;
  tokensSalida30d: number;
  solicitudes30d: number;
  porModelo: { modelo: string; solicitudes: number; tokensEntrada: number; tokensSalida: number }[];
  ultimaComprobacion: string;
};

export type LimitesOpenCode = Awaited<ReturnType<typeof obtenerCuotaOpenCode>>;
export type LimitesOpenRouter = Awaited<ReturnType<typeof obtenerCuotaOpenRouter>>;

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

let cacheOpenAILimits: { at: number; data: LimitesOpenAI } | null = null;
const TTL_OPENAI_MS = 5 * 60_000;
let cacheUsoOpenAI: { at: number; data: UsoOpenAIAdmin } | null = null;

function usoOpenAIResultado(
  estado: UsoOpenAIAdmin["estado"],
  mensaje: string,
  desde = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
): UsoOpenAIAdmin {
  return {
    estado, mensaje, desde, costoUsd30d: null, tokensEntrada30d: 0, tokensSalida30d: 0,
    solicitudes30d: 0, porModelo: [], ultimaComprobacion: new Date().toISOString(),
  };
}

export async function obtenerUsoOpenAIAdmin(
  forzar = false,
  credencial: () => string | null = () => process.env.TELO_OPENAI_ADMIN_API_KEY?.trim() || null,
): Promise<UsoOpenAIAdmin> {
  const ahora = Date.now();
  if (!forzar && cacheUsoOpenAI && ahora - cacheUsoOpenAI.at < TTL_OPENAI_MS) return cacheUsoOpenAI.data;

  const adminKey = credencial();
  const inicio = Math.floor((ahora - 30 * 24 * 60 * 60_000) / 1000);
  const fin = Math.floor(ahora / 1000);
  if (!adminKey) {
    const data = usoOpenAIResultado("sin_configurar", "Para consultar el consumo total de OpenAI hace falta una Admin API key.", new Date(inicio * 1000).toISOString());
    cacheUsoOpenAI = { at: ahora, data };
    return data;
  }

  const parametros = new URLSearchParams({ start_time: String(inicio), end_time: String(fin), bucket_width: "1d", limit: "31" });
  const usoParams = new URLSearchParams(parametros);
  usoParams.set("group_by", "model");
  const opciones = { headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) };
  let data: UsoOpenAIAdmin;
  try {
    const [costos, uso] = await Promise.all([
      fetch(`https://api.openai.com/v1/organization/costs?${parametros}`, opciones),
      fetch(`https://api.openai.com/v1/organization/usage/completions?${usoParams}`, opciones),
    ]);
    if ([costos.status, uso.status].some((status) => status === 401 || status === 403)) {
      data = usoOpenAIResultado("sin_permisos", "OpenAI rechazó la consulta de consumo. Revisa la Admin API key y sus permisos.", new Date(inicio * 1000).toISOString());
    } else if (!costos.ok || !uso.ok) {
      const estado = !costos.ok ? costos.status : uso.status;
      data = usoOpenAIResultado("no_disponible", `OpenAI no pudo consultar el consumo de los últimos 30 días (HTTP ${estado}).`, new Date(inicio * 1000).toISOString());
    } else {
      const [costosJson, usoJson] = await Promise.all([
        costos.json().catch(() => null) as Promise<{ data?: { results?: { amount?: { value?: unknown; currency?: unknown } }[] }[] } | null>,
        uso.json().catch(() => null) as Promise<{ data?: { results?: { model?: unknown; input_tokens?: unknown; output_tokens?: unknown; num_model_requests?: unknown }[] }[] } | null>,
      ]);
      const cantidades = (costosJson?.data ?? []).flatMap((bucket) => bucket.results ?? []).map((fila) => fila.amount);
      const hayUsd = cantidades.some((amount) => amount?.currency === "usd" && typeof amount.value === "number" && Number.isFinite(amount.value));
      const costoUsd30d = hayUsd
        ? Math.round(cantidades.reduce((total, amount) => total + (amount?.currency === "usd" && typeof amount.value === "number" && Number.isFinite(amount.value) ? amount.value : 0), 0) * 10_000) / 10_000
        : null;
      const porModelo = new Map<string, { modelo: string; solicitudes: number; tokensEntrada: number; tokensSalida: number }>();
      for (const fila of (usoJson?.data ?? []).flatMap((bucket) => bucket.results ?? [])) {
        if (typeof fila.model !== "string") continue;
        const numero = (valor: unknown) => typeof valor === "number" && Number.isFinite(valor) ? Math.max(0, Math.floor(valor)) : 0;
        const actual = porModelo.get(fila.model) ?? { modelo: fila.model, solicitudes: 0, tokensEntrada: 0, tokensSalida: 0 };
        actual.solicitudes += numero(fila.num_model_requests);
        actual.tokensEntrada += numero(fila.input_tokens);
        actual.tokensSalida += numero(fila.output_tokens);
        porModelo.set(fila.model, actual);
      }
      const modelos = [...porModelo.values()].sort((a, b) => b.solicitudes - a.solicitudes || a.modelo.localeCompare(b.modelo));
      data = {
        ...usoOpenAIResultado("consultado", "Consumo oficial de toda la organización en los últimos 30 días, incluidos otros clientes.", new Date(inicio * 1000).toISOString()),
        costoUsd30d,
        solicitudes30d: modelos.reduce((total, fila) => total + fila.solicitudes, 0),
        tokensEntrada30d: modelos.reduce((total, fila) => total + fila.tokensEntrada, 0),
        tokensSalida30d: modelos.reduce((total, fila) => total + fila.tokensSalida, 0),
        porModelo: modelos,
      };
    }
  } catch {
    data = usoOpenAIResultado("no_disponible", "No se pudo conectar con OpenAI para consultar el consumo de la organización.", new Date(inicio * 1000).toISOString());
  }
  cacheUsoOpenAI = { at: ahora, data };
  return data;
}

function limitesOpenAIResultado(
  estado: LimitesOpenAI["estado"],
  mensaje: string,
  limites: LimitesOpenAI["limites"] = [],
): LimitesOpenAI {
  return { estado, mensaje, limites, ultimaComprobacion: new Date().toISOString() };
}

export async function obtenerLimitesOpenAI(forzar = false): Promise<LimitesOpenAI> {
  const ahora = Date.now();
  if (!forzar && cacheOpenAILimits && ahora - cacheOpenAILimits.at < TTL_OPENAI_MS) {
    return cacheOpenAILimits.data;
  }

  const adminKey = process.env.TELO_OPENAI_ADMIN_API_KEY?.trim();
  const projectId = process.env.TELO_OPENAI_PROJECT_ID?.trim();
  if (!adminKey || !projectId) {
    const data = limitesOpenAIResultado("sin_configurar", "Para consultar los topes por modelo hacen falta una Admin API key y el ID del proyecto.");
    cacheOpenAILimits = { at: ahora, data };
    return data;
  }

  let data: LimitesOpenAI;
  try {
    const respuesta = await fetch(`https://api.openai.com/v1/organization/projects/${encodeURIComponent(projectId)}/rate_limits?limit=100`, {
      headers: { Authorization: `Bearer ${adminKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (respuesta.status === 401 || respuesta.status === 403) {
      data = limitesOpenAIResultado("sin_permisos", "OpenAI rechazó la consulta administrativa. Comprueba la Admin API key y el acceso al proyecto.");
    } else if (!respuesta.ok) {
      data = limitesOpenAIResultado("no_disponible", `OpenAI no pudo consultar los límites (HTTP ${respuesta.status}).`);
    } else {
      const cuerpo = await respuesta.json().catch(() => null) as {
        data?: { model?: unknown; max_requests_per_1_minute?: unknown; max_tokens_per_1_minute?: unknown; max_requests_per_1_day?: unknown }[];
      } | null;
      const limites = (Array.isArray(cuerpo?.data) ? cuerpo.data : []).flatMap((fila) => {
        if (typeof fila.model !== "string") return [];
        const numero = (valor: unknown) => typeof valor === "number" && Number.isFinite(valor) ? valor : null;
        return [{
          modelo: fila.model,
          rpm: numero(fila.max_requests_per_1_minute),
          tpm: numero(fila.max_tokens_per_1_minute),
          rpd: numero(fila.max_requests_per_1_day),
        }];
      });
      data = limitesOpenAIResultado("consultado", "Topes configurados por proyecto y modelo. El uso de otros clientes no está incluido en los contadores de Telo.", limites);
    }
  } catch {
    data = limitesOpenAIResultado("no_disponible", "No se pudo conectar con OpenAI para consultar los límites administrativos.");
  }
  cacheOpenAILimits = { at: ahora, data };
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

function filtroProveedor(provider: string, tabla = "usage"): { sql: string; valores: string[] } {
  if (provider === "google") {
    return {
      sql: `(${tabla}.provider = 'google' OR (${tabla}.provider = 'opencode' AND (${tabla}.model LIKE '%gemini%' OR ${tabla}.model LIKE '%argon%')))`,
      valores: [],
    };
  }
  return { sql: `${tabla}.provider = ?`, valores: [provider] };
}

function inicioDiaEnZona(zona: string): string {
  const formato = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const partes = (fecha: Date) => {
    const valores = Object.fromEntries(formato.formatToParts(fecha).map(({ type, value }) => [type, Number(value)]));
    return [valores.year, valores.month, valores.day, valores.hour, valores.minute, valores.second] as const;
  };
  const [year, month, day] = partes(new Date());
  const medianocheComoUtc = Date.UTC(year, month - 1, day);
  let instante = medianocheComoUtc;
  for (let intento = 0; intento < 4; intento++) {
    const [y, m, d, h, min, s] = partes(new Date(instante));
    const representado = Date.UTC(y, m - 1, d, h, min, s);
    const siguiente = medianocheComoUtc - (representado - instante);
    if (siguiente === instante) break;
    instante = siguiente;
  }
  return new Date(instante).toISOString();
}

function usoPorModelo(provider: string): UsoModelo[] {
  const filtro = filtroProveedor(provider);
  // Gemini RPD reinicia a medianoche del Pacífico; los demás se presentan en UTC sin
  // asumir que su proveedor use el mismo corte diario.
  const inicioDiario = inicioDiaEnZona(provider === "google" ? "America/Los_Angeles" : "UTC");
  const filas = db.query<{
    modelo: string;
    ejecucionesDia: number;
    tokensDia: number;
    tokensMedidosDia: number;
    tokensEstimadosDia: number;
    ejecuciones24h: number;
    tokens24h: number;
    tokensMedidos24h: number;
    tokensEstimados24h: number;
    ejecuciones1m: number;
    tokens1m: number;
    ejecuciones30d: number;
  }, string[]>(
    `SELECT model AS modelo,
            SUM(created_at >= datetime(?)) AS ejecucionesDia,
            SUM(CASE WHEN created_at >= datetime(?) THEN input_tokens + output_tokens ELSE 0 END) AS tokensDia,
            SUM(CASE WHEN created_at >= datetime(?) AND tokens_precision = 'medida' THEN input_tokens + output_tokens ELSE 0 END) AS tokensMedidosDia,
            SUM(CASE WHEN created_at >= datetime(?) AND tokens_precision = 'estimado' THEN input_tokens + output_tokens ELSE 0 END) AS tokensEstimadosDia,
            SUM(created_at >= datetime('now', '-24 hours')) AS ejecuciones24h,
            SUM(CASE WHEN created_at >= datetime('now', '-24 hours') THEN input_tokens + output_tokens ELSE 0 END) AS tokens24h,
            SUM(CASE WHEN created_at >= datetime('now', '-24 hours') AND tokens_precision = 'medida' THEN input_tokens + output_tokens ELSE 0 END) AS tokensMedidos24h,
            SUM(CASE WHEN created_at >= datetime('now', '-24 hours') AND tokens_precision = 'estimado' THEN input_tokens + output_tokens ELSE 0 END) AS tokensEstimados24h,
            SUM(created_at >= datetime('now', '-1 minute')) AS ejecuciones1m,
            SUM(CASE WHEN created_at >= datetime('now', '-1 minute') THEN input_tokens + output_tokens ELSE 0 END) AS tokens1m,
            COUNT(*) AS ejecuciones30d
       FROM usage
      WHERE ${filtro.sql} AND created_at >= datetime('now', '-30 days')
      GROUP BY model
      ORDER BY ejecuciones24h DESC, ejecuciones30d DESC, model`,
  ).all(inicioDiario, inicioDiario, inicioDiario, inicioDiario, ...filtro.valores);

  const eventosFiltro = filtroProveedor(provider, "provider_limit_events");
  const eventos = db.query<{
    modelo: string;
    categoria: RechazoModelo["categoria"];
    estadoHttp: number | null;
    fecha: string;
  }, string[]>(
    `SELECT model AS modelo, category AS categoria, http_status AS estadoHttp, created_at AS fecha
       FROM provider_limit_events
      WHERE ${eventosFiltro.sql} AND created_at >= datetime('now', '-30 days')
      ORDER BY created_at DESC, id DESC`,
  ).all(...eventosFiltro.valores);
  const ultimoRechazoPorModelo = new Map<string, RechazoModelo>();
  for (const evento of eventos) {
    if (!ultimoRechazoPorModelo.has(evento.modelo)) {
      ultimoRechazoPorModelo.set(evento.modelo, {
        categoria: evento.categoria,
        estadoHttp: evento.estadoHttp,
        fecha: evento.fecha,
      });
    }
  }

  const porModelo = new Map<string, UsoModelo>(filas.map((fila) => [fila.modelo, {
    modelo: fila.modelo,
    ejecucionesDesdeReinicioDiario: fila.ejecucionesDia ?? 0,
    tokensDesdeReinicioDiario: fila.tokensDia ?? 0,
    tokensMedidosDesdeReinicioDiario: fila.tokensMedidosDia ?? 0,
    tokensEstimadosDesdeReinicioDiario: fila.tokensEstimadosDia ?? 0,
    ejecucionesUltimas24h: fila.ejecuciones24h ?? 0,
    tokensUltimas24h: fila.tokens24h ?? 0,
    tokensMedidosUltimas24h: fila.tokensMedidos24h ?? 0,
    tokensEstimadosUltimas24h: fila.tokensEstimados24h ?? 0,
    ejecucionesUltimoMinuto: fila.ejecuciones1m ?? 0,
    tokensUltimoMinuto: fila.tokens1m ?? 0,
    ejecucionesUltimos30d: fila.ejecuciones30d ?? 0,
    ultimoRechazo: ultimoRechazoPorModelo.get(fila.modelo) ?? null,
  }]));
  for (const [modelo, ultimoRechazo] of ultimoRechazoPorModelo) {
    if (!porModelo.has(modelo)) {
      porModelo.set(modelo, {
        modelo,
        ejecucionesDesdeReinicioDiario: 0,
        tokensDesdeReinicioDiario: 0,
        tokensMedidosDesdeReinicioDiario: 0,
        tokensEstimadosDesdeReinicioDiario: 0,
        ejecucionesUltimas24h: 0,
        tokensUltimas24h: 0,
        tokensMedidosUltimas24h: 0,
        tokensEstimadosUltimas24h: 0,
        ejecucionesUltimoMinuto: 0,
        tokensUltimoMinuto: 0,
        ejecucionesUltimos30d: 0,
        ultimoRechazo,
      });
    }
  }
  return [...porModelo.values()].sort((a, b) => b.ejecucionesUltimas24h - a.ejecucionesUltimas24h || b.ejecucionesUltimos30d - a.ejecucionesUltimos30d || a.modelo.localeCompare(b.modelo));
}

// Muestra también las integraciones API desde cero para que el usuario vea su medición y disponibilidad.
function proveedoresActivos(): string[] {
  const usados = db
    .query<{ provider: string }, []>("SELECT DISTINCT provider FROM usage WHERE created_at >= datetime('now', '-30 days')")
    .all()
    .map((r) => r.provider);
  const rechazados = db
    .query<{ provider: string; model: string }, []>("SELECT DISTINCT provider, model FROM provider_limit_events WHERE created_at >= datetime('now', '-30 days')")
    .all()
    .flatMap((r) => r.provider === "opencode" && /gemini|argon/i.test(r.model) ? ["google"] : [r.provider]);
  return [...new Set([...usados, ...rechazados, "opencode", "google", "openai", "xai", "nvidia", "groq", "openrouter", "deepseek", "commandcode"])].sort();
}

export const uso = new Hono();

// GET /api/uso
uso.get("/uso", async (c) => {
  const forzar = c.req.query("refresh") === "1";
  const [googleLive, openaiLimits, openaiUsage, openCodeLimits, openRouterLimits] = await Promise.all([
    obtenerMetricasGoogleLive(forzar),
    obtenerLimitesOpenAI(forzar),
    obtenerUsoOpenAIAdmin(forzar),
    obtenerCuotaOpenCode(forzar),
    obtenerCuotaOpenRouter(forzar),
  ]);

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
      porModelo: usoPorModelo(id),
      precision: enUltimos30d > 0 ? ("registro_telo" as const) : ("sin_datos" as const),
      ...(id === "google" ? { googleLive } : {}),
      ...(id === "openai" ? { openaiLimits } : {}),
      ...(id === "openai" ? { openaiUsage } : {}),
      ...(id === "opencode" ? { openCodeLimits } : {}),
      ...(id === "openrouter" ? { openRouterLimits } : {}),
    };
  });

  return c.json({ generado: new Date().toISOString(), proveedores, googleLive, openaiLimits, openaiUsage, openCodeLimits, openRouterLimits });
});
