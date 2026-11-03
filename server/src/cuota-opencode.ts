import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as esperar } from "node:timers/promises";
import { claveDeAuthJson } from "./claves-proveedor";
import { hallarEjecutable } from "./ejecutable";
import { carpetaHome } from "./hogar";

export type MedidorOpenCode = { percent: number; limited: boolean; resetsAt: number };
export type PresupuestoOpenCode = {
  id: string;
  limit: number;
  spent: number;
  scope: "each" | "combined";
  per: "set" | "model";
  coverage: "all" | "models";
  resetsAt: number;
  models: { providerID: string; modelID: string; name: string; spent: number }[];
};
export type CuotaOpenCode = {
  estado: "consultado" | "sin_cli" | "sin_sesion" | "no_disponible";
  mensaje: string;
  espacio: string | null;
  go: { rolling: MedidorOpenCode; weekly: MedidorOpenCode; monthly: MedidorOpenCode } | null;
  presupuestos: PresupuestoOpenCode[];
  comprobadoEn: string;
};

type DatosCrudos = {
  workspace?: { name?: unknown };
  go?: Record<string, unknown>;
  budgets?: unknown;
};

const TTL_MS = 5 * 60_000;
const TIEMPO_MAXIMO_MS = 12_000;
let cache: { hasta: number; datos: CuotaOpenCode } | null = null;
let enCurso: Promise<CuotaOpenCode> | null = null;

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function medidor(valor: unknown): MedidorOpenCode | null {
  if (!valor || typeof valor !== "object") return null;
  const dato = valor as Record<string, unknown>;
  const percent = numero(dato.percent);
  const resetsAt = numero(dato.resetsAt);
  if (percent === null || resetsAt === null) return null;
  return { percent: Math.max(0, Math.min(100, percent)), limited: dato.limited === true, resetsAt };
}

function presupuesto(valor: unknown): PresupuestoOpenCode | null {
  if (!valor || typeof valor !== "object") return null;
  const dato = valor as Record<string, unknown>;
  const limit = numero(dato.limit);
  const spent = numero(dato.spent);
  const resetsAt = numero(dato.resetsAt);
  if (typeof dato.id !== "string" || limit === null || spent === null || resetsAt === null) return null;
  const models = Array.isArray(dato.models) ? dato.models.slice(0, 100).flatMap((modelo) => {
    if (!modelo || typeof modelo !== "object") return [];
    const m = modelo as Record<string, unknown>;
    if (typeof m.modelID !== "string" || typeof m.name !== "string") return [];
    return [{
      providerID: typeof m.providerID === "string" ? m.providerID.slice(0, 80) : "",
      modelID: m.modelID.slice(0, 160),
      name: m.name.slice(0, 160),
      spent: numero(m.spent) ?? 0,
    }];
  }) : [];
  return {
    id: dato.id.slice(0, 120),
    limit,
    spent,
    scope: dato.scope === "each" ? "each" : "combined",
    per: dato.per === "model" ? "model" : "set",
    coverage: dato.coverage === "models" ? "models" : "all",
    resetsAt,
    models,
  };
}

function resultado(estado: CuotaOpenCode["estado"], mensaje: string, datos?: DatosCrudos | null): CuotaOpenCode {
  const go = datos?.go;
  const rolling = go ? medidor(go.rolling) : null;
  const weekly = go ? medidor(go.weekly) : null;
  const monthly = go ? medidor(go.monthly) : null;
  const budgets = Array.isArray(datos?.budgets) ? datos.budgets.slice(0, 100).flatMap((fila) => {
    const valor = presupuesto(fila);
    return valor ? [valor] : [];
  }) : [];
  return {
    estado,
    mensaje,
    espacio: typeof datos?.workspace?.name === "string" ? datos.workspace.name.slice(0, 120) : null,
    go: rolling && weekly && monthly ? { rolling, weekly, monthly } : null,
    presupuestos: budgets,
    comprobadoEn: new Date().toISOString(),
  };
}

