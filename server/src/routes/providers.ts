import { Hono } from "hono";

type ProviderStatus = {
  id: string;
  name: string;
  configured: boolean;
  implemented: boolean;
  hint: string;
};

// Solo dice si cada proveedor está listo en el servidor. Nunca devuelve el valor de una clave:
// las claves viven en el archivo de entorno de systemd del VM.
function estadoProveedores(): ProviderStatus[] {
  return [
    {
      id: "opencode",
      name: "OpenCode",
      configured: Bun.which("opencode") !== null,
      implemented: true,
      hint: "CLI de OpenCode instalado en el servidor.",
    },
    {
      id: "codex",
      name: "Codex",
      configured: Boolean(process.env.OPENAI_API_KEY),
      implemented: false,
      hint: "Necesita OPENAI_API_KEY en el archivo de entorno del servidor.",
    },
    {
      id: "google",
      name: "Google (Gemini)",
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      implemented: false,
      hint: "Necesita GEMINI_API_KEY en el archivo de entorno del servidor.",
    },
  ];
}

export const providers = new Hono();

// GET /api/providers
providers.get("/providers", (c) => c.json(estadoProveedores()));
