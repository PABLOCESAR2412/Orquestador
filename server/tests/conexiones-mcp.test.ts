import { afterAll, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = join(tmpdir(), "telo-conexiones-mcp-pruebas");
if (!process.env.TELO_PRUEBAS_CONEXIONES_MCP) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_CONEXIONES_MCP = "1";
}
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");

const { db } = await import("../src/db");
const {
  actualizarConexionMcp,
  argumentosConfigMcpCodex,
  borrarConexionMcp,
  configuracionMcpParaAgente,
  configuracionOpenCodeMcp,
  listarConexionesMcp,
  normalizarUrlMcp,
} = await import("../src/conexiones-mcp");
const { conexiones } = await import("../src/routes/conexiones");
const app = new Hono().route("/", conexiones);

beforeEach(() => {
  db.query("DELETE FROM mcp_connections").run();
});

test("el analizador no recibe MCP con capacidad de escritura ni sus tokens", async () => {
  for (const [nombre, url] of [["Repositorio", "https://repo.ejemplo.test/mcp"], ["Context7", "https://mcp.context7.com/mcp"]]) {
    const r = await app.request("/conexiones", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre, url, token: "token-ficticio-prueba" }) });
    expect(r.status).toBe(201);
  }
  const completo = configuracionMcpParaAgente(true);
  const lectura = configuracionMcpParaAgente(true, true);
  expect(completo.servidores).toHaveLength(2);
  expect(lectura.servidores).toHaveLength(1);
  expect(lectura.servidores[0]?.url).toBe("https://mcp.context7.com/mcp");
  expect(Object.keys(lectura.variables)).toHaveLength(1);
});

afterAll(() => {
  if (claveOriginal === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = claveOriginal;
  db.close();
  rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("solo acepta endpoints HTTPS sin credenciales ni datos sensibles en la URL", () => {
  expect(normalizarUrlMcp("https://lms.ejemplo.test/mcp")).toBe("https://lms.ejemplo.test/mcp");
  for (const url of [
    "http://lms.ejemplo.test/mcp",
    "https://usuario:clave@lms.ejemplo.test/mcp",
    "https://lms.ejemplo.test/mcp?token=secreto",
    "https://lms.ejemplo.test/mcp#fragmento",
    "no es una URL",
  ]) expect(normalizarUrlMcp(url)).toBeNull();
});

test("rechaza tokens demasiado cortos para protegerlos al redactar salidas", async () => {
  const respuesta = await app.request("/conexiones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "Token corto", url: "https://lms.ejemplo.test/mcp", token: "abc" }),
  });
  expect(respuesta.status).toBe(400);
  expect(await respuesta.json()).toEqual({ error: "conexion_token_invalido" });
});

test("genera configuración remota para OpenCode y Codex sin incluir el token literal", () => {
  const runtime = [{ clave: "telo_lms01", url: "https://lms.ejemplo.test/mcp", variableToken: "MCP_AUTH_123" }];
  const openCode = configuracionOpenCodeMcp(runtime);
  expect(openCode.compaction).toEqual({ auto: true, prune: true });
  expect(configuracionOpenCodeMcp([]).compaction).toEqual({ auto: true, prune: true });
  // El `small_model` se fija al modelo de la tarea para que los títulos y la compactación
  // no caigan en modelos del catálogo que la cuenta no tiene (402) o limitados (429).
  expect(configuracionOpenCodeMcp([], "opencode/deepseek-4.1-flash-free")).toMatchObject({
    small_model: "opencode/deepseek-4.1-flash-free",
  });
  expect(configuracionOpenCodeMcp([])).not.toHaveProperty("small_model");
  const codex = argumentosConfigMcpCodex(runtime);
  expect(JSON.stringify(openCode)).toContain("Bearer {env:MCP_AUTH_123}");
  expect(codex.join(" ")).toContain('mcp_servers.telo_lms01.url="https://lms.ejemplo.test/mcp"');
  expect(codex.join(" ")).toContain('bearer_token_env_var="MCP_AUTH_123"');
  expect(JSON.stringify(openCode)).not.toContain("token-real");
  expect(argumentosConfigMcpCodex([{ clave: "telo_publico", url: "https://docs.ejemplo.test/mcp" }])).toHaveLength(4);
});

test("guarda la credencial cifrada y solo la entrega al runner si la conexión está habilitada", async () => {
  const token = "token-lms-secreto-para-prueba";
  const respuesta = await app.request("/conexiones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "LMS", url: "https://lms.ejemplo.test/mcp", token }),
  });
  expect(respuesta.status).toBe(201);
  const respuestaTexto = await respuesta.text();
  const creada = JSON.parse(respuestaTexto) as { id: string; autenticacion_configurada: boolean };
  expect(creada.autenticacion_configurada).toBe(true);
  expect(respuestaTexto).not.toContain(token);

  const fila = db.query("SELECT * FROM mcp_connections WHERE id = ?").get(creada.id);
  expect(JSON.stringify(fila)).not.toContain(token);
  expect(JSON.stringify(listarConexionesMcp())).not.toContain(token);
  const runtime = configuracionMcpParaAgente();
  expect(runtime.servidores).toHaveLength(1);
  expect(runtime.servidores[0]?.url).toBe("https://lms.ejemplo.test/mcp");
  expect(runtime.servidores[0]?.variableToken).toStartWith("MCP_AUTH_");
  expect(Object.values(runtime.variables)).toEqual([token]);

  actualizarConexionMcp(creada.id, { habilitada: false });
  expect(configuracionMcpParaAgente()).toEqual({ servidores: [], variables: {} });
});

test("habilita el MCP oficial de Context7 solo en tareas que lo necesitan y respeta una conexión propia", async () => {
  const predeterminado = configuracionMcpParaAgente(true);
  expect(predeterminado.servidores).toContainEqual({ clave: "context7", url: "https://mcp.context7.com/mcp" });
  expect(configuracionOpenCodeMcp(predeterminado.servidores).mcp).toHaveProperty("context7");
  expect(argumentosConfigMcpCodex(predeterminado.servidores).join(" ")).toContain("mcp_servers.context7.url");

  const respuesta = await app.request("/conexiones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "Context7", url: "https://docs.ejemplo.test/mcp" }),
  });
  expect(respuesta.status).toBe(201);
  const propio = configuracionMcpParaAgente(true);
  expect(propio.servidores).toHaveLength(1);
  expect(propio.servidores[0]?.url).toBe("https://docs.ejemplo.test/mcp");
});

