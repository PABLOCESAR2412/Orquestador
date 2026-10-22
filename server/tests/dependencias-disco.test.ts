import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependenciasRetirables, retirarDependencias } from "../src/dependencias-disco";
import { Database } from "bun:sqlite";

const temporal = mkdtempSync(join(tmpdir(), "telo-disco-"));
afterAll(() => rmSync(temporal, { recursive: true, force: true }));
function crearRepo(repo = mkdtempSync(join(temporal, "repo-"))) {
  mkdirSync(repo, { recursive: true });
  expect(Bun.spawnSync(["git", "init", repo]).exitCode).toBe(0);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repo, "package.json"), "{}");
  writeFileSync(join(repo, "bun.lock"), "{}");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "dependencia.js"), "regenerable");
  writeFileSync(join(repo, "trabajo.txt"), "conservar");
  return repo;
}
test("limpia solo dependencias ignoradas y conserva código y Git", async () => {
  const repo = crearRepo();
  expect(await dependenciasRetirables(repo)).toEqual([join(repo, "node_modules")]);
  expect(existsSync(join(repo, "node_modules"))).toBe(true);
  await retirarDependencias(repo);
  expect(existsSync(join(repo, "node_modules"))).toBe(false);
  expect(readFileSync(join(repo, "trabajo.txt"), "utf8")).toBe("conservar");
  expect(existsSync(join(repo, ".git"))).toBe(true);
});
test("sin lockfile conserva dependencias", async () => {
  const repo = crearRepo();
  rmSync(join(repo, "bun.lock"));
  expect(await dependenciasRetirables(repo)).toEqual([]);
});
test("conserva archivos registrados en Git dentro de dependencias", async () => {
  const repo = crearRepo();
  expect(Bun.spawnSync(["git", "-C", repo, "add", "-f", "node_modules/dependencia.js"]).exitCode).toBe(0);
  expect(await dependenciasRetirables(repo)).toEqual([]);
});
test(".opencode requiere su propio manifiesto y lockfile", async () => {
  const repo = crearRepo();
  const oc = join(repo, ".opencode");
  mkdirSync(join(oc, "node_modules"), { recursive: true });
  writeFileSync(join(oc, "node_modules", "plugin.js"), "plugin");
  writeFileSync(join(oc, "package.json"), "{}");
  expect(await dependenciasRetirables(repo)).toEqual([join(repo, "node_modules")]);
  writeFileSync(join(oc, "bun.lock"), "{}");
  expect((await dependenciasRetirables(repo)).sort()).toEqual([join(oc, "node_modules"), join(repo, "node_modules")].sort());
});
test("no sigue enlaces fuera del repo", async () => {
  const repo = crearRepo();
  const fuera = mkdtempSync(join(temporal, "fuera-"));
  mkdirSync(join(fuera, "node_modules"));
  symlinkSync(fuera, join(repo, "enlace"), process.platform === "win32" ? "junction" : "dir");
  await retirarDependencias(repo);
  expect(existsSync(join(fuera, "node_modules"))).toBe(true);
  expect(await dependenciasRetirables(join(repo, "enlace"))).toEqual([]);
});

test("respaldo omite dependencias reconstruibles y conserva entregables y código", async () => {
  const datos = mkdtempSync(join(temporal, "data-"));
  const destino = mkdtempSync(join(temporal, "backup-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const carpeta = join(datos, "tasks", id);
  mkdirSync(carpeta, { recursive: true });
  const repo = join(carpeta, "repo");
  mkdirSync(repo);
  expect(Bun.spawnSync(["git", "init", repo]).exitCode).toBe(0);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repo, "package.json"), "{}");
  writeFileSync(join(repo, "bun.lock"), "{}");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "paquete.js"), "regenerable");
  writeFileSync(join(repo, "codigo.ts"), "conservar");
  mkdirSync(join(datos, "entregables"));
  writeFileSync(join(datos, "entregables", "informe.txt"), "conservar");
  const db = new Database(join(datos, "orquestador.db"));
  db.exec("CREATE TABLE prueba (id INTEGER PRIMARY KEY)");
  db.close();
  const env = { ...process.env, DATA_DIR: datos, TELO_RESPALDOS_DIR: destino };
  for (const clave of Object.keys(env)) if (clave.startsWith("TELO_R2_")) delete (env as Record<string, string | undefined>)[clave];
  const proceso = Bun.spawn([process.execPath, "--no-env-file", "scripts/respaldo.ts"], { env, stdout: "pipe", stderr: "pipe" });
  const salida = await new Response(proceso.stderr).text();
  expect(await proceso.exited, salida).toBe(0);
  const { readdirSync } = await import("node:fs");
  const tar = readdirSync(destino).find(nombre => nombre.endsWith(".tar.gz"))!;
  const lista = Bun.spawnSync(["tar", "-tzf", join(destino, tar)]);
  expect(lista.exitCode).toBe(0);
  const nombres = lista.stdout.toString();
  expect(nombres).not.toContain("node_modules");
  expect(nombres).toContain("codigo.ts");
  expect(nombres).toContain("bun.lock");
  expect(nombres).toContain("informe.txt");
  expect(existsSync(join(repo, "node_modules", "paquete.js"))).toBe(true);
}, 30_000);

test("CLI solo propone tareas terminadas y no borra en simulación", async () => {
  const datos = mkdtempSync(join(temporal, "cli-"));
  const db = new Database(join(datos, "orquestador.db"));
  db.exec("CREATE TABLE tasks (id TEXT, status TEXT, finished_at TEXT)");
  const terminada = "22222222-2222-4222-8222-222222222222";
  const activa = "33333333-3333-4333-8333-333333333333";
  for (const [id, estado] of [[terminada, "done"], [activa, "running"]]) {
    db.query("INSERT INTO tasks VALUES (?, ?, datetime('now'))").run(id, estado);
    crearRepo(join(datos, "tasks", id!, "repo"));
  }
  db.close();
  const proceso = Bun.spawn([process.execPath, "--no-env-file", "scripts/optimizar-disco.ts"], {
    env: { ...process.env, DATA_DIR: datos }, stdout: "pipe", stderr: "pipe",
  });
  const salida = await new Response(proceso.stdout).text();
  expect(await proceso.exited).toBe(0);
  expect(salida).toContain(terminada);
  expect(salida).not.toContain(activa);
  for (const id of [terminada, activa]) expect(existsSync(join(datos, "tasks", id, "repo", "node_modules"))).toBe(true);
}, 30_000);