async function puertoDisponible(): Promise<number> {
  const servidor = createServer();
  return await new Promise<number>((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const direccion = servidor.address();
      if (!direccion || typeof direccion === "string") {
        servidor.close();
        reject(new Error("No se pudo reservar un puerto loopback."));
        return;
      }
      servidor.close((error) => error ? reject(error) : resolve(direccion.port));
    });
  });
}

async function consultar(): Promise<CuotaOpenCode> {
  const cli = hallarEjecutable("opencode");
  if (!cli) return resultado("sin_cli", "OpenCode CLI no está instalado en el servidor.");
  if (!process.env.OPENCODE_API_KEY && !claveDeAuthJson("opencode")) {
    return resultado("sin_sesion", "No se detectó una sesión o clave de OpenCode en el servidor.");
  }

  let proceso: Bun.Subprocess<"ignore", "ignore", "ignore"> | null = null;
  try {
    const port = await puertoDisponible();
    const password = randomBytes(32).toString("base64url");
    const setsid = hallarEjecutable("setsid");
    const comando = setsid ? [setsid, cli, "serve", "--hostname", "127.0.0.1", "--port", String(port)] : [cli, "serve", "--hostname", "127.0.0.1", "--port", String(port)];
    proceso = Bun.spawn(comando, {
      cwd: carpetaHome(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: carpetaHome(),
        ...(process.env.XDG_DATA_HOME ? { XDG_DATA_HOME: process.env.XDG_DATA_HOME } : {}),
        ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
        ...(process.env.OPENCODE_CONFIG_DIR ? { OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR } : {}),
        ...(process.env.OPENCODE_API_KEY ? { OPENCODE_API_KEY: process.env.OPENCODE_API_KEY } : {}),
        OPENCODE_PASSWORD: password,
        OPENCODE_SERVER_PASSWORD: password,
        NO_COLOR: "1",
      },
    }) as Bun.Subprocess<"ignore", "ignore", "ignore">;
    const url = `http://127.0.0.1:${port}/api/experimental/usage/limits`;
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const limite = Date.now() + TIEMPO_MAXIMO_MS;

    while (Date.now() < limite) {
      if (proceso.exitCode !== null) return resultado("no_disponible", "El servidor local de OpenCode terminó antes de responder.");
      try {
        const respuesta = await fetch(url, {
          headers: { Authorization: authorization, Accept: "application/json" },
          signal: AbortSignal.timeout(1_000),
        });
        if (respuesta.status === 200) {
          const cuerpo = await respuesta.json().catch(() => null) as { data?: DatosCrudos | null } | null;
          if (!cuerpo?.data) return resultado("sin_sesion", "OpenCode no detectó una sesión de Console o Go en este perfil.");
          const parsed = resultado("consultado", "Presupuesto y allowance confirmados por el servidor local de OpenCode.", cuerpo.data);
          if (parsed.go || parsed.presupuestos.length > 0) return parsed;
          return resultado("consultado", "OpenCode Console está conectado, pero no devolvió presupuestos ni límites Go.", cuerpo.data);
        }
        if (respuesta.status === 404) return resultado("no_disponible", "La versión instalada de OpenCode no expone su endpoint experimental de límites.");
        if (respuesta.status === 401 || respuesta.status === 403) return resultado("no_disponible", "OpenCode rechazó la consulta local autenticada.");
      } catch {
        // La primera conexión puede llegar antes de que el CLI abra su puerto loopback.
      }
      await esperar(120);
    }
    return resultado("no_disponible", "OpenCode no respondió dentro del tiempo de consulta.");
  } catch {
    return resultado("no_disponible", "No se pudo iniciar una consulta local segura de OpenCode.");
  } finally {
    try { proceso?.kill(); } catch { /* El servidor pudo terminar por su cuenta. */ }
  }
}

export async function obtenerCuotaOpenCode(forzar = false): Promise<CuotaOpenCode> {
  if (!forzar && cache && Date.now() < cache.hasta) return cache.datos;
  if (!enCurso) enCurso = consultar().finally(() => { enCurso = null; });
  const datos = await enCurso;
  cache = { hasta: Date.now() + TTL_MS, datos };
  return datos;
}
