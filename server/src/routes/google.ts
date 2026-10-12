import { type Context, Hono } from "hono";
import {
  ErrorGoogle,
  completarConexionGoogle,
  desconectarGoogle,
  estadoGoogle,
  iniciarConexionGoogle,
} from "../oauth-google";

// Inicio de sesión con Google. Todas las rutas exigen sesión (lo aplica index.ts), salvo el callback,
// que Google llama desde otro sitio: ahí la protección es el estado de un solo uso.
export const googleRoute = new Hono();

function responderError(c: Context, err: unknown) {
  if (err instanceof ErrorGoogle) return c.json({ error: err.code }, err.status);
  return c.json({ error: "google_fallido" }, 502);
}

// GET /api/google/estado -> { configurado, faltantes, conectado, cuenta, conectado_en }
googleRoute.get("/google/estado", (c) => c.json(estadoGoogle()));

// POST /api/google/conectar -> { url }. La interfaz abre esa URL en la misma pestaña.
googleRoute.post("/google/conectar", (c) => {
  try {
    return c.json({ url: iniciarConexionGoogle() });
  } catch (err) {
    return responderError(c, err);
  }
});

// GET /api/google/callback?code&state (pública). Siempre redirige a Ajustes con un código fijo:
// nunca devuelve tokens, correos de error ni detalles de Google.
googleRoute.get("/google/callback", async (c) => {
  try {
    await completarConexionGoogle({
      code: c.req.query("code"),
      state: c.req.query("state"),
      error: c.req.query("error"),
    });
    return c.redirect("/ajustes?google=ok", 302);
  } catch (err) {
    const motivo = err instanceof ErrorGoogle ? err.code : "google_fallido";
    return c.redirect(`/ajustes?google=error&motivo=${motivo}`, 302);
  }
});

// DELETE /api/google -> { ok: true }. Revoca el token en Google y borra la conexión local.
googleRoute.delete("/google", async (c) => {
  await desconectarGoogle();
  return c.json({ ok: true });
});
