import { Hono } from "hono";
import { join, resolve, sep, extname } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { chat } from "./routes/chat";
import { modelsRoute } from "./routes/models";
import { settings } from "./routes/settings";

const webDist = resolve(import.meta.dir, "../../web/dist");
const indexFile = join(webDist, "index.html");

const app = new Hono();

app.get("/api/health", (c) => {
  const row = db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
  return c.json({ ok: row?.ok === 1, time: new Date().toISOString() });
});

app.route("/api", chat);
app.route("/api", modelsRoute);
app.route("/api", settings);
app.get("/api/*", (c) => c.json({ error: "not_found" }, 404));

app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  const file = resolve(webDist, "." + path);

  if (!file.startsWith(webDist + sep)) return c.text("Forbidden", 403);

  if (extname(file) && (await Bun.file(file).exists())) {
    return new Response(Bun.file(file));
  }

  return new Response(Bun.file(indexFile), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

console.log(`Orquestador escuchando en http://localhost:${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
