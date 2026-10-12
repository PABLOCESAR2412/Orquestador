import { Hono, type Context } from "hono";
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { config } from "../config";
import { db } from "../db";
import { gitOk, gitSeguro, esRepositorio, GitError, prepararRepoSeguro, tieneGitReal } from "../git";
import { ArchivoError, leerArchivo, listarCarpeta, medirCarpeta, normalizarRuta } from "../archivos-proyecto";
import { redactar } from "../redaccion";
import { conProyectoRevisado } from "../ocupacion";
import { ARCHIVOS_GUIA, componerInstrucciones, guardarMemoria } from "../memoria";

// Un proyecto es una carpeta del servidor dentro de TELO_PROYECTOS_DIR.
// Los chats y las tareas que lo usan trabajan dentro de esa carpeta.

export type ProjectRow = {
  id: string;
  name: string;
  repo_path: string;
  pinned_at: string | null;
  created_at: string;
  instrucciones: string | null;
  memoria: string | null;
  memoria_actualizada_en: string | null;
};

export class ProjectPathError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 503,
  ) {
    super(code);
  }
}

const MAX_NOMBRE = 60;
const MAX_INSTRUCCIONES = 8000;
const MAX_CUERPO_BYTES = 64 * 1024;

// Lee el cuerpo como objeto JSON de hasta maxBytes. Devuelve null si no es un objeto válido.
// Quien llama responde 400 invalid_body.
export async function leerCuerpoJson<T extends object>(c: Context, maxBytes = MAX_CUERPO_BYTES): Promise<T | null> {
  const declarado = Number(c.req.header("content-length") ?? 0);
  if (declarado > maxBytes) return null;
  const texto = await c.req.text().catch(() => null);
  if (texto === null || new TextEncoder().encode(texto).byteLength > maxBytes) return null;
  try {
    const valor: unknown = JSON.parse(texto);
    return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? (valor as T) : null;
  } catch {
    return null;
  }
}

// Resuelve una ruta dentro de la carpeta de proyectos. Acepta una ruta relativa a esa
// carpeta o una absoluta que esté dentro. Sigue enlaces simbólicos y rechaza cualquier
// ruta que salga de la raíz.
export function resolveProjectPath(input: string): string {
  const root = config.projectsDir;
  if (!root) throw new ProjectPathError("projects_root_not_configured", 503);

  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    throw new ProjectPathError("projects_root_not_configured", 503);
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\0")) throw new ProjectPathError("invalid_project_path", 400);

  const candidate = isAbsolute(trimmed) ? trimmed : join(rootReal, trimmed);
  if (!existsSync(candidate)) throw new ProjectPathError("project_path_not_found", 400);

  const real = realpathSync(candidate);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    throw new ProjectPathError("project_path_outside_root", 400);
  }
  if (!statSync(real).isDirectory()) throw new ProjectPathError("project_path_not_directory", 400);
  return real;
}

// Devuelve la carpeta de un proyecto registrado, o null si no existe.
export function projectRepoPath(id: string): string | null {
  const row = db
    .query<{ repo_path: string | null }, [string]>("SELECT repo_path FROM projects WHERE id = ?")
    .get(id);
  return row?.repo_path ?? null;
}

// Nombre de carpeta: sin acentos, minúsculas, [a-z0-9-], sin guiones al inicio o final, máximo 60.
// Vacío si no queda ningún carácter válido.
export function slugProyecto(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NOMBRE)
    .replace(/-+$/, "");
}

const COLUMNS = "id, name, repo_path, pinned_at, created_at, instrucciones, memoria, memoria_actualizada_en";

function raizReal(): string | null {
  if (!config.projectsDir) return null;
  try {
    return realpathSync(config.projectsDir);
  } catch {
    return null;
  }
}

// La API no expone rutas absolutas: repo_path es la ruta dentro de la carpeta de proyectos.
function aProyecto(row: ProjectRow) {
  const raiz = raizReal();
  const repo_path =
    raiz && row.repo_path.startsWith(raiz + sep)
      ? relative(raiz, row.repo_path).split(sep).join("/")
      : basename(row.repo_path);
  return {
    id: row.id,
    name: row.name,
    repo_path,
    pinned_at: row.pinned_at,
    created_at: row.created_at,
    instrucciones: row.instrucciones,
    carpeta: basename(row.repo_path),
  };
}

