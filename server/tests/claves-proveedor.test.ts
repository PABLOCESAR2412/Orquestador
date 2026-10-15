import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal compartida por todos los archivos de prueba (ver secretos.test.ts): nunca se toca server/data.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const {
  borrarClaveProveedor,
  claveProveedorValida,
  entornoProveedores,
  estadoClaves,
  guardarClaveProveedor,
} = await import("../src/claves-proveedor");
const { ocultarValores, valoresAOcultar } = await import("../src/ejecutar");
const { clavesProveedor } = await import("../src/routes/claves-proveedor");
const { providers } = await import("../src/routes/providers");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
const CLAVE_ORIGINAL = process.env.TELO_CLAVE_CIFRADO;
const VALOR = "gsk_valor_de_prueba_12345";

beforeEach(() => {
  process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
  db.query("DELETE FROM provider_keys").run();
  // Las variables del entorno del servidor también cuentan como "configurada": se quitan para aislar cada prueba.
  for (const variable of ["GROQ_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
    delete process.env[variable];
  }
});

afterEach(() => {
  if (CLAVE_ORIGINAL === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = CLAVE_ORIGINAL;
});

describe("guardar y leer la clave", () => {
  test("se guarda y entornoProveedores la entrega con el nombre de variable que usa OpenCode", () => {
    expect(guardarClaveProveedor("groq", VALOR)).not.toBeNull();
    expect(entornoProveedores()).toEqual({ GROQ_API_KEY: VALOR });
  });

  test("la clave de Gemini llega con las dos variables (versión actual y antigua de OpenCode)", () => {
    const valorGemini = "AIza-valor-de-prueba-gemini-1";
    expect(guardarClaveProveedor("google", valorGemini)).not.toBeNull();
    expect(entornoProveedores()).toEqual({
      GOOGLE_GENERATIVE_AI_API_KEY: valorGemini,
      GEMINI_API_KEY: valorGemini,
      GOOGLE_API_KEY: valorGemini,
    });
    expect(estadoClaves().find((e) => e.id === "google")).toMatchObject({ configurada: true, variable: "GOOGLE_GENERATIVE_AI_API_KEY" });
  });

  test("en la base no aparece el valor en claro", () => {
    guardarClaveProveedor("groq", VALOR);
    const fila = db.query("SELECT * FROM provider_keys WHERE proveedor = 'groq'").get();
    expect(fila).not.toBeNull();
    expect(JSON.stringify(fila)).not.toContain(VALOR);
  });

  test("guardar de nuevo reemplaza el valor y no duplica la fila", () => {
    guardarClaveProveedor("groq", VALOR);
    guardarClaveProveedor("groq", "gsk_otro_valor_999");
    expect(entornoProveedores()).toEqual({ GROQ_API_KEY: "gsk_otro_valor_999" });
    const filas = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM provider_keys").get();
    expect(filas?.n).toBe(1);
  });

  test("sin clave maestra no se guarda, y el entorno queda vacío sin lanzar error", () => {
    delete process.env.TELO_CLAVE_CIFRADO;
    expect(guardarClaveProveedor("groq", VALOR)).toBeNull();
    expect(() => entornoProveedores()).not.toThrow();
    expect(entornoProveedores()).toEqual({});
  });

  test("una clave que no descifra se omite sin lanzar error", () => {
    guardarClaveProveedor("groq", VALOR);
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    expect(() => entornoProveedores()).not.toThrow();
    expect(entornoProveedores()).toEqual({});
  });

  test("una fila de un proveedor desconocido nunca entra al entorno", () => {
    db.query("INSERT INTO provider_keys (proveedor, iv, tag, value_enc) VALUES ('otro', 'x', 'y', 'z')").run();
    expect(entornoProveedores()).toEqual({});
  });

  test("borrar quita la clave del entorno; la segunda vez no encuentra nada", () => {
    guardarClaveProveedor("groq", VALOR);
    expect(borrarClaveProveedor("groq")).toBe(true);
    expect(entornoProveedores()).toEqual({});
    expect(borrarClaveProveedor("groq")).toBe(false);
  });
});

describe("validación del valor", () => {
  test("acepta una clave sin espacios de longitud razonable", () => {
    expect(claveProveedorValida("gsk_valida_123")).toBe(true);
  });

  test("rechaza vacías, cortas, con espacios o saltos, no textos y demasiado largas", () => {
    for (const malo of ["", "corta", "con espacio 12345", "salto\n123456789", 12345678, null]) {
      expect(claveProveedorValida(malo)).toBe(false);
    }
    expect(claveProveedorValida("x".repeat(513))).toBe(false);
  });
});

describe("estado sin valores", () => {
  test("estadoClaves dice si está configurada y nunca trae el valor", () => {
    guardarClaveProveedor("nvidia", "nvapi-valor-de-prueba");
    const estado = estadoClaves();
    expect(JSON.stringify(estado)).not.toContain("nvapi-valor-de-prueba");
    expect(estado.find((e) => e.id === "nvidia")).toMatchObject({ configurada: true, variable: "NVIDIA_API_KEY" });
    expect(estado.find((e) => e.id === "groq")).toMatchObject({ configurada: false, actualizada_en: null });
  });
});

describe("redacción de la salida", () => {
  test("la clave guardada se oculta en cualquier texto que salga del servidor", () => {
    guardarClaveProveedor("groq", VALOR);
    const salida = ocultarValores(`Llamando con ${VALOR} al modelo`, valoresAOcultar(entornoProveedores()));
    expect(salida).not.toContain(VALOR);
  });
});

describe("rutas de claves de proveedor", () => {
  const put = (id: string, cuerpo: unknown) =>
    clavesProveedor.request(`/claves-proveedor/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });

  test("GET lista los proveedores sin valores", async () => {
    guardarClaveProveedor("groq", VALOR);
    const texto = await (await clavesProveedor.request("/claves-proveedor")).text();
    expect(texto).not.toContain(VALOR);
    const datos = JSON.parse(texto) as { disponible: boolean; proveedores: { id: string; configurada: boolean }[] };
    expect(datos.disponible).toBe(true);
    expect(datos.proveedores.map((p) => p.id)).toEqual(["groq", "nvidia", "google"]);
    expect(datos.proveedores.find((p) => p.id === "groq")?.configurada).toBe(true);
  });

  test("PUT guarda y responde sin el valor", async () => {
    const res = await put("groq", { valor: VALOR });
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain(VALOR);
    expect(JSON.parse(texto)).toMatchObject({ id: "groq", configurada: true });
    expect(entornoProveedores()).toEqual({ GROQ_API_KEY: VALOR });
  });

  test("PUT con proveedor desconocido da 404", async () => {
    const res = await put("openai", { valor: VALOR });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "proveedor_desconocido" });
  });

  test("PUT con clave inválida da 400 y no guarda nada", async () => {
    const res = await put("groq", { valor: "con espacios en medio" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "clave_proveedor_invalida" });
    expect(entornoProveedores()).toEqual({});
  });

  test("PUT con un cuerpo que no es objeto da 400 invalid_body", async () => {
    const res = await put("groq", "[1]");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  test("PUT sin clave maestra da 503 secretos_no_configurados", async () => {
    delete process.env.TELO_CLAVE_CIFRADO;
    const res = await put("groq", { valor: VALOR });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "secretos_no_configurados" });
  });

  test("DELETE: primera vez ok, después 404 proveedor_sin_clave", async () => {
    guardarClaveProveedor("groq", VALOR);
    const primera = await clavesProveedor.request("/claves-proveedor/groq", { method: "DELETE" });
    expect(await primera.json()).toEqual({ ok: true });
    const segunda = await clavesProveedor.request("/claves-proveedor/groq", { method: "DELETE" });
    expect(segunda.status).toBe(404);
    expect(await segunda.json()).toEqual({ error: "proveedor_sin_clave" });
  });

  test("DELETE de proveedor desconocido da 404 proveedor_desconocido", async () => {
    const res = await clavesProveedor.request("/claves-proveedor/openai", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "proveedor_desconocido" });
  });
});

describe("GET /providers", () => {
  test("no devuelve valores y marca la clave guardada como configurada, guardable y en el agente", async () => {
    guardarClaveProveedor("groq", VALOR);
    const texto = await (await providers.request("/providers")).text();
    expect(texto).not.toContain(VALOR);
    const lista = JSON.parse(texto) as {
      id: string;
      configured: boolean;
      enAgente: boolean;
      guardable: boolean;
      guardada: boolean;
      variable: string | null;
    }[];
    expect(lista.find((p) => p.id === "groq")).toMatchObject({
      configured: true,
      enAgente: true,
      guardable: true,
      guardada: true,
      variable: "GROQ_API_KEY",
    });
    expect(lista.find((p) => p.id === "nvidia")).toMatchObject({
      configured: false,
      enAgente: false,
      guardable: true,
      guardada: false,
    });
    expect(lista.find((p) => p.id === "codex")).toMatchObject({ guardable: false, variable: "OPENAI_API_KEY" });
  });

  test("una clave solo en el entorno del servidor cuenta como configurada, pero no llega al agente sin TELO_AGENTE_VARIABLES", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-solo-en-entorno";
    const lista = (await (await providers.request("/providers")).json()) as {
      id: string;
      configured: boolean;
      enAgente: boolean;
      guardada: boolean;
    }[];
    expect(lista.find((p) => p.id === "nvidia")).toMatchObject({
      configured: true,
      enAgente: false,
      guardada: false,
    });
    delete process.env.NVIDIA_API_KEY;
  });
});
