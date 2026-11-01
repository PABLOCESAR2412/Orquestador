import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { proveedorConClave, tieneClaveProveedor, valorClaveApiProveedor } from "../claves-proveedor";
import { cancelarLoginCodex, confirmarLoginCodex, estadoLoginCodex, iniciarLoginCodex, LoginError, sesionCodexConectada } from "../login-cli";
import { hallarEjecutable } from "../ejecutable";
import { carpetaHome } from "../hogar";
import { listarModelosCodex } from "../modelos-codex";
import { obtenerCuotaCodex } from "../cuota-codex";


type ProviderStatus = {
  id: string;
  name: string;
  configured: boolean;
  implemented: boolean;
  hint: string;
  // Nombre de la variable que usa el proveedor (nunca su valor). null si no necesita ninguna.
  variable: string | null;
  // La variable llega a los agentes: guardada desde Ajustes, o está en TELO_AGENTE_VARIABLES.
  enAgente: boolean;
  // La clave se puede guardar desde Ajustes (cifrada en la base).
  guardable: boolean;
  // La clave está guardada en Telo (no solo en el archivo de entorno del servidor).
  guardada: boolean;
  sesion: boolean;
};

// Variables que el agente recibe del servidor. Sin variable, el proveedor usa su propia
// configuración dentro del HOME del agente, que sí llega.
function variablesDeAgente(): Set<string> {
  return new Set(
    (process.env.TELO_AGENTE_VARIABLES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

// Solo informa si hay una entrada Codex en el almacén propio de Hermes; nunca devuelve el JSON.
// El formato lo administra Hermes y puede cambiar entre versiones, por eso comprobamos presencia,
// sin interpretar ni exponer access/refresh tokens.
function hermesCodexAuthConfigurada(): boolean {
  const archivo = join(carpetaHome(), ".hermes-telo", "auth.json");
  try {
    if (!existsSync(archivo)) return false;
    const texto = readFileSync(archivo, "utf8");
    if (texto.length > 1_000_000) return false;
    const json = JSON.parse(texto);
    const plano = JSON.stringify(json);
    return /openai-codex/i.test(plano) && /refresh[_-]?token/i.test(plano);
  } catch {
    return false;
  }
}

// Proveedor con clave que se puede guardar: configurado si la clave está en la base o en el entorno del servidor.
// Las variables salen de claves-proveedor.ts; la primera es la que se muestra.
function proveedorGuardable(id: string, name: string, hint: string, enAgente: Set<string>): ProviderStatus {
  const variables = proveedorConClave(id)?.variables ?? [];
  const guardada = tieneClaveProveedor(id);
  return {
    id,
    name,
    configured: guardada || variables.some((v) => Boolean(process.env[v])),
    // Las claves guardadas llegan a los agentes y a `opencode models` (ver claves-proveedor.ts).
    implemented: true,
    hint,
    variable: variables[0] ?? null,
    enAgente: guardada || variables.some((v) => enAgente.has(v)),
    guardable: true,
    guardada,
    sesion: false,
  };
}

// Solo dice si cada proveedor está listo en el servidor. Nunca devuelve el valor de una clave.
async function estadoProveedores(): Promise<ProviderStatus[]> {
  const enAgente = variablesDeAgente();
  const sesionCodex = await sesionCodexConectada();
  const hermesInstalado = hallarEjecutable("hermes") !== null;
  const hermesConectado = hermesInstalado && hermesCodexAuthConfigurada();
  return [
    {
      id: "opencode",
      name: "OpenCode",
      configured: hallarEjecutable("opencode") !== null,
      implemented: true,
      hint: "CLI de OpenCode instalado en el servidor.",
      variable: null,
      enAgente: true,
      guardable: false,
      guardada: false,
      sesion: false,
    },
    {
      id: "codex",
      name: "Codex",
      configured: sesionCodex,
      implemented: true,
      hint: sesionCodex
        ? "Sesión conectada con ChatGPT. Los modelos de Codex están disponibles en el selector."
        : "Inicia sesión con tu cuenta de ChatGPT usando el código de dispositivo.",
      variable: null,
      // Este proveedor se ejecuta con el CLI autenticado, no con OPENAI_API_KEY.
      enAgente: sesionCodex,
      guardable: false,
      guardada: false,
      sesion: sesionCodex,
    },
    {
      id: "hermes",
      name: "Hermes Agent",
      configured: hermesInstalado,
      // La instalación y el login se exponen como preparación del piloto; Telo aún no enruta chats a Hermes.
      implemented: false,
      hint: hermesConectado
        ? "CLI instalado y credenciales propias detectadas. La ejecución aislada y el uso de subagentes siguen en piloto."
        : hermesInstalado
          ? "CLI instalado. Inicia su OAuth propio para preparar el piloto; no se asume que la sesión Codex existente se pueda compartir."
          : "Harness alternativo para un piloto de subagentes nativos. Se instala desde aquí; aún no es el runner de chats.",
      variable: null,
      enAgente: false,
      guardable: false,
      guardada: false,
      sesion: hermesConectado,
    },
    proveedorGuardable(
      "google",
      "Google (Gemini)",
      "Clave de Gemini. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
    proveedorGuardable(
      "groq",
      "Groq",
      "Clave de Groq. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
    proveedorGuardable(
      "nvidia",
      "NVIDIA",
      "Clave de NVIDIA. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
    proveedorGuardable("deepseek", "DeepSeek", "Clave de DeepSeek para su API directa; se guarda cifrada.", enAgente),
    proveedorGuardable("xai", "xAI", "Clave de xAI para su API directa; se guarda cifrada.", enAgente),
    proveedorGuardable(
      "openrouter",
      "OpenRouter",
      "Clave de OpenRouter. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
  ];
}

export const providers = new Hono();

// GET /api/providers
providers.get("/providers", async (c) => c.json(await estadoProveedores()));

// Prueba credenciales con un GET al catálogo de modelos; no genera respuestas ni consume tokens.
providers.post("/providers/:id/probar", async (c) => {
  const id = c.req.param("id");
  const clave = valorClaveApiProveedor(id);
  if (!clave) return c.json({ ok: false, error: "provider_key_missing" });

  const destinos: Record<string, { url: string; headers: Record<string, string> }> = {
    deepseek: { url: "https://api.deepseek.com/models", headers: { Authorization: `Bearer ${clave}` } },
    xai: { url: "https://api.x.ai/v1/models", headers: { Authorization: `Bearer ${clave}` } },
    google: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": clave } },
    groq: { url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${clave}` } },
    nvidia: { url: "https://integrate.api.nvidia.com/v1/models", headers: { Authorization: `Bearer ${clave}` } },
    openrouter: { url: "https://openrouter.ai/api/v1/models", headers: { Authorization: `Bearer ${clave}` } },
  };
  const destino = destinos[id];
  if (!destino) return c.json({ ok: false, error: "provider_test_unsupported" });

  try {
    const respuesta = await fetch(destino.url, {
      headers: { Accept: "application/json", ...destino.headers },
      signal: AbortSignal.timeout(8_000),
    });
    if (!respuesta.ok) {
      return c.json({
        ok: false,
        error: respuesta.status === 401 || respuesta.status === 403
          ? "provider_key_rejected"
          : respuesta.status === 429
            ? "provider_rate_limited"
            : "provider_connection_failed",
      });
    }
    const cuerpo = await respuesta.json().catch(() => null) as { data?: unknown[]; models?: unknown[] } | null;
    const modelos = Array.isArray(cuerpo?.data) ? cuerpo.data.length : Array.isArray(cuerpo?.models) ? cuerpo.models.length : null;
    return c.json({ ok: true, modelos });
  } catch {
    return c.json({ ok: false, error: "provider_connection_failed" });
  }
});

// El balance es información de cuenta oficial y solo se consulta al abrir el panel.
// No se devuelve la clave ni se mezcla con el uso agregado que Telo registra en Analytics.
providers.get("/providers/deepseek/balance", async (c) => {
  const comprobadoEn = new Date().toISOString();
  const clave = valorClaveApiProveedor("deepseek");
  if (!clave) return c.json({ estado: "sin_clave", balanceInfos: [], comprobadoEn });

  try {
    const respuesta = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Accept: "application/json", Authorization: `Bearer ${clave}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!respuesta.ok) {
      return c.json({
        estado: respuesta.status === 401 || respuesta.status === 403 ? "clave_invalida" : "no_disponible",
        balanceInfos: [],
        comprobadoEn,
      });
    }
    const cuerpo = await respuesta.json() as {
      is_available?: unknown;
      balance_infos?: unknown;
    };
    const balanceInfos = Array.isArray(cuerpo.balance_infos)
      ? cuerpo.balance_infos.flatMap((dato) => {
          if (!dato || typeof dato !== "object") return [];
          const item = dato as Record<string, unknown>;
          if ((item.currency !== "USD" && item.currency !== "CNY") || typeof item.total_balance !== "string") return [];
          return [{
            currency: item.currency,
            totalBalance: item.total_balance,
            grantedBalance: typeof item.granted_balance === "string" ? item.granted_balance : null,
            toppedUpBalance: typeof item.topped_up_balance === "string" ? item.topped_up_balance : null,
          }];
        })
      : [];
    return c.json({
      estado: balanceInfos.length ? "activo" : "no_disponible",
      disponible: typeof cuerpo.is_available === "boolean" ? cuerpo.is_available : null,
      balanceInfos,
      comprobadoEn,
    });
  } catch {
    return c.json({ estado: "no_disponible", balanceInfos: [], comprobadoEn });
  }
});

// Inicio de sesión de Codex por código de dispositivo (ver login-cli.ts). Solo Codex tiene este flujo.
providers.get("/providers/codex/login", async (c) => c.json(await estadoLoginCodex()));
providers.get("/providers/codex/models", async (c) => {
  if (!await sesionCodexConectada()) return c.json({ error: "codex_no_conectado" }, 409);
  try {
    return c.json(await listarModelosCodex());
  } catch {
    return c.json({ error: "codex_models_unavailable" }, 503);
  }
});
providers.get("/providers/codex/usage", async (c) => c.json(await obtenerCuotaCodex(c.req.query("refresh") === "1")));
providers.post("/providers/codex/login", async (c) => {
  try {
    return c.json(await iniciarLoginCodex(), 202);
  } catch (err) {
    if (err instanceof LoginError) return c.json({ error: err.code }, err.status);
    throw err;
  }
});
providers.delete("/providers/codex/login", async (c) => c.json(await cancelarLoginCodex()));
providers.post("/providers/codex/confirmar", async (c) => c.json(await confirmarLoginCodex()));
