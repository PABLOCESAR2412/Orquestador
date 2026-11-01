import { Hono } from "hono";
import { db } from "../db";
import { redactar } from "../redaccion";

const MAX_TITULO = 120;
const MAX_CONTENIDO = 48 * 1024;
const MAX_NOTAS = 250;
const MAX_GRAFO = 12;

type Nota = {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function textoNormalizado(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function ambito(c: { req: { query(name: string): string | undefined } }): { projectId: string | null; error?: string } {
  const projectId = c.req.query("project_id")?.trim() || null;
  if (projectId && !db.query("SELECT 1 FROM projects WHERE id=?").get(projectId)) return { projectId: null, error: "project_not_found" };
  return { projectId };
}

async function cuerpo(c: { req: { header(name: string): string | undefined; text(): Promise<string> } }): Promise<Record<string, unknown> | null> {
  const declarado = Number(c.req.header("content-length") ?? 0);
  if (declarado > 64 * 1024) return null;
  const texto = await c.req.text().catch(() => null);
  if (texto === null || new TextEncoder().encode(texto).byteLength > 64 * 1024) return null;
  try {
    const value: unknown = JSON.parse(texto);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validarNota(title: unknown, content: unknown): { title: string; content: string } | null {
  if (typeof title !== "string" || typeof content !== "string") return null;
  const titulo = title.trim();
  const cuerpo = content.trim();
  if (!titulo || titulo.length > MAX_TITULO || new TextEncoder().encode(cuerpo).byteLength > MAX_CONTENIDO) return null;
  return { title: titulo, content: redactar(cuerpo) };
}

function resumen(content: string): string {
  return content.replace(/^---\s*[\s\S]*?\n---\s*/m, "").replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function vistaNota(nota: Nota) {
  return {
    id: nota.id,
    project_id: nota.project_id,
    title: nota.title,
    resumen: resumen(nota.content),
    created_at: nota.created_at,
    updated_at: nota.updated_at,
  };
}

export const cerebro = new Hono();

cerebro.get("/cerebro/notas", (c) => {
  const { projectId, error } = ambito(c);
  if (error) return c.json({ error }, 404);
  const query = (c.req.query("q") ?? "").trim().slice(0, 120);
  const filas = db.query<Nota, [string | null, number]>(
    "SELECT id,project_id,title,content,created_at,updated_at FROM brain_notes WHERE project_id IS ? ORDER BY updated_at DESC,rowid DESC LIMIT ?",
  ).all(projectId, MAX_NOTAS);
  const terminos = textoNormalizado(query).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2).slice(0, 12);
  const notas = terminos.length
    ? filas.map((nota) => {
        const titulo = textoNormalizado(nota.title);
        const contenido = textoNormalizado(nota.content);
        const score = terminos.reduce((suma, token) => suma + (titulo.includes(token) ? 5 : 0) + (contenido.includes(token) ? 1 : 0), 0);
        return { nota, score };
      }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.nota.updated_at.localeCompare(a.nota.updated_at)).map((item) => item.nota)
    : filas;
  return c.json({ notas: notas.map(vistaNota), total: filas.length, busqueda: "local" });
});

cerebro.get("/cerebro/grafo", (c) => {
  const { projectId, error } = ambito(c);
  if (error) return c.json({ error }, 404);
  const consultadas = db.query<Nota, [string | null, number]>(
    "SELECT id,project_id,title,content,created_at,updated_at FROM brain_notes WHERE project_id IS ? ORDER BY updated_at DESC,rowid DESC LIMIT ?",
  ).all(projectId, MAX_GRAFO + 1);
  const notas = consultadas.slice(0, MAX_GRAFO);
  const porTitulo = new Map<string, Nota>();
  for (const nota of notas) porTitulo.set(textoNormalizado(nota.title), nota);
  const enlaces: { source: string; target: string; label: string }[] = [];
  for (const nota of notas) {
    for (const match of nota.content.matchAll(/\[\[([^\]]{1,120})\]\]/g)) {
      const targetName = textoNormalizado((match[1] ?? "").split("|")[0]!.trim());
      const destino = porTitulo.get(targetName);
      if (destino && destino.id !== nota.id) enlaces.push({ source: nota.id, target: destino.id, label: match[1]!.slice(0, 120) });
    }
  }
  return c.json({ nodos: notas.map(({ id, title }) => ({ id, title })), enlaces, limitado: consultadas.length > MAX_GRAFO });
});

cerebro.get("/cerebro/notas/:id", (c) => {
  const nota = db.query<Nota, [string]>("SELECT id,project_id,title,content,created_at,updated_at FROM brain_notes WHERE id=?").get(c.req.param("id"));
  return nota ? c.json(nota) : c.json({ error: "note_not_found" }, 404);
});

cerebro.post("/cerebro/notas", async (c) => {
  const body = await cuerpo(c);
  const validada = body && validarNota(body.title, body.content);
  if (!body || !validada) return c.json({ error: "invalid_note" }, 400);
  const projectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
  if (projectId && !db.query("SELECT 1 FROM projects WHERE id=?").get(projectId)) return c.json({ error: "project_not_found" }, 404);
  const id = crypto.randomUUID();
  db.query("INSERT INTO brain_notes (id,project_id,title,content) VALUES (?,?,?,?)").run(id, projectId, validada.title, validada.content);
  return c.json(db.query<Nota, [string]>("SELECT id,project_id,title,content,created_at,updated_at FROM brain_notes WHERE id=?").get(id), 201);
});

cerebro.put("/cerebro/notas/:id", async (c) => {
  const body = await cuerpo(c);
  const validada = body && validarNota(body.title, body.content);
  if (!body || !validada) return c.json({ error: "invalid_note" }, 400);
  const guardada = db.query("UPDATE brain_notes SET title=?,content=?,updated_at=datetime('now') WHERE id=?").run(validada.title, validada.content, c.req.param("id"));
  if (!guardada.changes) return c.json({ error: "note_not_found" }, 404);
  return c.json(db.query<Nota, [string]>("SELECT id,project_id,title,content,created_at,updated_at FROM brain_notes WHERE id=?").get(c.req.param("id")));
});

cerebro.delete("/cerebro/notas/:id", (c) => {
  const resultado = db.query("DELETE FROM brain_notes WHERE id=?").run(c.req.param("id"));
  return resultado.changes ? c.json({ ok: true }) : c.json({ error: "note_not_found" }, 404);
});
