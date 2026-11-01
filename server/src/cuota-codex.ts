import { carpetaHome } from "./hogar";
import { hallarEjecutable } from "./ejecutable";

export type VentanaCuotaCodex = {
  id: string;
  nombre: string;
  usadoPorcentaje: number;
  restantePorcentaje: number;
  duracionMinutos: number | null;
  reiniciaEn: string | null;
};

export type CuotaCodex = {
  estado: "activo" | "sin_cli" | "sin_sesion" | "no_disponible";
  plan: string | null;
  ventanas: VentanaCuotaCodex[];
  reiniciosDisponibles: number | null;
  comprobadoEn: string;
};

type Rpc = { id?: unknown; result?: unknown; error?: unknown };

const TTL_MS = 60_000;
const TIEMPO_MAXIMO_MS = 8_000;
let cache: { hasta: number; cuota: CuotaCodex } | null = null;
let consulta: Promise<CuotaCodex> | null = null;

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function planLegible(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const nombres: Record<string, string> = {
    free: "ChatGPT Free",
    plus: "ChatGPT Plus",
    pro: "ChatGPT Pro",
    business: "ChatGPT Business",
    enterprise: "ChatGPT Enterprise",
    edu: "ChatGPT Edu",
  };
  return nombres[valor.toLowerCase()] ?? valor;
}

export function interpretarCuotaCodex(cuentaValor: unknown, limitesValor: unknown, ahora = Date.now()): CuotaCodex {
  const cuenta = objeto(cuentaValor);
  const cuentaInterna = objeto(cuenta?.account);
  const limites = objeto(limitesValor);
  const snapshot = objeto(limites?.rateLimits);
  const porId = objeto(limites?.rateLimitsByLimitId);
  const cubetas = porId && Object.keys(porId).length > 0 ? porId : snapshot ? { codex: snapshot } : {};
  const ventanas: VentanaCuotaCodex[] = [];

  for (const [id, valor] of Object.entries(cubetas)) {
    const cubeta = objeto(valor);
    if (!cubeta) continue;
    for (const periodo of ["primary", "secondary"] as const) {
      const ventana = objeto(cubeta[periodo]);
      const usado = numero(ventana?.usedPercent);
      if (usado === null) continue;
      const resetsAt = numero(ventana?.resetsAt);
      const nombreBase = typeof cubeta.limitName === "string" && cubeta.limitName ? cubeta.limitName : id;
      const nombrePeriodo = periodo === "primary" ? "Ventana actual" : "Ventana ampliada";
      ventanas.push({
        id: `${id}:${periodo}`,
        nombre: Object.keys(cubetas).length > 1 ? `${nombreBase} · ${nombrePeriodo}` : nombrePeriodo,
        usadoPorcentaje: Math.max(0, Math.min(100, usado)),
        restantePorcentaje: Math.max(0, Math.min(100, 100 - usado)),
        duracionMinutos: numero(ventana?.windowDurationMins),
        reiniciaEn: resetsAt === null ? null : new Date(resetsAt * 1000).toISOString(),
      });
    }
  }

  const estadoCuenta = cuentaInterna?.type;
  const estado: CuotaCodex["estado"] = estadoCuenta === "chatgpt" && ventanas.length
    ? "activo"
    : estadoCuenta === "chatgpt"
      ? "no_disponible"
      : "sin_sesion";
  const resets = objeto(limites?.rateLimitResetCredits);
  const disponible = numero(resets?.availableCount);

  return {
    estado,
    plan: planLegible(cuentaInterna?.planType)
      ?? planLegible(snapshot?.planType)
      ?? (porId ? Object.values(porId).map(objeto).find((fila) => fila?.planType)?.planType as string | undefined : undefined)
      ?? null,
    ventanas,
    reiniciosDisponibles: disponible === null ? null : Math.max(0, Math.floor(disponible)),
    comprobadoEn: new Date(ahora).toISOString(),
  };
}

