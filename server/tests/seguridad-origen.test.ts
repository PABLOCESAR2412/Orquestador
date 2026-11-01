import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { protegerOrigen } from "../src/seguridad-origen";
import { auth } from "../src/routes/auth";
import { COOKIE_SESION, crearSesionDispositivo, sesionValida, cerrarSesionPorToken } from "../src/auth";
import { config } from "../src/config";

const anterior = process.env.TELO_PUBLIC_URL;
afterEach(() => {
  if (anterior === undefined) delete process.env.TELO_PUBLIC_URL;
  else process.env.TELO_PUBLIC_URL = anterior;
});

test("otro puerto no puede revocar sesiones con cookie y JSON text/plain", async () => {
  const sinClave = config.sinClave;
  config.sinClave = false;
  const actual = crearSesionDispositivo({});
  const otra = crearSesionDispositivo({});
  const app = new Hono();
  app.use("/api/*", protegerOrigen);
  app.use("/api/*", async (c, next) => sesionValida(getCookie(c, COOKIE_SESION)) ? next() : c.json({}, 401));
  app.route("/api", auth);
  const url = "http://127.0.0.1:3000/api/sesiones/cerrar-otras";
  const headers = { cookie: `${COOKIE_SESION}=${actual.token}`, "content-type": "text/plain" };
  try {
    expect((await app.request(url, { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:4000" }, body: "{}" })).status).toBe(403);
    expect(sesionValida(otra.token)).toBe(true);
    expect((await app.request(url, { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:3000" }, body: "{}" })).status).toBe(200);
    expect(sesionValida(otra.token)).toBe(false);
  } finally {
    cerrarSesionPorToken(actual.token);
    cerrarSesionPorToken(otra.token);
    config.sinClave = sinClave;
  }
});

test("rechaza origen opaco y metadatos de otro sitio sin Origin; admite CLI", async () => {
  const app = new Hono();
  app.use("*", protegerOrigen);
  app.post("/cambio", c => c.json({ ok: true }));
  const casos: Record<string, string>[] = [{ origin: "null" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of casos) {
    expect((await app.request("/cambio", { method: "POST", headers })).status).toBe(403);
  }
  expect((await app.request("/cambio", { method: "POST" })).status).toBe(200);
});

test("conserva HTTPS tras proxy y admite el origen público configurado", async () => {
  const app = new Hono();
  app.use("*", protegerOrigen);
  app.post("/cambio", c => c.json({ ok: true }));
  expect((await app.request("http://telo.example/cambio", { method: "POST", headers: { origin: "https://telo.example", "x-forwarded-proto": "https" } })).status).toBe(200);
  process.env.TELO_PUBLIC_URL = "https://telo.example";
  expect((await app.request("http://127.0.0.1:3000/cambio", { method: "POST", headers: { origin: "https://telo.example" } })).status).toBe(200);
  expect((await app.request("http://127.0.0.1:3000/cambio", { method: "POST", headers: { origin: "https://telo.example:4000" } })).status).toBe(403);
});

test("el callback OAuth GET sigue disponible desde fuera", async () => {
  const app = new Hono();
  app.use("*", protegerOrigen);
  app.get("/api/google-drive/oauth/callback", c => c.text("callback"));
  expect((await app.request("/api/google-drive/oauth/callback", { headers: { origin: "https://accounts.google.com" } })).status).toBe(200);
});
