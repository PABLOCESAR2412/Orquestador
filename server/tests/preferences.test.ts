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