function leerProyecto(id: string): ProjectRow | null {
  return db.query<ProjectRow, [string]>(`SELECT ${COLUMNS} FROM projects WHERE id = ?`).get(id) ?? null;
}

// Tarea tal como la ve la API (mismos campos que Task del contrato).
const TAREA_API =
  "t.id, t.title, t.prompt, t.model, t.effort, t.status, t.result, t.error, t.project_id, t.retry_of, " +
  "(t.provider_session_id IS NOT NULL) AS reanudable, t.created_at, t.started_at, t.finished_at, " +
  "t.rama, t.base_commit, p.name AS project_name";

export function leerTareaApi(id: string) {
  const row = db
    .query<Record<string, unknown> & { reanudable: number }, [string]>(
      `SELECT ${TAREA_API} FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
    )
    .get(id);
  return row ? { ...row, reanudable: row.reanudable === 1 } : null;
}

function sanearDetalle(texto: string, raiz: string): string {
  return redactar(texto.split(raiz).join("<carpeta>").replace(/\/[^\s:'"]+/g, "<ruta>")).slice(0, 300);
}

// Datos de Git de la carpeta del proyecto, o null si no hay un .git propio o si un chat o una tarea
// la está usando (en ese caso no se lee Git: el agente podría estar escribiéndolo).
async function datosGit(carpeta: string, projectId: string) {
  if (!tieneGitReal(carpeta)) return null;
  return conProyectoRevisado(projectId, () => leerDatosGit(carpeta));
}

async function leerDatosGit(carpeta: string) {
  if (!(await prepararRepoSeguro(carpeta)) || !(await esRepositorio(carpeta))) return null;
  const opts = { cwd: carpeta, timeoutMs: 10_000 };

  const rama = (await gitSeguro(["symbolic-ref", "--short", "-q", "HEAD"], opts)).stdout.trim() || "HEAD";
  const conteo = await gitSeguro(["rev-list", "--count", "HEAD"], opts);
  const commits = conteo.code === 0 ? Number(conteo.stdout.trim()) || 0 : 0;

  const ultimo = await gitSeguro(["log", "-1", "--format=%H%x1f%s%x1f%cI"], opts);
  let ultimo_commit: { sha: string; asunto: string; fecha: string } | null = null;
  if (ultimo.code === 0 && ultimo.stdout.trim()) {
    const [sha, asunto, fecha] = ultimo.stdout.trim().split("\x1f");
    ultimo_commit = { sha, asunto, fecha };
  }

  const estado = await gitSeguro(["status", "--porcelain"], opts);
  return { rama, commits, ultimo_commit, sucio: estado.code === 0 && estado.stdout.trim() !== "" };
}

export const projects = new Hono();

// GET /api/projects -> anclados primero; luego los más recientes
projects.get("/projects", (c) => {
  const rows = db
    .query<ProjectRow, []>(
      `SELECT ${COLUMNS} FROM projects ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC, rowid DESC`,
    )
    .all();
  return c.json(rows.map(aProyecto));
});

// POST /api/projects  body: { name } crea una carpeta nueva con Git y un README.
// Compatibilidad: { path, name? } registra una carpeta que ya existe dentro de la raíz.
projects.post("/projects", async (c) => {
  const body = await leerCuerpoJson<{ name?: unknown; path?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  if (typeof body.path === "string") return registrarExistente(c, body.path, body.name);
  return crearProyecto(c, body.name);
});

function registrarExistente(c: Context, path: string, name: unknown) {
  const nombre = typeof name === "string" ? name.trim() : "";
  if (nombre.length > MAX_NOMBRE) return c.json({ error: "invalid_project_name" }, 400);

  let real: string;
  try {
    real = resolveProjectPath(path);
  } catch (err) {
    if (err instanceof ProjectPathError) return c.json({ error: err.code }, err.status);
    throw err;
  }

  // La raíz de proyectos no es un proyecto: sus carpetas sí. Registrarla daría acceso a todas.
  if (real === raizReal()) return c.json({ error: "invalid_project_path" }, 400);

  const existing = db.query<{ id: string }, [string]>("SELECT id FROM projects WHERE repo_path = ?").get(real);
  if (existing) return c.json({ error: "project_exists" }, 409);

  const id = crypto.randomUUID();
  db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(id, nombre || basename(real), real);
  return c.json(aProyecto(leerProyecto(id)!), 201);
}

async function crearProyecto(c: Context, name: unknown) {
  const nombre = typeof name === "string" ? name.trim() : "";
  if (!nombre || nombre.length > MAX_NOMBRE) return c.json({ error: "invalid_project_name" }, 400);

  const carpeta = slugProyecto(nombre);
  if (!carpeta) return c.json({ error: "invalid_project_name" }, 400);

  const raiz = config.projectsDir;
  if (!raiz) return c.json({ error: "projects_root_not_configured" }, 503);

  let rootReal: string;
  try {
    mkdirSync(raiz, { recursive: true });
    rootReal = realpathSync(raiz);
  } catch {
    return c.json({ error: "projects_root_not_configured" }, 503);
  }

  const destino = join(rootReal, carpeta);
  if (existsSync(destino)) return c.json({ error: "project_folder_exists" }, 409);
  if (db.query("SELECT id FROM projects WHERE repo_path = ?").get(destino)) {
    return c.json({ error: "project_exists" }, 409);
  }

  try {
    mkdirSync(destino);
  } catch {
    return c.json({ error: "project_folder_exists" }, 409);
  }

  // A partir de aquí, si algo falla se borra la carpeta que acabamos de crear.
  try {
    await gitOk(["init", "-b", "main"], { cwd: destino });
    writeFileSync(join(destino, "README.md"), `# ${nombre}\n`);
    await gitOk(["add", "--", "README.md"], { cwd: destino });
    await gitOk(
      [
        "-c", "user.name=Telo",
        "-c", "user.email=telo@localhost",
        "-c", "commit.gpgsign=false",
        "commit", "-m", "Proyecto creado",
      ],
      { cwd: destino },
    );
  } catch (err) {
    rmSync(destino, { recursive: true, force: true });
    const texto = err instanceof GitError || err instanceof Error ? err.message : String(err);
    return c.json({ error: "git_failed", detail: sanearDetalle(texto, rootReal) }, 500);
  }

  const id = crypto.randomUUID();
  try {
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(id, nombre, destino);
  } catch (err) {
    rmSync(destino, { recursive: true, force: true });
    throw err;
  }
  return c.json(aProyecto(leerProyecto(id)!), 201);
}

