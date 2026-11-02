import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = join(tmpdir(), "telo-preferences-pruebas");
if (!process.env.TELO_PRUEBAS_PREFERENCIAS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_PREFERENCIAS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { db } = await import("../src/db");
const { preferences } = await import("../src/routes/preferences");
const { savePreferences, DEFAULT_PREFERENCES } = await import("../src/preferences");
const app = new Hono().route("/", preferences);

afterEach(() => db.query("DELETE FROM app_settings WHERE key='preferences'").run());

test("la visibilidad por modelo persiste sin cambiar la selección del chat ni el presupuesto", async () => {
  savePreferences({ ...DEFAULT_PREFERENCES, defaultModel: "google/actual", monthlyBudgetUsd: 15 });
  const response = await app.request("/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelVisibility: { "google/actual": false, "codex/gpt-test": true } }) });
  expect(response.status).toBe(200);
  expect(await (await app.request("/preferences")).json()).toMatchObject({ defaultModel: "google/actual", monthlyBudgetUsd: 15, modelVisibility: { "google/actual": false, "codex/gpt-test": true } });
  for (const modelVisibility of [[], null, { "google/no": "false" }, { invalid: true }]) {
    expect((await app.request("/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelVisibility }) })).status).toBe(400);
  }
});

test("guardar otros ajustes no exige que el modelo predeterminado antiguo siga en el catálogo", async () => {
  savePreferences({ ...DEFAULT_PREFERENCES, defaultModel: "retirado/modelo" });
  const respuesta = await app.request("/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthlyBudgetUsd: 25 }),
  });
  expect(respuesta.status).toBe(200);
  expect(await respuesta.json()).toMatchObject({ defaultModel: "retirado/modelo", monthlyBudgetUsd: 25 });
});

test("los respaldos antiguos quedan inactivos hasta elegir una política explícita", async () => {
  db.query("INSERT INTO app_settings(key,value) VALUES('preferences',?)").run(JSON.stringify({ fallbackModel: "opencode/antiguo", quotaFallbackModels: ["opencode/otro"] }));
  expect(await (await app.request("/preferences")).json()).toMatchObject({ fallbackMode: "selected", fallbackModel: "opencode/antiguo" });
  const request = (fallbackMode: unknown) => app.request("/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fallbackMode }) });
  expect((await request("desconocido")).status).toBe(400);
  const guardado = await request("configured");
  expect(guardado.status).toBe(200);
  expect(await guardado.json()).toMatchObject({ fallbackMode: "configured" });
});