test("valida entradas, conserva credenciales al editar y permite quitarlas y borrar la conexión", async () => {
  const invalida = await app.request("/conexiones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "LMS", url: "http://lms.ejemplo.test/mcp" }),
  });
  expect(invalida.status).toBe(400);

  const creadaRespuesta = await app.request("/conexiones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "LMS", url: "https://lms.ejemplo.test/mcp", token: "token-seguro" }),
  });
  const creada = await creadaRespuesta.json() as { id: string };
  const editada = await app.request(`/conexiones/${creada.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nombre: "LMS personal", habilitada: false }),
  });
  expect(editada.status).toBe(200);
  expect(await editada.json()).toMatchObject({ nombre: "LMS personal", habilitada: false, autenticacion_configurada: true });

  const quitar = await app.request(`/conexiones/${creada.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quitar_token: true }),
  });
  expect(await quitar.json()).toMatchObject({ autenticacion_configurada: false });
  expect(borrarConexionMcp(creada.id)).toBe(true);
  expect(borrarConexionMcp(creada.id)).toBe(false);
});

test("rechaza nombres duplicados sin exponer credenciales", async () => {
  const body = JSON.stringify({ nombre: "Google Drive", url: "https://drive.ejemplo.test/mcp", token: "token-privado" });
  const primera = await app.request("/conexiones", { method: "POST", headers: { "content-type": "application/json" }, body });
  const segunda = await app.request("/conexiones", { method: "POST", headers: { "content-type": "application/json" }, body });
  expect(primera.status).toBe(201);
  expect(segunda.status).toBe(409);
  expect(await segunda.text()).not.toContain("token-privado");
});
