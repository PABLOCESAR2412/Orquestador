import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "../src/db";
import { config } from "../src/config";
import { correspondeLimpieza, estadoMantenimiento, guardarPoliticaDisco, mantenerDisco, validarPoliticaDisco } from "../src/mantenimiento-disco";
import { ocuparConversacion, liberarConversacion } from "../src/ocupacion";
import { servidor } from "../src/routes/servidor";

const ids: string[] = [];
function crearTarea(status = "done", dias = 10, conversacion: string | null = null) {
  const id = crypto.randomUUID(); ids.push(id);
  db.query("INSERT INTO tasks (id,title,prompt,model,status,finished_at,conversation_id) VALUES (?,'Disco','Prueba','prueba',?,datetime('now',?),?)").run(id, status, `-${dias} days`, conversacion);
  const repo = resolve(config.dataDir, "tasks", id, "repo");
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  const git = Bun.spawnSync(["git", "init", repo]);
  expect(git.exitCode).toBe(0);
  writeFileSync(join(repo, "package.json"), "{}"); writeFileSync(join(repo, "bun.lock"), "{}");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repo, "node_modules", "paquete.js"), "regenerable");
  writeFileSync(join(repo, "trabajo.txt"), "conservar");
  return { id, repo };
}
afterAll(() => {
  for (const id of ids) { db.query("DELETE FROM tasks WHERE id=?").run(id); rmSync(resolve(config.dataDir, "tasks", id), { recursive: true, force: true }); }
});
test("política persistente, desactivada por defecto y límites estrictos", () => {
  expect(estadoMantenimiento().politica.automatica).toBe(false);
  const p = { automatica: true, umbral: 85, intervaloHoras: 24, antiguedadDias: 7 };
  for (const cambio of [{ umbral: 100 }, { intervaloHoras: 0 }, { antiguedadDias: -1 }, { automatica: "si" }, { otro: true }]) expect(validarPoliticaDisco({ ...p, ...cambio })).toBe(false);
  guardarPoliticaDisco(p); expect(estadoMantenimiento().politica).toEqual(p);
  guardarPoliticaDisco({ ...p, automatica: false });
});
test("dispara por umbral o intervalo y limita reintentos a una hora", () => {
  const p = { automatica: true, umbral: 85, intervaloHoras: 24, antiguedadDias: 7 };
  const ahora = Date.now(), hace = (horas: number) => new Date(ahora - horas * 3600_000).toISOString();
  expect(correspondeLimpieza(p, hace(2), 90, ahora)).toBe(true);
  expect(correspondeLimpieza(p, hace(25), 46, ahora)).toBe(true);
  expect(correspondeLimpieza(p, hace(0.5), 99, ahora)).toBe(false);
  expect(correspondeLimpieza(p, hace(2), 46, ahora)).toBe(false);
  expect(correspondeLimpieza({ ...p, automatica: false }, null, 99)).toBe(false);
});
test("simula sin borrar, limpia antiguas y conserva activas, recientes y chats ocupados", async () => {
  const cid = crypto.randomUUID();
  db.query("INSERT INTO conversations (id,title) VALUES (?,'Prueba disco')").run(cid);
  const antigua = crearTarea(), activa = crearTarea("running"), reciente = crearTarea("done", 0), chat = crearTarea("done", 10, cid);
  ocuparConversacion(cid);
  try {
    const revision = await mantenerDisco("analizar");
    expect(revision?.carpetas).toBe(1); expect(existsSync(join(antigua.repo, "node_modules"))).toBe(true);
    const limpieza = mantenerDisco("limpiar");
    expect(await mantenerDisco("limpiar")).toBe(null);
    const r = await limpieza;
    expect(r?.carpetas).toBe(1); expect(r?.ocupadas).toBe(1);
    expect(existsSync(join(antigua.repo, "node_modules"))).toBe(false);
    expect(existsSync(join(antigua.repo, "trabajo.txt"))).toBe(true);
    for (const t of [activa, reciente, chat]) expect(existsSync(join(t.repo, "node_modules"))).toBe(true);
  } finally { liberarConversacion(cid); db.query("UPDATE tasks SET conversation_id=NULL WHERE conversation_id=?").run(cid); db.query("DELETE FROM conversations WHERE id=?").run(cid); }
});
test("rutas rechazan configuración inválida y limpieza no confirmada", async () => {
  const res = await servidor.request("http://localhost/servidor/limpieza", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: "limpiar" }) });
  expect(res.status).toBe(400);
  const put = await servidor.request("http://localhost/servidor/limpieza", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ automatica: true }) });
  expect(put.status).toBe(400);
  const get = await servidor.request("http://localhost/servidor/limpieza");
  expect(get.status).toBe(200); expect((await get.json() as { enCurso: boolean }).enCurso).toBe(false);
});
test("el respaldo suspende el mantenimiento sin retirar archivos", async () => {
  const marca = join(config.dataDir, "respaldo-en-curso");
  const anterior = process.env.TELO_MARCA_DESPLIEGUE;
  writeFileSync(marca, "respaldo"); process.env.TELO_MARCA_DESPLIEGUE = marca;
  try { expect(await mantenerDisco("limpiar")).toBeNull(); }
  finally {
    if (anterior === undefined) delete process.env.TELO_MARCA_DESPLIEGUE; else process.env.TELO_MARCA_DESPLIEGUE = anterior;
    rmSync(marca);
  }
});
test("diagnóstico incluye sesiones, adjuntos y entregables sin exponer rutas", async () => {
  type Datos = { carpetas: { nombre: string }[]; carpetas_actualizando: boolean; carpetas_error: boolean };
  let datos: Datos | null = null;
  const limite = Date.now() + 10_000;
  do {
    const res = await servidor.request("http://localhost/servidor");
    expect(res.status).toBe(200);
    datos = await res.json() as Datos;
    expect(typeof datos.carpetas_actualizando).toBe("boolean");
    expect(typeof datos.carpetas_error).toBe("boolean");
    if (!datos.carpetas_actualizando) break;
    await Bun.sleep(50);
  } while (Date.now() < limite);
  expect(datos).not.toBeNull();
  expect(datos!.carpetas_actualizando).toBe(false);
  for (const nombre of ["sesiones de agentes", "adjuntos", "entregables"]) expect(datos!.carpetas.some(c => c.nombre === nombre)).toBe(true);
}, 15_000);
