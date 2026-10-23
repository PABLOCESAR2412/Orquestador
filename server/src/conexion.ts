import type { Context } from "hono";

// Bun exige conservar el receptor de timeout; Hono recibe solo las capacidades necesarias.
export function entornoConexion(request: Request, server: Pick<Bun.Server<unknown>, "requestIP" | "timeout">) {
  return {
    clientIp: server.requestIP(request)?.address,
    timeout: server.timeout.bind(server),
  };
}

// Bun corta a los 10 s las conexiones sin datos. Una petición que tarda más (un canal en vivo que
// calla, o un clonado que espera a GitHub) se desactiva el límite solo para esa conexión (server.timeout(req, 0)).
// La entrada pasa una función ligada al servidor como parte de c.env.
// Quien usa esto debe poner su propio límite de tiempo: sin él, la petición podría no terminar nunca.
export function sinLimiteDeInactividad(c: Context) {
  const servidor = c.env as { timeout?: (req: Request, segundos: number) => void } | undefined;
  try {
    servidor?.timeout?.(c.req.raw, 0);
  } catch {
    // Sin esta función (otro runtime o pruebas), la conexión sigue; solo puede cortarse por inactividad.
  }
}