// GET /api/projects/:id -> chats, tareas por estado, última tarea, Git y tamaño.
projects.get("/projects/:id", async (c) => {
  const row = leerProyecto(c.req.param("id"));
  if (!row) return c.json({ error: "project_not_found" }, 404);
  const id = row.id;

  const chats = db
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM conversations WHERE project_id = ?")
    .get(id)!.n;

  const tareas = db
    .query<{ total: number; en_curso: number; fallidas: number; hechas: number }, [string]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status IN ('queued', 'running')), 0) AS en_curso,
              COALESCE(SUM(status = 'failed'), 0) AS fallidas,
              COALESCE(SUM(status = 'done'), 0) AS hechas
         FROM tasks WHERE project_id = ?`,
    )
    .get(id)!;

  const ultima = db
    .query<{ id: string }, [string]>("SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(id);

  const [datos, medida] = await Promise.all([datosGit(row.repo_path, id), medirCarpeta(row.repo_path)]);

  return c.json({
    project: aProyecto(row),
    chats,
    tareas,
    ultima_tarea: ultima ? leerTareaApi(ultima.id) : null,
    git: datos,
    tamano_bytes: medida.bytes,
    memoria: { texto: row.memoria, actualizada_en: row.memoria_actualizada_en },
  });
});

// DELETE /api/projects/:id  -> quita el registro; la carpeta en el servidor no se toca.
projects.delete("/projects/:id", (c) => {
  const result = db.query("DELETE FROM projects WHERE id = ?").run(c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "project_not_found" }, 404);
  return c.json({ ok: true });
});

// PATCH /api/projects/:id  body: { name?, pinned?, instrucciones? }
// Renombrar o anclar no cambia la carpeta. instrucciones "" (o null) la borra.
projects.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  if (!leerProyecto(id)) return c.json({ error: "project_not_found" }, 404);

  const body = await leerCuerpoJson<{ name?: unknown; pinned?: unknown; instrucciones?: unknown }>(c);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  let nombre: string | undefined;
  if (body.name !== undefined) {
    nombre = typeof body.name === "string" ? body.name.trim() : "";
    if (!nombre || nombre.length > MAX_NOMBRE) return c.json({ error: "invalid_project_name" }, 400);
  }
  if (body.pinned !== undefined && typeof body.pinned !== "boolean") return c.json({ error: "invalid_body" }, 400);

  let instrucciones: string | null | undefined;
  if (body.instrucciones !== undefined) {
    if (body.instrucciones === null) {
      instrucciones = null;
    } else if (typeof body.instrucciones !== "string" || body.instrucciones.length > MAX_INSTRUCCIONES) {
      return c.json({ error: "invalid_instrucciones" }, 400);
    } else {
      instrucciones = body.instrucciones.trim() || null;
    }
  }

  db.transaction(() => {
    if (nombre !== undefined) db.query("UPDATE projects SET name = ? WHERE id = ?").run(nombre, id);
    if (typeof body.pinned === "boolean") {
      db.query(
        "UPDATE projects SET pinned_at = CASE WHEN ? THEN COALESCE(pinned_at, datetime('now')) ELSE NULL END WHERE id = ?",
      ).run(body.pinned ? 1 : 0, id);
    }
    if (instrucciones !== undefined) db.query("UPDATE projects SET instrucciones = ? WHERE id = ?").run(instrucciones, id);
  })();

  return c.json(aProyecto(leerProyecto(id)!));
});

// Respuesta de error de las rutas de archivos: código y estado.
function errorArchivo(c: Context, err: unknown) {
  if (err instanceof ArchivoError) return c.json({ error: err.code }, err.status);
  throw err;
}

// GET /api/projects/:id/archivos?ruta=  -> listado de una carpeta del proyecto
projects.get("/projects/:id/archivos", (c) => {
  const row = leerProyecto(c.req.param("id"));
  if (!row) return c.json({ error: "project_not_found" }, 404);
  try {
    const segmentos = normalizarRuta(c.req.query("ruta"));
    return c.json({ ruta: segmentos.join("/"), entradas: listarCarpeta(row.repo_path, segmentos) });
  } catch (err) {
    return errorArchivo(c, err);
  }
});

// GET /api/projects/:id/archivo?ruta=  -> texto de un archivo (hasta 256 KB)
projects.get("/projects/:id/archivo", (c) => {
  const row = leerProyecto(c.req.param("id"));
  if (!row) return c.json({ error: "project_not_found" }, 404);
  try {
    const segmentos = normalizarRuta(c.req.query("ruta"));
    return c.json(leerArchivo(row.repo_path, segmentos));
  } catch (err) {
    return errorArchivo(c, err);
  }
});

// GET /api/projects/:id/instrucciones/sugeridas -> texto con AGENTS.md, CLAUDE.md y README.md del repo.
// Solo sugiere: el dueño lo revisa en el campo de instrucciones y lo guarda él. Nada se escribe aquí.
projects.get("/projects/:id/instrucciones/sugeridas", (c) => {
  const row = leerProyecto(c.req.param("id"));
  if (!row) return c.json({ error: "project_not_found" }, 404);

  const docs: { nombre: string; texto: string }[] = [];
  for (const nombre of ARCHIVOS_GUIA) {
    try {
      docs.push({ nombre, texto: leerArchivo(row.repo_path, [nombre]).texto });
    } catch (err) {
      // Un archivo que no existe no es un error: se prueba el siguiente.
      if (!(err instanceof ArchivoError)) throw err;
    }
  }

  const { texto, fuentes } = componerInstrucciones(docs, MAX_INSTRUCCIONES);
  if (!texto) return c.json({ error: "sin_guias" }, 404);
  return c.json({ texto, fuentes });
});

// DELETE /api/projects/:id/memoria -> borra la memoria aprendida. La siguiente tarea empieza sin ella.
projects.delete("/projects/:id/memoria", (c) => {
  const id = c.req.param("id");
  if (!leerProyecto(id)) return c.json({ error: "project_not_found" }, 404);
  guardarMemoria(id, null);
  return c.json({ ok: true });
});
