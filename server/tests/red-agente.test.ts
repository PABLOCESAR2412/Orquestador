import { expect, test } from "bun:test";
import { join } from "node:path";
import { direccionPublica, destinoPublico } from "../src/runners/red-agente";

test("rechaza loopback, redes privadas, metadata y variantes IPv6", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "100.100.100.200", "169.254.169.254", "172.16.0.1", "192.168.1.1", "0.0.0.0", "255.255.255.255", "::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "fc00::1", "fe80::1", "2002:7f00:1::"]) {
    expect(direccionPublica(ip)).toBe(false);
  }
  expect(direccionPublica("93.184.216.34")).toBe(true);
  expect(direccionPublica("2606:4700:4700::1111")).toBe(true);
  for (const host of ["localhost", "otra.localhost", "servidor.local", "127.1", "2130706433"]) {
    // Los formatos numéricos alternativos también se normalizan antes de validar.
    const nombre = new URL(`http://${host}`).hostname;
    await expect(destinoPublico(nombre)).rejects.toThrow();
  }
});

test.skipIf(process.platform !== "linux")("el sandbox separa loopback y usa el broker sin revelar claves", async () => {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/red-agente.ts")], { stdout: "pipe", stderr: "pipe" });
  const [codigo, salida, error] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect({ codigo, error: codigo ? salida + error : "" }).toEqual({ codigo: 0, error: "" });
}, 30_000);
