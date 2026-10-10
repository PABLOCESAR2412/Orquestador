import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { claveCorrecta, COOKIE_SESION, sesionValida, tokenSesion } from "../auth";
import { config } from "../config";

// Límite de intentos: la app es de un solo usuario, así que el contador es global.
const VENTANA_MS = 15 * 60_000;
const MAX_FALLOS = 10;
const fallos: number[] = [];

const DURACION_SESION_S = 60 * 60 * 24 * 30;

function demasiadosIntentos(): boolean {
  const desde = Date.now() - VENTANA_MS;
  while (fallos.length > 0 && fallos[0] < desde) fallos.shift();
  return fallos.length >= MAX_FALLOS;
}

// El túnel de Cloudflare termina el HTTPS antes de llegar al servidor; por eso se mira la cabecera.
function esHttps(c: Context): boolean {
  return (
    c.req.header("cf-visitor")?.includes('"https"') === true ||
    c.req.header("x-forwarded-proto") === "https" ||
    new URL(c.req.url).protocol === "https:"
  );
}

export const auth = new Hono();

// GET /api/sesion -> 200 con sesión válida, 401 sin ella
auth.get("/sesion", (c) =>
  sesionValida(getCookie(c, COOKIE_SESION))
    ? c.json({ ok: true })
    : c.json({ error: "login_required" }, 401),
);

// POST /api/login  body: { clave }
auth.post("/login", async (c) => {
  if (config.sinClave) return c.json({ ok: true });
  if (demasiadosIntentos()) return c.json({ error: "demasiados_intentos" }, 429);

  const body = await c.req.json<{ clave?: string }>().catch(() => ({}) as { clave?: string });
  // Solo texto: un número o una lista en el cuerpo cuenta como intento fallido, no como error del servidor.
  if (typeof body.clave !== "string" || !claveCorrecta(body.clave)) {
    fallos.push(Date.now());
    return c.json({ error: "clave_incorrecta" }, 401);
  }

  const token = tokenSesion();
  if (!token) return c.json({ error: "clave_no_configurada" }, 500);
  setCookie(c, COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: DURACION_SESION_S,
    secure: esHttps(c),
  });
  return c.json({ ok: true });
});

// POST /api/logout
auth.post("/logout", (c) => {
  deleteCookie(c, COOKIE_SESION, { path: "/" });
  return c.json({ ok: true });
});
