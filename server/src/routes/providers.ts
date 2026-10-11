import { Hono } from "hono";

type ProviderStatus = {
  id: string;
  name: string;
  configured: boolean;
  implemented: boolean;
  hint: string;
  // Nombre de la variable que usa el proveedor (nunca su valor). null si no necesita ninguna.
  variable: string | null;
  // La variable llega a los agentes: está en TELO_AGENTE_VARIABLES.
  enAgente: boolean;
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

// Solo dice si cada proveedor está listo en el servidor. Nunca devuelve el valor de una clave:
// las claves viven en el archivo de entorno de systemd del VM.
function estadoProveedores(): ProviderStatus[] {
  const enAgente = variablesDeAgente();
  const google = variableGoogle();
  return [
    {
      id: "opencode",
      name: "OpenCode",
      configured: Bun.which("opencode") !== null,
      implemented: true,
      hint: "CLI de OpenCode instalado en el servidor.",
      variable: null,
      enAgente: true,
    },
    {
      id: "codex",
      name: "Codex",
      configured: Boolean(process.env.OPENAI_API_KEY),
      implemented: false,
      hint: "Necesita OPENAI_API_KEY en el archivo de entorno del servidor.",
      variable: "OPENAI_API_KEY",
      enAgente: enAgente.has("OPENAI_API_KEY"),
    },
    {
      id: "google",
      name: "Google (Gemini)",
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      implemented: false,
      hint: "Necesita GEMINI_API_KEY en el archivo de entorno del servidor.",
      variable: google,
      enAgente: enAgente.has(google),
    },
  ];
}

export const providers = new Hono();

// GET /api/providers
providers.get("/providers", (c) => c.json(estadoProveedores()));
