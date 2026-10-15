import { Hono } from "hono";
import { proveedorConClave, tieneClaveProveedor } from "../claves-proveedor";
import { cancelarLoginCodex, confirmarLoginCodex, estadoLoginCodex, iniciarLoginCodex, LoginError, sesionCodexConectada } from "../login-cli";
import { hallarEjecutable } from "../ejecutable";


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
  };
}

// Solo dice si cada proveedor está listo en el servidor. Nunca devuelve el valor de una clave.
function estadoProveedores(): ProviderStatus[] {
  const enAgente = variablesDeAgente();
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
    },
    {
      id: "codex",
      name: "Codex",
      configured: Boolean(process.env.OPENAI_API_KEY) || sesionCodexConectada(),
      implemented: false,
      hint: "Inicio de sesión con la cuenta de ChatGPT desde esta página. Los agentes todavía no usan Codex.",
      variable: "OPENAI_API_KEY",
      enAgente: enAgente.has("OPENAI_API_KEY"),
      guardable: false,
      guardada: false,
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
  ];
}

export const providers = new Hono();

// GET /api/providers
providers.get("/providers", (c) => c.json(estadoProveedores()));

// Inicio de sesión de Codex por código de dispositivo (ver login-cli.ts). Solo Codex tiene este flujo.
providers.get("/providers/codex/login", (c) => c.json(estadoLoginCodex()));
providers.post("/providers/codex/login", (c) => {
  try {
    return c.json(iniciarLoginCodex(), 202);
  } catch (err) {
    if (err instanceof LoginError) return c.json({ error: err.code }, err.status);
    throw err;
  }
});
providers.delete("/providers/codex/login", (c) => c.json(cancelarLoginCodex()));
providers.post("/providers/codex/confirmar", async (c) => c.json(await confirmarLoginCodex()));
