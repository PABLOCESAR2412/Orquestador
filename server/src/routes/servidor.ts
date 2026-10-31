import { Hono } from "hono";
import * as nodeFs from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { medirCarpeta } from "../archivos-proyecto";
import { redactar } from "../redaccion";
import { hallarEjecutable } from "../ejecutable";
import { MAX_TAREAS_SIMULTANEAS } from "../limites";
import { estadoMantenimiento, guardarPoliticaDisco, mantenerDisco, validarPoliticaDisco } from "../mantenimiento-disco";


// Estado del servidor para la página Servidor. Ninguna respuesta incluye rutas absolutas,
// nombre de equipo ni IPs: las carpetas se nombran por su función y los errores de herramientas se limpian.

type Disco = { totalBytes: number; usadoBytes: number; libreBytes: number };
type Carpeta = { nombre: string; bytes: number; archivos: number; truncado: boolean };

const CERO: Disco = { totalBytes: 0, usadoBytes: 0, libreBytes: 0 };
const TIEMPO_CACHE_MS = 30_000;
const TIEMPO_HERRAMIENTA_MS = 3_000;
const TIEMPO_DF_MS = 5_000;
const MAX_ENTRADAS_ALMACENAMIENTO = 250_000;
const HERRAMIENTAS = ["opencode", "codex", "agy", "script", "bwrap", "git", "bun", "node", "ffmpeg", "ffprobe"] as const;
const RAIZ_REPOSITORIO = resolve(import.meta.dir, "../../..");

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
  const medir = (ruta: string) => medirCarpeta(ruta, MAX_ENTRADAS_ALMACENAMIENTO);
  const [tareas, chat, respaldos, proyectos, perfiles, entregables, adjuntos] = await Promise.all([
    medir(join(datos, "tasks")),
    medir(join(datos, "chat-workspace")),
    medir(join(datos, "respaldos-migracion")),
    config.projectsDir ? medir(resolve(config.projectsDir)) : Promise.resolve(sinProyectos),
    medir(join(datos, "perfiles-opencode")),
    medir(join(datos, "entregables")),
    medir(join(datos, "chat-attachments")),
  ]);
  const base = medirBaseDeDatos(datos);
  return [
    { nombre: "tareas", ...tareas },
    { nombre: "chat-workspace", ...chat },
    { nombre: "respaldos-migracion", ...respaldos },
    { nombre: "base de datos", ...base, truncado: false },
    { nombre: "proyectos", ...proyectos },
    { nombre: "sesiones de agentes", ...perfiles },
    { nombre: "entregables", ...entregables },
    { nombre: "adjuntos", ...adjuntos },
  ];
}

let cacheCarpetas: { at: number; valor: Carpeta[] } | null = null;
let medicionCarpetas: Promise<Carpeta[]> | null = null;
async function carpetasCacheadas(): Promise<Carpeta[]> {
  if (cacheCarpetas && Date.now() - cacheCarpetas.at < TIEMPO_CACHE_MS) return cacheCarpetas.valor;
  // El recorrido puede medir cientos de miles de entradas. Comparte la medición si varias
  // solicitudes de estado llegan a la vez, en vez de multiplicar el I/O del servidor.
  medicionCarpetas ??= medirCarpetas()
    .then((valor) => {
      cacheCarpetas = { at: Date.now(), valor };
      return valor;
    })
    .finally(() => { medicionCarpetas = null; });
  return medicionCarpetas;
}

// Versión de una herramienta: primera línea, sin rutas. Nunca lanza error.
async function versionDe(nombre: string): Promise<{ disponible: boolean; version: string | null }> {
  if (nombre === "bun") return { disponible: true, version: Bun.version };
  if (hallarEjecutable(nombre) === null) return { disponible: false, version: null };

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

let cacheCommit: { at: number; valor: string | null } | null = null;
async function commitDelServidor(): Promise<string | null> {
  if (cacheCommit && Date.now() - cacheCommit.at < TIEMPO_CACHE_MS) return cacheCommit.valor;
  const resultado = await ejecutarFijo(["git", "-C", RAIZ_REPOSITORIO, "rev-parse", "--short=12", "HEAD"]);
  const commit = resultado?.codigo === 0 ? resultado.salida.trim().split("\n")[0] : "";
  const valor = /^[0-9a-f]{7,40}$/i.test(commit) ? commit : null;
  cacheCommit = { at: Date.now(), valor };
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
      "SELECT status, COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'analyzing', 'running') GROUP BY status",
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
      en_curso: activas.filter((r) => r.status === "analyzing" || r.status === "running").reduce((suma, fila) => suma + fila.n, 0),
      max_simultaneas: MAX_TAREAS_SIMULTANEAS,
    },
  };
}

export const servidor = new Hono();

