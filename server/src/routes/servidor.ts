import { Hono } from "hono";
import * as nodeFs from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { medirCarpeta } from "../archivos-proyecto";

// Estado del servidor para la página Servidor. Ninguna respuesta incluye rutas absolutas,
// nombre de equipo ni IPs: las carpetas se nombran por su función y los errores de herramientas se limpian.

type Disco = { totalBytes: number; usadoBytes: number; libreBytes: number };
type Carpeta = { nombre: string; bytes: number; archivos: number };

const CERO: Disco = { totalBytes: 0, usadoBytes: 0, libreBytes: 0 };
const TIEMPO_CACHE_MS = 30_000;
const TIEMPO_HERRAMIENTA_MS = 3_000;
const TIEMPO_DF_MS = 5_000;
const HERRAMIENTAS = ["opencode", "bwrap", "git", "bun"] as const;

// Entorno mínimo para los comandos de diagnóstico: nunca se pasan variables TELO_* ni claves.
function entornoMinimo(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    LC_ALL: "C.UTF-8",
  };
}

// Uso y capacidad del sistema de archivos. statfsSync si Bun lo tiene; si no, df -Pk.
async function discoDe(ruta: string | null): Promise<Disco> {
  if (!ruta) return { ...CERO };
  const statfs = (nodeFs as { statfsSync?: (p: string) => { bsize: number; blocks: number; bfree: number; bavail: number } })
    .statfsSync;
  if (typeof statfs === "function") {
    try {
      const s = statfs(ruta);
      const bloque = Number(s.bsize);
      return {
        totalBytes: Number(s.blocks) * bloque,
        usadoBytes: (Number(s.blocks) - Number(s.bfree)) * bloque,
        libreBytes: Number(s.bavail) * bloque,
      };
    } catch {
      return { ...CERO };
    }
  }
  return discoConDf(ruta);
}

async function discoConDf(ruta: string): Promise<Disco> {
  const proc = Bun.spawn(["df", "-Pk", ruta], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: entornoMinimo(),
  });
  const reloj = setTimeout(() => proc.kill(9), TIEMPO_DF_MS);
  try {
    const salida = await new Response(proc.stdout).text();
    await proc.exited;
    const columnas = (salida.trim().split("\n")[1] ?? "").trim().split(/\s+/);
    const [total, usado, libre] = [columnas[1], columnas[2], columnas[3]].map((v) => Number(v) * 1024);
    if (![total, usado, libre].every(Number.isFinite)) return { ...CERO };
    return { totalBytes: total, usadoBytes: usado, libreBytes: libre };
  } catch {
    return { ...CERO };
  } finally {
    clearTimeout(reloj);
  }
}

// Tamaño de la base de datos: el archivo principal y su registro de escritura (-wal).
function medirBaseDeDatos(datos: string): { bytes: number; archivos: number } {
  let bytes = 0;
  let archivos = 0;
  for (const nombre of ["orquestador.db", "orquestador.db-wal"]) {
    try {
      bytes += nodeFs.statSync(join(datos, nombre)).size;
      archivos++;
    } catch {
      // El archivo no existe todavía: no suma.
    }
  }
  return { bytes, archivos };
}

async function medirCarpetas(): Promise<Carpeta[]> {
  const datos = resolve(config.dataDir);
  const sinProyectos = { bytes: 0, archivos: 0, truncado: false };
  const [tareas, chat, respaldos, proyectos] = await Promise.all([
    medirCarpeta(join(datos, "tasks")),
    medirCarpeta(join(datos, "chat-workspace")),
    medirCarpeta(join(datos, "respaldos-migracion")),
    config.projectsDir ? medirCarpeta(resolve(config.projectsDir)) : Promise.resolve(sinProyectos),
  ]);
  const base = medirBaseDeDatos(datos);
  return [
    { nombre: "tareas", bytes: tareas.bytes, archivos: tareas.archivos },
    { nombre: "chat-workspace", bytes: chat.bytes, archivos: chat.archivos },
    { nombre: "respaldos-migracion", bytes: respaldos.bytes, archivos: respaldos.archivos },
    { nombre: "base de datos", bytes: base.bytes, archivos: base.archivos },
    { nombre: "proyectos", bytes: proyectos.bytes, archivos: proyectos.archivos },
  ];
}

