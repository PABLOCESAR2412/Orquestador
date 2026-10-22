import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { sprintf } = require("sprintf-js");
const { v5 } = require("uuid");
test("sprintf acota precisiones excesivas sin abortar la conversión", () => {
 for (const formato of ["%.999999999f", "%.999999999e", "%.999999999g", "%.0g"]) {
  const texto = sprintf(formato, 1.25);
  expect(typeof texto).toBe("string");
  expect(texto.length).toBeLessThan(120);
 }
 expect(sprintf("%.2f", 1.25)).toBe("1.25");
});
test("uuid rechaza buffers de salida insuficientes", () => {
 expect(() => v5("prueba", v5.DNS, new Uint8Array(8), 4)).toThrow(RangeError);
 expect(v5("prueba", v5.DNS)).toMatch(/^[0-9a-f-]{36}$/);
});
