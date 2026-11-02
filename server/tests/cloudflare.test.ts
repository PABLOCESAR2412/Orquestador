import { expect, test } from "bun:test";
import { cuentaCloudflareValida, endpointCloudflare } from "../src/cloudflare";
import { proveedorCompatibleConBroker } from "../src/runners/red-agente";

test("la cuenta Cloudflare solo forma una ruta del host oficial", () => {
  const cuenta = "ABCDEF0123456789ABCDEF0123456789";
  expect(endpointCloudflare(cuenta)).toBe(`https://api.cloudflare.com/client/v4/accounts/${cuenta.toLowerCase()}/ai/v1`);
  for (const invalida of [null, {}, "", "../ai", "a".repeat(31), "g".repeat(32), "https://otra.test/", "a".repeat(32) + "/otra"]) {
    expect(cuentaCloudflareValida(invalida)).toBe(false);
    expect(endpointCloudflare(invalida)).toBeNull();
  }
  expect(proveedorCompatibleConBroker("cloudflare-workers-ai", { CLOUDFLARE_ACCOUNT_ID: "../ai", CLOUDFLARE_API_KEY: "prueba" })).toBe(false);
  expect(proveedorCompatibleConBroker("cloudflare-workers-ai", { CLOUDFLARE_ACCOUNT_ID: cuenta, CLOUDFLARE_API_KEY: "prueba" })).toBe(true);
});
