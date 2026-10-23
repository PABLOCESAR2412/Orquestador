import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enMantenimiento, estadoDespliegue, puertaDespliegue, registrarTrabajo } from "../src/despliegue";

const raiz = mkdtempSync(join(tmpdir(), "telo-despliegue-test-"));
const marca = join(raiz, "marca");
const anterior = process.env.TELO_MARCA_DESPLIEGUE;
process.env.TELO_MARCA_DESPLIEGUE = marca;
afterAll(() => {
  if (anterior === undefined) delete process.env.TELO_MARCA_DESPLIEGUE; else process.env.TELO_MARCA_DESPLIEGUE = anterior;
  rmSync(raiz, { recursive: true, force: true });
});

test("el mantenimiento rechaza admisión nueva pero espera trabajos ya admitidos", async () => {
  let entrar!: () => void, terminar!: () => void;
  const dentro = new Promise<void>(r => { entrar = r; });
  const pendiente = new Promise<void>(r => { terminar = r; });
  const app = new Hono();
  app.use("*", puertaDespliegue);
  app.post("/trabajo", async c => { entrar(); await pendiente; return c.json({ ok: true }); });
  app.post("/detener", c => c.json({ ok: true }));
  app.get("/api/tasks/:id/diff", c => c.json({ ok: true }));
  app.get("/api/projects/:id/git", c => c.json({ ok: true }));
  app.get("/api/tasks", c => c.json({ ok: true }));
  const primera = app.request("/trabajo", { method: "POST" });
  await dentro;
  writeFileSync(marca, "mantenimiento");
  expect(estadoDespliegue()).toEqual({ mantenimiento: true, activas: 1 });
  expect((await app.request("/trabajo", { method: "POST" })).status).toBe(503);
  expect((await app.request("/detener", { method: "POST" })).status).toBe(200);
  expect((await app.request("/api/tasks/ejemplo/diff")).status).toBe(503);
  expect((await app.request("/api/projects/ejemplo/git")).status).toBe(503);
  expect((await app.request("/api/tasks")).status).toBe(200);
  terminar(); await primera;
  expect(estadoDespliegue().activas).toBe(0);
});

test("el registro cubre trabajos de fondo y un cierre repetido no resta dos veces", () => {
  const cerrar = registrarTrabajo();
  expect(estadoDespliegue().activas).toBe(1);
  cerrar(); cerrar(); expect(estadoDespliegue().activas).toBe(0);
});

test("una concesión abandonada caduca sin bloquear indefinidamente la app", () => {
  const antes = new Date(Date.now() - 31 * 60_000);
  utimesSync(marca, antes, antes);
  expect(enMantenimiento()).toBe(false);
});