function fallida(estado: CuotaCodex["estado"]): CuotaCodex {
  return { estado, plan: null, ventanas: [], reiniciosDisponibles: null, comprobadoEn: new Date().toISOString() };
}

async function consultar(): Promise<CuotaCodex> {
  const codex = hallarEjecutable("codex");
  if (!codex) return fallida("sin_cli");

  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const esperas = new Map<number, { resolve: (respuesta: Rpc) => void; reject: (error: Error) => void }>();
  try {
    proc = Bun.spawn([codex, "app-server", "--listen", "stdio://"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: carpetaHome(),
        LC_ALL: "C.UTF-8",
        ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
      },
    });
    void new Response(proc.stderr).text().catch(() => "");
    timeout = setTimeout(() => {
      try { proc?.kill(); } catch { /* El proceso ya terminó. */ }
      for (const pendiente of esperas.values()) pendiente.reject(new Error("codex_solicitud_tiempo_agotado"));
      esperas.clear();
    }, TIEMPO_MAXIMO_MS);

    const reader = proc.stdout.getReader();
    const rechazarPendientes = (error: Error) => {
      for (const pendiente of esperas.values()) pendiente.reject(error);
      esperas.clear();
    };
    const leer = (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (esperas.size > 0) rechazarPendientes(new Error("codex_respuesta_incompleta"));
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 256_000) throw new Error("codex_respuesta_demasiado_grande");
        let salto = buffer.indexOf("\n");
        while (salto >= 0) {
          const linea = buffer.slice(0, salto).trim();
          buffer = buffer.slice(salto + 1);
          if (linea) {
            let mensaje: Rpc;
            try { mensaje = JSON.parse(linea) as Rpc; } catch { throw new Error("codex_respuesta_invalida"); }
            if (typeof mensaje.id === "number") {
              const pendiente = esperas.get(mensaje.id);
              if (pendiente) {
                esperas.delete(mensaje.id);
                if (mensaje.error) pendiente.reject(new Error("codex_solicitud_fallida"));
                else pendiente.resolve(mensaje);
              }
            }
          }
          salto = buffer.indexOf("\n");
        }
      }
    })();
    void leer.catch((error: unknown) => {
      rechazarPendientes(error instanceof Error ? error : new Error("codex_respuesta_invalida"));
    });

    const enviar = (mensaje: Record<string, unknown>) => {
      proc!.stdin.write(`${JSON.stringify(mensaje)}\n`);
      proc!.stdin.flush();
    };
    const esperar = (id: number) => new Promise<Rpc>((resolve, reject) => {
      esperas.set(id, { resolve, reject });
    });
    const inicializado = esperar(0);
    enviar({
      method: "initialize",
      id: 0,
      params: { clientInfo: { name: "telo_usage", title: "Telo: uso de Codex", version: "1.0.0" } },
    });
    await inicializado;
    enviar({ method: "initialized", params: {} });

    const cuenta = esperar(1);
    const limites = esperar(2);
    enviar({ method: "account/read", id: 1, params: { refreshToken: false } });
    enviar({ method: "account/rateLimits/read", id: 2 });

    const [respuestaCuenta, respuestaLimites] = await Promise.all([cuenta, limites]);
    return interpretarCuotaCodex(respuestaCuenta.result, respuestaLimites.result);
  } catch {
    return fallida("no_disponible");
  } finally {
    if (timeout) clearTimeout(timeout);
    for (const pendiente of esperas.values()) pendiente.reject(new Error("codex_solicitud_cancelada"));
    try { proc?.kill(); } catch { /* El proceso ya terminó. */ }
    if (proc) {
      try { await proc.exited; } catch { /* Se informa como no disponible en la respuesta. */ }
    }
  }
}

export async function obtenerCuotaCodex(forzar = false): Promise<CuotaCodex> {
  if (!forzar && cache && Date.now() < cache.hasta) return cache.cuota;
  if (!consulta) {
    consulta = consultar().finally(() => { consulta = null; });
  }
  const cuota = await consulta;
  cache = { hasta: Date.now() + TTL_MS, cuota };
  return cuota;
}
