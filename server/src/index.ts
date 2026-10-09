import { Hono } from "hono";
import { config } from "./config";
import { db } from "./db";

const app = new Hono();

app.get("/api/health", (c) => {
  const row = db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
  return c.json({ ok: row?.ok === 1, time: new Date().toISOString() });
});

console.log(`Orquestador escuchando en http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
