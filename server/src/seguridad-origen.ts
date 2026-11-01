import type { MiddlewareHandler } from "hono";
import { config } from "./config";

// SameSite no separa puertos de un mismo host. Las mutaciones del navegador
// necesitan el origen exacto; los clientes CLI sin cabeceras de navegador siguen admitidos.
export const protegerOrigen: MiddlewareHandler = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origen = c.req.header("origin");
  if (!origen) {
    const sitio = c.req.header("sec-fetch-site");
    if (sitio !== "cross-site" && sitio !== "same-site") return next();
  } else {
    const destino = new URL(c.req.url);
    // Tailscale/Cloudflare terminan TLS antes de Bun y conservan Host.
    if (c.req.header("x-forwarded-proto") === "https" || c.req.header("cf-visitor")?.includes('"https"')) {
      destino.protocol = "https:";
    }
    const permitidos = new Set([destino.origin]);
    if (config.publicUrl) {
      try {
        const publica = new URL(config.publicUrl);
        if (["http:", "https:"].includes(publica.protocol) && !publica.username && !publica.password) {
          permitidos.add(publica.origin);
        }
      } catch { /* Una URL pública inválida no habilita otro origen. */ }
    }
    if (permitidos.has(origen)) return next();
  }
  return c.json({ error: "origen_no_permitido" }, 403);
};
