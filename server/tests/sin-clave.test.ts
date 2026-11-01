import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { accesoLocalSinClave, restringirSinClave } from "../src/sin-clave";

describe("acceso sin clave", () => {
  test("solo acepta clientes loopback con host local", () => {
    expect(accesoLocalSinClave("localhost", "127.0.0.1", new Headers())).toBe(true);
    expect(accesoLocalSinClave("[::1]", "::1", new Headers())).toBe(true);
    expect(accesoLocalSinClave("localhost", "192.0.2.1", new Headers())).toBe(false);
    expect(accesoLocalSinClave("remoto.example", "127.0.0.1", new Headers())).toBe(false);
    expect(accesoLocalSinClave("localhost", undefined, new Headers())).toBe(false);
  });
  test("rechaza señales de reenvío aunque el proxy use loopback", () => {
    for (const header of ["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip"]) {
      expect(accesoLocalSinClave("localhost", "127.0.0.1", new Headers({ [header]: "192.0.2.1" }))).toBe(false);
    }
  });
  test("el middleware protege también las rutas públicas", async () => {
    const app = new Hono();
    app.use("*", restringirSinClave);
    app.get("/api/health", (c) => c.text("ok"));
    expect((await app.request("http://localhost/api/health", { headers: { host: "localhost" } }, { clientIp: "127.0.0.1" })).status).toBe(200);
    expect((await app.request("http://example.test/api/health", { headers: { host: "example.test" } }, { clientIp: "127.0.0.1" })).status).toBe(403);
    expect((await app.request("http://localhost/api/health", { headers: { host: "localhost", "x-forwarded-for": "192.0.2.1" } }, { clientIp: "127.0.0.1" })).status).toBe(403);
  });
});
