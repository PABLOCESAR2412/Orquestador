import type { MiddlewareHandler } from "hono";

// Este modo solo admite peticiones directas al loopback, sin señales de proxy.
export function accesoLocalSinClave(host: string, ip: string | undefined, headers: Headers): boolean {
  if (!ip || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return false;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host.toLowerCase())) return false;
  for (const nombre of headers.keys()) {
    if (nombre === "forwarded" || nombre.startsWith("x-forwarded-") || nombre.startsWith("cf-") || nombre.startsWith("x-real-ip") || nombre.startsWith("tailscale-")) return false;
  }
  return true;
}

export const restringirSinClave: MiddlewareHandler = async (c, next) => {
  let host: string;
  try { host = new URL(`http://${c.req.header("host") ?? ""}`).hostname; } catch { return c.json({ error: "solo_local" }, 403); }
  const ip = (c.env as { clientIp?: string } | undefined)?.clientIp;
  return accesoLocalSinClave(host, ip, c.req.raw.headers) ? next() : c.json({ error: "solo_local" }, 403);
};
