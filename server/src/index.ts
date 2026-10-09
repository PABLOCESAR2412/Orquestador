import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";

const webDist = join(import.meta.dir, "../../web/dist");

const app = new Hono();

app.get("/api/health", (c) => {
  const row = db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
  return c.json({ ok: row?.ok === 1, time: new Date().toISOString() });
});

app.get("/api/*", (c) => c.json({ error: "not_found" }, 404));

app.use("/*", serveStatic({ root: webDist }));
app.get("*", serveStatic({ root: webDist, path: "index.html" }));

console.log(`Orquestador escuchando en http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