let cacheCarpetas: { at: number; valor: Carpeta[] } | null = null;
async function carpetasCacheadas(): Promise<Carpeta[]> {
  if (cacheCarpetas && Date.now() - cacheCarpetas.at < TIEMPO_CACHE_MS) return cacheCarpetas.valor;
  const valor = await medirCarpetas();
  cacheCarpetas = { at: Date.now(), valor };
  return valor;
}

// Versión de una herramienta: primera línea, sin rutas. Nunca lanza error.
async function versionDe(nombre: string): Promise<{ disponible: boolean; version: string | null }> {
  if (nombre === "bun") return { disponible: true, version: Bun.version };
  if (Bun.which(nombre) === null) return { disponible: false, version: null };

  const proc = Bun.spawn([nombre, "--version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: entornoMinimo(),
  });
  const reloj = setTimeout(() => proc.kill(9), TIEMPO_HERRAMIENTA_MS);
  try {
    const [salida, error] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const primera = (salida || error).trim().split("\n")[0] ?? "";
    const limpia = primera
      .split(/\s+/)
      .filter((t) => t !== "" && !t.includes("/"))
      .join(" ")
      .slice(0, 80);
    return { disponible: true, version: limpia || null };
  } catch {
    return { disponible: true, version: null };
  } finally {
    clearTimeout(reloj);
  }
}

let cacheHerramientas: { at: number; valor: { nombre: string; version: string | null; disponible: boolean }[] } | null =
  null;
async function herramientasCacheadas() {
  if (cacheHerramientas && Date.now() - cacheHerramientas.at < TIEMPO_CACHE_MS) return cacheHerramientas.valor;
  const valor = await Promise.all(
    HERRAMIENTAS.map(async (nombre) => ({ nombre, ...(await versionDe(nombre)) })),
  );
  cacheHerramientas = { at: Date.now(), valor };
  return valor;
}

// Costos y tareas de los últimos 30 días y del mes calendario (UTC).
function costosYTareas() {
  const mes = db
    .query<{ n: number }, []>(
      "SELECT COALESCE(SUM(cost), 0) AS n FROM usage WHERE created_at >= datetime('now', 'start of month')",
    )
    .get()!.n;

  const treinta = db
    .query<{ costo: number; tokens: number; llamadas: number }, []>(
      `SELECT COALESCE(SUM(cost), 0) AS costo,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COUNT(*) AS llamadas
         FROM usage WHERE created_at >= datetime('now', '-30 days')`,
    )
    .get()!;

  const tareas30 = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tasks WHERE created_at >= datetime('now', '-30 days')")
    .get()!.n;

  const activas = db
    .query<{ status: string; n: number }, []>(
      "SELECT status, COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'running') GROUP BY status",
    )
    .all();

  return {
    costos: {
      mesUsd: Math.round(mes * 10_000) / 10_000,
      ultimos30dUsd: Math.round(treinta.costo * 10_000) / 10_000,
      llamadas30d: treinta.llamadas,
      tokens30d: treinta.tokens,
    },
    tareas: {
      ultimos30d: tareas30,
      en_cola: activas.find((r) => r.status === "queued")?.n ?? 0,
      en_curso: activas.find((r) => r.status === "running")?.n ?? 0,
    },
  };
}

export const servidor = new Hono();

// GET /api/servidor
servidor.get("/servidor", async (c) => {
  const [disco_datos, disco_proyectos, carpetas, herramientas] = await Promise.all([
    discoDe(resolve(config.dataDir)),
    discoDe(config.projectsDir ? resolve(config.projectsDir) : null),
    carpetasCacheadas(),
    herramientasCacheadas(),
  ]);

  return c.json({
    generado: new Date().toISOString(),
    proceso: {
      arrancado: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      segundosActivo: Math.round(process.uptime()),
      bun: Bun.version,
      rssMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
      plataforma: `${process.platform} ${process.arch}`,
    },
    disco: [
      { etiqueta: "datos", ...disco_datos },
      { etiqueta: "proyectos", ...disco_proyectos },
    ],
    carpetas,
    herramientas,
    ...costosYTareas(),
  });
});