servidor.get("/servidor/limpieza", c => c.json(estadoMantenimiento()));
servidor.put("/servidor/limpieza", async c => {
  const p = await c.req.json().catch(() => null);
  if (!validarPoliticaDisco(p)) return c.json({ error: "invalid_request", mensaje: "Revisa los límites de la limpieza." }, 400);
  guardarPoliticaDisco(p);
  return c.json(estadoMantenimiento());
});
servidor.post("/servidor/limpieza", async c => {
  const datos = await c.req.json().catch(() => null);
  if (!datos || !["analizar", "limpiar"].includes(datos.modo) || (datos.modo === "limpiar" && datos.confirmar !== true)) {
    return c.json({ error: "invalid_request", mensaje: "Confirma la limpieza de dependencias regenerables." }, 400);
  }
  const resultado = await mantenerDisco(datos.modo);
  if (!resultado) return c.json({ error: "conflict", mensaje: "Ya hay una revisión de almacenamiento en curso." }, 409);
  return c.json(resultado);
});

// GET /api/servidor
servidor.get("/servidor", async (c) => {
  const [disco_datos, disco_proyectos, carpetas, herramientas, commit] = await Promise.all([
    discoDe(resolve(config.dataDir)),
    discoDe(config.projectsDir ? resolve(config.projectsDir) : null),
    carpetasCacheadas(),
    herramientasCacheadas(),
    commitDelServidor(),
  ]);

  return c.json({
    generado: new Date().toISOString(),
    proceso: {
      arrancado: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      segundosActivo: Math.round(process.uptime()),
      bun: Bun.version,
      commit,
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

// Servicio y registros. Ambos leen el sistema con comandos fijos y sin shell. El entorno es el mínimo,
// así que ninguna variable del servidor llega a estos comandos. Fuera de systemd (desarrollo) responden
// "no disponible" en vez de fallar.

const SERVICIO = "orquestador";
const TIEMPO_COMANDO_MS = 4_000;
const LINEAS_POR_DEFECTO = 100;
const LINEAS_MAXIMAS = 300;

type Servicio = { disponible: boolean; activo: string | null; subestado: string | null; desde: string | null; pid: number | null };

// Ejecuta un comando con tiempo límite. Devuelve null si el programa no existe o no se puede lanzar.
async function ejecutarFijo(argv: string[]): Promise<{ codigo: number; salida: string } | null> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: entornoMinimo() });
  } catch {
    return null;
  }
  const reloj = setTimeout(() => proc.kill(9), TIEMPO_COMANDO_MS);
  try {
    const [salida, errores, codigo] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { codigo, salida: salida + errores };
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

export async function estadoDelServicio(): Promise<Servicio> {
  const r = await ejecutarFijo([
    "systemctl",
    "show",
    SERVICIO,
    "-p",
    "ActiveState,SubState,ActiveEnterTimestamp,MainPID",
    "--no-pager",
  ]);
  if (!r || r.codigo !== 0) return { disponible: false, activo: null, subestado: null, desde: null, pid: null };
  const campos = new Map(
    r.salida
      .split("\n")
      .map((linea) => linea.split("="))
      .filter((p) => p.length >= 2)
      .map(([clave, ...resto]) => [clave, resto.join("=")]),
  );
  const pid = Number(campos.get("MainPID"));
  return {
    disponible: true,
    activo: campos.get("ActiveState") ?? null,
    subestado: campos.get("SubState") ?? null,
    desde: campos.get("ActiveEnterTimestamp") || null,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
  };
}

export type RegistrosResultado =
  | { ok: true; texto: string }
  | { ok: false; motivo: "registros_no_disponibles" | "sin_permiso_diario" };

// Últimas líneas del diario de la unidad. La salida se redacta antes de salir del servidor.
export async function registrosDelServicio(lineas: number): Promise<RegistrosResultado> {
  const r = await ejecutarFijo([
    "journalctl",
    "-u",
    SERVICIO,
    "-n",
    String(lineas),
    "--no-pager",
    "-o",
    "short-iso",
  ]);
  if (!r) return { ok: false, motivo: "registros_no_disponibles" };
  if (r.codigo !== 0) return { ok: false, motivo: "sin_permiso_diario" };
  const secretos = [process.env.TELO_CLAVE, process.env.TELO_CLAVE_CIFRADO].filter((v): v is string => !!v);
  return { ok: true, texto: redactar(r.salida, secretos) };
}

// GET /api/servidor/servicio -> estado de la unidad orquestador en systemd
servidor.get("/servidor/servicio", async (c) => c.json(await estadoDelServicio()));

// GET /api/servidor/logs?lineas=100 -> últimas líneas del registro (máximo 300)
servidor.get("/servidor/logs", async (c) => {
  const pedidas = Number(c.req.query("lineas") ?? LINEAS_POR_DEFECTO);
  const lineas = Number.isInteger(pedidas) ? Math.min(LINEAS_MAXIMAS, Math.max(1, pedidas)) : LINEAS_POR_DEFECTO;
  const r = await registrosDelServicio(lineas);
  if (!r.ok) return c.json({ error: r.motivo }, 503);
  return c.json({ lineas, texto: r.texto, generado: new Date().toISOString() });
});
