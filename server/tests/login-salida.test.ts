import { expect, test } from "bun:test";
import { interpretarSalidaLoginCodex } from "../src/login-cli";

const URL = "https://auth.openai.com/codex/device";
const CODIGO = "ABCD-EFGH";

test("extrae enlace y código del CLI con colores ANSI, sin caracteres de terminal", () => {
  const texto = `Welcome to Codex [v\x1b[90m0.162.1\x1b[0m]\n1. Open this link\n\x1b[94m${URL}\x1b[0m\n2. Enter this one-time code\n\x1b[94m${CODIGO}\x1b[0m\n`;
  const datos = interpretarSalidaLoginCodex(texto);
  expect(datos.url).toBe(URL);
  expect(datos.codigo).toBe(CODIGO);
  expect(datos.salida).not.toContain("\x1b");
  expect(datos.salida).not.toContain("[94m");
});

test("conserva salida sin colores y códigos de cinco caracteres", () => {
  expect(interpretarSalidaLoginCodex(`Abre ${URL} e introduce WXYZ-12345`).codigo).toBe("WXYZ-12345");
  expect(interpretarSalidaLoginCodex("Esperando autorización")).toEqual({ url: null, codigo: null, salida: "Esperando autorización" });
});

test("el acumulado completa enlaces y escapes recibidos en varios fragmentos", () => {
  const fragmentos = ["\x1b[94mhttps://auth.open", "ai.com/codex/device\x1b[", `0m\n\x1b[94m${CODIGO.slice(0,4)}`, `${CODIGO.slice(4)}\x1b[0m\n`];
  let acumulado = "";
  for (const fragmento of fragmentos) acumulado += fragmento;
  const datos = interpretarSalidaLoginCodex(acumulado);
  expect(datos.url).toBe(URL);
  expect(datos.codigo).toBe(CODIGO);
});

test("sigue ocultando credenciales de la salida coloreada", () => {
  const token = "sk-" + "credencialficticiadepruebas12345678";
  const datos = interpretarSalidaLoginCodex(`\x1b[90m${token}\x1b[0m\n${URL}\n${CODIGO}`);
  expect(datos.salida).not.toContain(token);
  expect(datos.salida).toContain("***");
});
