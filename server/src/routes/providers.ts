import { Hono } from "hono";
import { proveedorConClave, tieneClaveProveedor, valorClaveApiProveedor } from "../claves-proveedor";
import { cancelarLoginCodex, confirmarLoginCodex, estadoLoginCodex, iniciarLoginCodex, LoginError, sesionCodexConectada } from "../login-cli";
import { hallarEjecutable } from "../ejecutable";
import { listarModelosCodex } from "../modelos-codex";


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
      variable: "OPENAI_API_KEY",
      enAgente: enAgente.has("OPENAI_API_KEY"),
      guardable: false,
      guardada: false,
      sesion: sesionCodex,
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
