import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";

// La marca vive fuera de los workspaces de agentes. Una concesión vencida no deja
// bloqueada la app si el actualizador fue terminado sin ejecutar su trap.
const CONCESION_MS = 30 * 60_000;
let activas = 0;
const pausasActivas = new Set<() => void>();
let vigilarPausas: ReturnType<typeof setInterval> | null = null;
export function enMantenimiento(): boolean {
  const ruta = process.env.TELO_MARCA_DESPLIEGUE || resolve(import.meta.dir, "../../.git/telo-mantenimiento");
  try {
    const marca = lstatSync(ruta);
    return !marca.isSymbolicLink() && Date.now() - marca.mtimeMs < CONCESION_MS;
  } catch { return false; }
}
// Solo el actualizador crea esta marca. Los respaldos comparten la marca general de
// mantenimiento, pero no deben interrumpir tareas que pueden seguir trabajando.
export function pausaTareasPorDespliegue(): boolean {
  const ruta = process.env.TELO_MARCA_PAUSA_DESPLIEGUE || resolve(import.meta.dir, "../../.git/telo-pausar-tareas");
  try {
    const marca = lstatSync(ruta);
    return !marca.isSymbolicLink() && Date.now() - marca.mtimeMs < CONCESION_MS;
  } catch { return false; }
}
export function registrarPausaActiva(pausar: () => void): () => void {
  pausasActivas.add(pausar);
  if (!vigilarPausas) {
    vigilarPausas = setInterval(() => {
      if (!pausaTareasPorDespliegue()) return;
      for (const callback of pausasActivas) callback();
    }, 500);
  }
  return () => {
    pausasActivas.delete(pausar);
    if (!pausasActivas.size && vigilarPausas) {
      clearInterval(vigilarPausas);
      vigilarPausas = null;
    }
  };
}
export function registrarTrabajo(): () => void {
  activas++;
  let terminado = false;
  return () => { if (!terminado) { terminado = true; activas--; } };
}
export function estadoDespliegue() { return { mantenimiento: enMantenimiento(), activas }; }

export const puertaDespliegue: MiddlewareHandler = async (c, next) => {
  // Estas consultas preparan o sanean metadatos Git; también deben drenarse.
  const preparaGit = /^\/api\/(?:tasks\/[^/]+\/diff|projects\/[^/]+(?:\/git)?)$/.test(c.req.path);
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !preparaGit) return next();
  // El usuario conserva la posibilidad de cancelar o cerrar sesión durante el drenado.
  const cancelar = /\/(?:detener|cancelar|logout)$/.test(c.req.path) || /^\/api\/tasks\/[^/]+\/cancel$/.test(c.req.path);
  if (enMantenimiento() && !cancelar) {
    c.header("Retry-After", "15");
    return c.json({ error: "servidor_actualizando", mensaje: "Telo está preparando una actualización. Tu trabajo se conserva; vuelve a enviar en unos segundos." }, 503);
  }
  const finalizar = registrarTrabajo();
  try { await next(); } finally { finalizar(); }
};
