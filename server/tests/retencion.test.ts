import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { config } = await import("../src/config");
const { gitOk } = await import("../src/git");
const { limpiarCopias } = await import("../src/workspace");
const tareas: string[] = [];

async function crearCopia() {
  const id = crypto.randomUUID();
  tareas.push(id);
  const repo = join(resolve(config.dataDir), "tasks", id, "repo");
  mkdirSync(repo, { recursive: true });
  const git = (args: string[]) => gitOk(args, { cwd: repo });
  await git(["init"]);
  await git(["config", "user.name", "Prueba"]);
  await git(["config", "user.email", "prueba@example.invalid"]);
  writeFileSync(join(repo, "archivo.txt"), "base\n");
  await git(["add", "."]);
  await git(["commit", "-m", "base"]);
  const base = (await git(["rev-parse", "HEAD"])).trim();
  db.query(
    `INSERT INTO tasks (id, title, prompt, model, status, finished_at, rama, base_commit)
    VALUES (?, 'Retención', 'Prueba', 'prueba', 'done', datetime('now', '-30 days'), ?, ?)`,
  ).run(id, `telo/${id.slice(0, 8)}`, base);
  return { id, repo, git };
}

afterAll(() => {
  for (const id of tareas) {
    db.query("DELETE FROM tasks WHERE id = ?").run(id);
    const carpeta = resolve(config.dataDir, "tasks", id);
    if (
      !carpeta.startsWith(resolve(config.dataDir, "tasks") + "/") &&
      !carpeta.startsWith(resolve(config.dataDir, "tasks") + "\\")
    ) {
      throw new Error("Carpeta de prueba fuera del directorio de tareas");
    }
    rmSync(carpeta, { recursive: true, force: true });
  }
});

describe("retención de copias antiguas", () => {
  test("borra una copia limpia sin trabajo nuevo", async () => {
    const { repo } = await crearCopia();
    await limpiarCopias();
    expect(existsSync(repo)).toBe(false);
  });

  test("conserva cambios de trabajo y archivos nuevos", async () => {
    const { repo } = await crearCopia();
    writeFileSync(join(repo, "archivo.txt"), "trabajo pendiente\n");
    writeFileSync(join(repo, "nuevo.txt"), "nuevo\n");
    await limpiarCopias();
    expect(existsSync(repo)).toBe(true);
  });

  test("conserva commits locales aunque el árbol esté limpio", async () => {
    const { repo, git } = await crearCopia();
    writeFileSync(join(repo, "archivo.txt"), "nuevo commit\n");
    await git(["add", "."]);
    await git(["commit", "-m", "pendiente"]);
    await limpiarCopias();
    expect(existsSync(repo)).toBe(true);
  });

  test("borra commits respaldados por una subida aprobada", async () => {
    const { id, repo, git } = await crearCopia();
    writeFileSync(join(repo, "archivo.txt"), "subido\n");
    await git(["add", "."]);
    await git(["commit", "-m", "subido"]);
    const sha = (await git(["rev-parse", "HEAD"])).trim();
    db.query(
      "INSERT INTO task_approvals (id, task_id, accion, commit_sha) VALUES (?, ?, 'push', ?)",
    ).run(crypto.randomUUID(), id, sha);
    await limpiarCopias();
    expect(existsSync(repo)).toBe(false);
  });

  test("conserva archivos ignorados y repositorios dañados", async () => {
    const { repo } = await crearCopia();
    writeFileSync(join(repo, ".git", "info", "exclude"), "ignorado.txt\n");
    writeFileSync(join(repo, "ignorado.txt"), "datos locales\n");
    await limpiarCopias();
    expect(existsSync(repo)).toBe(true);
    writeFileSync(join(repo, ".git", "HEAD"), "HEAD inválido\n");
    await limpiarCopias();
    expect(existsSync(repo)).toBe(true);
  });
});
