import { Hono } from "hono";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, sep } from "node:path";
import { config } from "../config";
import { db } from "../db";

// Un proyecto es una carpeta del servidor dentro de TELO_PROYECTOS_DIR.
// Los chats y las tareas que lo usan trabajan dentro de esa carpeta.

export type ProjectRow = { id: string; name: string; repo_path: string; created_at: string };

export class ProjectPathError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 503,
  ) {
    super(code);
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

const COLUMNS = "id, name, repo_path, created_at";

export const projects = new Hono();

// GET /api/projects -> proyectos más recientes primero
projects.get("/projects", (c) => {
  const rows = db
    .query<ProjectRow, []>(`SELECT ${COLUMNS} FROM projects ORDER BY created_at DESC, rowid DESC`)
    .all();
  return c.json(rows);
});

// POST /api/projects  body: { path, name? }
// path: ruta relativa a TELO_PROYECTOS_DIR o absoluta dentro de ella.
projects.post("/projects", async (c) => {
  const body = await c.req
    .json<{ path?: string; name?: string }>()
    .catch(() => ({}) as { path?: string; name?: string });

  const name = body.name?.trim() ?? "";
  if (name.length > 60) return c.json({ error: "invalid_project_name" }, 400);

  let real: string;
  try {
    real = resolveProjectPath(body.path ?? "");
  } catch (err) {
    if (err instanceof ProjectPathError) return c.json({ error: err.code }, err.status);
    throw err;
  }

  const existing = db.query<{ id: string }, [string]>("SELECT id FROM projects WHERE repo_path = ?").get(real);
  if (existing) return c.json({ error: "project_exists" }, 409);

  const id = crypto.randomUUID();
  db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(
    id,
    name || basename(real),
    real,
  );
  const row = db.query<ProjectRow, [string]>(`SELECT ${COLUMNS} FROM projects WHERE id = ?`).get(id);
  return c.json(row, 201);
});

// DELETE /api/projects/:id  -> quita el registro; la carpeta en el servidor no se toca.
projects.delete("/projects/:id", (c) => {
  const result = db.query("DELETE FROM projects WHERE id = ?").run(c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "project_not_found" }, 404);
  return c.json({ ok: true });
});
