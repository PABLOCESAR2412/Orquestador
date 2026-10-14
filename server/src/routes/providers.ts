import { Hono } from "hono";
import { tieneClaveProveedor } from "../claves-proveedor";

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

// La primera variable que exista; si ninguna existe, la primera de la lista.
function variableGoogle(): string {
  return process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : process.env.GOOGLE_API_KEY ? "GOOGLE_API_KEY" : "GEMINI_API_KEY";
}

// Proveedor con clave que se puede guardar: configurado si la clave está en la base o en el entorno del servidor.
function proveedorGuardable(
  id: string,
  name: string,
  variable: string,
  hint: string,
  enAgente: Set<string>,
): ProviderStatus {
  const guardada = tieneClaveProveedor(id);
  return {
    id,
    name,
    configured: guardada || Boolean(process.env[variable]),
    // Las claves guardadas llegan a los agentes y a `opencode models` (ver claves-proveedor.ts).
    implemented: true,
    hint,
    variable,
    enAgente: guardada || enAgente.has(variable),
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
      configured: Bun.which("opencode") !== null,
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
      configured: Boolean(process.env.OPENAI_API_KEY),
      implemented: false,
      hint: "Necesita OPENAI_API_KEY en el archivo de entorno del servidor.",
      variable: "OPENAI_API_KEY",
      enAgente: enAgente.has("OPENAI_API_KEY"),
      guardable: false,
      guardada: false,
    },
    proveedorGuardable(
      "google",
      "Google (Gemini)",
      variableGoogle(),
      "Clave de Gemini. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
    proveedorGuardable(
      "groq",
      "Groq",
      "GROQ_API_KEY",
      "Clave de Groq. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
    proveedorGuardable(
      "nvidia",
      "NVIDIA",
      "NVIDIA_API_KEY",
      "Clave de NVIDIA. Se guarda aquí, cifrada, o viene del archivo de entorno del servidor.",
      enAgente,
    ),
  ];
}

export const providers = new Hono();

// GET /api/providers
providers.get("/providers", (c) => c.json(estadoProveedores()));
