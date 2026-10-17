import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  cerrarSesionPorToken,
  claveCorrecta,
  COOKIE_SESION,
  crearSesionDispositivo,
  listarSesiones,
  revocarOtrasSesiones,
  revocarSesion,
  sesionValida,
} from "../auth";
import { config } from "../config";

// Límite de intentos fallidos por IP y global para evitar ataques de fuerza bruta
// sin provocar denegación de servicio a clientes legítimos en otras redes.
const VENTANA_MS = 15 * 60_000;
const MAX_FALLOS_POR_IP = 10;
const MAX_FALLOS_TOTALES = 50;
const fallosPorIp = new Map<string, number[]>();
let fallosGlobales: number[] = [];

function validarIp(candidato: string | undefined): string | null {
  if (!candidato) return null;
  const limpio = candidato.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$|^[a-fA-F0-9:]+$/.test(limpio)) {
    return limpio;
  }
  return null;
}

function obtenerIpCliente(c: Context): string {
  const cf = validarIp(c.req.header("cf-connecting-ip"));
  if (cf) return cf;

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",");
    for (let i = partes.length - 1; i >= 0; i--) {
      const v = validarIp(partes[i]);
      if (v) return v;
    }
  }

  const real = validarIp(c.req.header("x-real-ip"));
  if (real) return real;

  return "desconocida";
}

function demasiadosIntentos(ip: string): boolean {
  const desde = Date.now() - VENTANA_MS;
  fallosGlobales = fallosGlobales.filter((t) => t >= desde);
  if (fallosGlobales.length >= MAX_FALLOS_TOTALES) return true;

  const intentos = fallosPorIp.get(ip) ?? [];
  const validos = intentos.filter((t) => t >= desde);
  if (validos.length > 0) {
    fallosPorIp.set(ip, validos);
  } else {
    fallosPorIp.delete(ip);
  }
  return validos.length >= MAX_FALLOS_POR_IP;
}

function registrarFallo(ip: string): void {
  const ahora = Date.now();
  fallosGlobales.push(ahora);
  const intentos = fallosPorIp.get(ip) ?? [];
  intentos.push(ahora);
  fallosPorIp.set(ip, intentos);
}

function limpiarFallos(ip: string): void {
  fallosPorIp.delete(ip);
}

const DURACION_SESION_S = 60 * 60 * 24 * 30;

// El túnel de Cloudflare termina el HTTPS antes de llegar al servidor; por eso se mira la cabecera.
function esHttps(c: Context): boolean {
  return (
    c.req.header("cf-visitor")?.includes('"https"') === true ||
    c.req.header("x-forwarded-proto") === "https" ||
    new URL(c.req.url).protocol === "https:"
  );
}

// Solo es HTTP sin cifrar cuando el navegador llega directo a este equipo (túnel SSH a 127.0.0.1)
// y no pasa por ningún proxy. En cualquier otro caso la cookie lleva Secure.
function esLocalDirecto(c: Context): boolean {
  const reenviado =
    c.req.header("x-forwarded-proto") ||
    c.req.header("x-forwarded-for") ||
    c.req.header("cf-visitor") ||
    c.req.header("forwarded");
  return !reenviado && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(c.req.url).hostname);
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
  const ip = obtenerIpCliente(c);
  if (demasiadosIntentos(ip)) return c.json({ error: "demasiados_intentos" }, 429);

  const body = await c.req.json<{ clave?: string }>().catch(() => ({}) as { clave?: string });
  // Solo texto: un número o una lista en el cuerpo cuenta como intento fallido, no como error del servidor.
  if (typeof body.clave !== "string" || !claveCorrecta(body.clave)) {
    registrarFallo(ip);
    return c.json({ error: "clave_incorrecta" }, 401);
  }

  // Éxito: limpiar fallos registrados para esta IP
  limpiarFallos(ip);

  const userAgent = c.req.header("user-agent");
  const sesion = crearSesionDispositivo({ userAgent, ip: ip !== "desconocida" ? ip : undefined });

  setCookie(c, COOKIE_SESION, sesion.token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: DURACION_SESION_S,
    secure: esHttps(c) || !esLocalDirecto(c),
  });
  return c.json({ ok: true });
});

// POST /api/logout
auth.post("/logout", (c) => {
  const actual = getCookie(c, COOKIE_SESION);
  if (actual) cerrarSesionPorToken(actual);
  deleteCookie(c, COOKIE_SESION, { path: "/" });
  return c.json({ ok: true });
});

// GET /api/sesiones -> lista de sesiones activas por dispositivo
auth.get("/sesiones", (c) => {
  const actual = getCookie(c, COOKIE_SESION);
  return c.json(listarSesiones(actual));
});

// DELETE /api/sesiones/:id -> revoca una sesión específica
auth.delete("/sesiones/:id", (c) => {
  const id = c.req.param("id");
  const ok = revocarSesion(id);
  if (!ok) return c.json({ error: "sesion_no_encontrada" }, 404);
  return c.json({ ok: true });
});

// POST /api/sesiones/cerrar-otras -> revoca todas las sesiones excepto la del dispositivo actual
auth.post("/sesiones/cerrar-otras", (c) => {
  const actual = getCookie(c, COOKIE_SESION);
  const revocadas = revocarOtrasSesiones(actual);
  return c.json({ ok: true, revocadas });
});
