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
  claveJevActualizadaEn,
  claveProveedorValida,
  entornoProveedores,
  estadoClaves,
  guardarClaveProveedor,
  cuentaCloudflare,
  valorClaveJev,
} = await import("../src/claves-proveedor");
const { clasificarTareaJev, conservarMemoriaSegunJev, ordenarSugerenciasJev, puntuarMemoriaJev, probarClaveJev } = await import("../src/jev");
const { ocultarValores, valoresAOcultar } = await import("../src/ejecutar");
const { clavesProveedor } = await import("../src/routes/claves-proveedor");
const { jevRoute } = await import("../src/routes/jev");
const { providers } = await import("../src/routes/providers");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
const CLAVE_ORIGINAL = process.env.TELO_CLAVE_CIFRADO;
const VALOR = "gsk_valor_de_prueba_12345";

beforeEach(() => {
  process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
  db.query("DELETE FROM provider_keys").run();
  db.query("DELETE FROM uso_jev").run();
  db.query("DELETE FROM app_settings WHERE key='cloudflare_account_id'").run();
  // Las variables del entorno del servidor también cuentan como "configurada": se quitan para aislar cada prueba.
  for (const variable of ["GROQ_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN"]) {
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

  test("la clave de OpenRouter llega al entorno de OpenCode", () => {
    guardarClaveProveedor("openrouter", VALOR);
    expect(entornoProveedores()).toEqual({ OPENROUTER_API_KEY: VALOR });
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

describe("integración Jev", () => {
  const CLAVE_JEV = "apikey_clave_jev_de_prueba_1234567890";

  test("cifra la clave, la mantiene fuera del entorno de OpenCode y no la devuelve por Ajustes", async () => {
    expect(guardarClaveProveedor("jev", CLAVE_JEV)).not.toBeNull();
    expect(valorClaveJev()).toBe(CLAVE_JEV);
    expect(claveJevActualizadaEn()).not.toBeNull();
    expect(entornoProveedores()).toEqual({});
    const fila = db.query("SELECT * FROM provider_keys WHERE proveedor = 'jev'").get();
    expect(JSON.stringify(fila)).not.toContain(CLAVE_JEV);

    const respuesta = await jevRoute.request("/jev");
    const texto = await respuesta.text();
    expect(texto).not.toContain(CLAVE_JEV);
    expect(JSON.parse(texto)).toMatchObject({ disponible: true, configurada: true });
  });

  test("guarda y elimina la clave sin exponerla en las respuestas", async () => {
    const guardar = await jevRoute.request("/jev", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valor: CLAVE_JEV }),
    });
    const texto = await guardar.text();
    expect(guardar.status).toBe(200);
    expect(texto).not.toContain(CLAVE_JEV);
    expect(JSON.parse(texto)).toMatchObject({ configurada: true });

    const borrar = await jevRoute.request("/jev", { method: "DELETE" });
    expect(await borrar.json()).toEqual({ ok: true });
    expect(valorClaveJev()).toBeNull();
  });

  test("usa System One, redacta secretos del estado, registra uso aparte y ordena sugerencias", async () => {
    guardarClaveProveedor("jev", CLAVE_JEV);
    db.query("INSERT INTO projects (id, name) VALUES ('proyecto-a', 'Proyecto A')").run();
    db.query("INSERT INTO conversations (id, project_id, title) VALUES ('chat-jev', 'proyecto-a', 'Chat Jev')").run();
    const secretoEntorno = "secreto_api_personal_sin_prefijo_12345";
    process.env.CUSTOM_API_KEY = secretoEntorno;
    const fetchOriginal = globalThis.fetch;
    const cuerpos: Record<string, unknown>[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.typesafe.ai/v1/systemone");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${CLAVE_JEV}`);
      cuerpos.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const body = cuerpos.at(-1)!;
      const questions = body.questions as Record<string, unknown>;
      const answers = Object.fromEntries(Object.keys(questions).map((key, index) => [key, {
        type: "score", score: index === 0 ? 0.2 : 1.8,
      }]));
      return Response.json({ model: "jev-test", answers, usage: { input_tokens: 12, output_tokens: 3 } });
    }) as unknown as typeof fetch;
    try {
      const recomendaciones = await ordenarSugerenciasJev({
        conversacionId: "chat-jev",
        proyectoId: null,
        mensajes: [{ role: "user", content: `Ayúdame con ${CLAVE_JEV} y ${secretoEntorno}` }],
        candidatas: ["Seguir con otro tema", "Corregir el fallo actual"],
      });
      expect(recomendaciones).toEqual(["Corregir el fallo actual", "Seguir con otro tema"]);
      const estadoEnviado = JSON.stringify(cuerpos[0].state);
      expect(estadoEnviado).not.toContain(CLAVE_JEV);
      expect(estadoEnviado).not.toContain(secretoEntorno);
      expect(estadoEnviado).toContain("***");
      expect(cuerpos[0]).toMatchObject({ model: "jev-latest" });

      expect(await puntuarMemoriaJev({
        proyectoId: "proyecto-a",
        estado: { proyecto: "Proyecto", tarea: "Tarea", memoriaAnterior: null, propuesta: "Convención estable" },
      })).toBe(0.2);
      const uso = db.query<{ calls: number; tokens: number }, []>(
        "SELECT COUNT(*) AS calls, SUM(tokens_entrada + tokens_salida) AS tokens FROM uso_jev",
      ).get();
      expect(uso).toEqual({ calls: 2, tokens: 30 });
    } finally {
      globalThis.fetch = fetchOriginal;
      delete process.env.CUSTOM_API_KEY;
    }
  });

  test("la prueba valida una respuesta Noul y memoria conserva su fallback si Jev falla", async () => {
    guardarClaveProveedor("jev", CLAVE_JEV);
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({
      model: "jev-test", answers: { conectada: { type: "noul", noul: 0.99 } }, usage: { input_tokens: 1, output_tokens: 1 },
    })) as unknown as typeof fetch;
    try {
      expect(await probarClaveJev()).toBe(true);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    expect(conservarMemoriaSegunJev(null)).toBeNull();
    expect(conservarMemoriaSegunJev(1.99)).toBe(false);
    expect(conservarMemoriaSegunJev(2)).toBe(true);
    expect(conservarMemoriaSegunJev(3.1)).toBeNull();
  });

  test("la clasificación de tarea solo devuelve una categoría conocida como recomendación", async () => {
    guardarClaveProveedor("jev", CLAVE_JEV);
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({
      model: "jev-test",
      answers: { categoria: { type: "choice", choice: "interfaz", confidence: 0.84 } },
      usage: { input_tokens: 2, output_tokens: 1 },
    })) as unknown as typeof fetch;
    try {
      expect(await clasificarTareaJev({
        tareaId: "tarea-a",
        proyectoId: null,
        prompt: "Mejora el panel de Ajustes",
      })).toEqual({ categoria: "interfaz", confianza: 0.84 });
    } finally {
      globalThis.fetch = fetchOriginal;
    }
    expect(entornoProveedores()).toEqual({});
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
    expect(datos.proveedores.map((p) => p.id)).toEqual(["openai", "groq", "nvidia", "google", "openrouter", "deepseek", "xai", "cloudflare-workers-ai"]);
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

  test("Cloudflare guarda cuenta y token cifrado juntos; rechaza cuentas con rutas", async () => {
    const accountId = "a".repeat(32);
    const rechazado = await put("cloudflare-workers-ai", { valor: VALOR, accountId: "../otra-cuenta" });
    expect(rechazado.status).toBe(400);
    expect(cuentaCloudflare()).toBeNull();
    expect(entornoProveedores().CLOUDFLARE_API_KEY).toBeUndefined();
    const res = await put("cloudflare-workers-ai", { valor: VALOR, accountId });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(VALOR);
    expect(cuentaCloudflare()).toBe(accountId);
    expect(entornoProveedores()).toMatchObject({ CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_KEY: VALOR });
    expect(JSON.stringify(db.query("SELECT * FROM provider_keys WHERE proveedor='cloudflare-workers-ai'").get())).not.toContain(VALOR);
    const estado = await (await providers.request("/providers")).json() as { id: string; accountId?: string; configured: boolean }[];
    expect(estado.find(p => p.id === "cloudflare-workers-ai")).toMatchObject({ accountId, configured: true });
  });

  test("Cloudflare consulta el catálogo oficial sin ejecutar inferencia", async () => {
    const accountId = "b".repeat(32);
    await put("cloudflare-workers-ai", { valor: VALOR, accountId });
    const original = globalThis.fetch;
    let llamada = "";
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      llamada = String(url);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${VALOR}`);
      expect(init?.method ?? "GET").toBe("GET");
      return Response.json({ success: true, result: [{ name: "@cf/prueba/modelo" }] });
    }) as typeof fetch;
    try {
      const res = await providers.request("/providers/cloudflare-workers-ai/probar", { method: "POST" });
      expect(await res.json()).toEqual({ ok: true, modelos: 1 });
      expect(llamada).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=100`);
    } finally { globalThis.fetch = original; }
  });

  test("PUT con proveedor desconocido da 404", async () => {
    const res = await put("proveedor-inexistente", { valor: VALOR });
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
    const res = await clavesProveedor.request("/claves-proveedor/proveedor-inexistente", { method: "DELETE" });
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
    expect(lista.find((p) => p.id === "openrouter")).toMatchObject({
      configured: false,
      enAgente: false,
      guardable: true,
      guardada: false,
      variable: "OPENROUTER_API_KEY",
    });
    expect(lista.find((p) => p.id === "codex")).toMatchObject({ guardable: false, variable: null });
  });

  test("prueba los cuatro catálogos sin generar texto ni exponer claves", async () => {
    const fetchOriginal = globalThis.fetch;
    const llamadas: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      llamadas.push({ url: String(_input), headers: new Headers(init?.headers) });
      return Response.json({ data: [{ id: "test/model" }, { id: "test/model-2" }] });
    }) as typeof fetch;
    try {
      const proveedores = [
        { id: "google", url: "generativelanguage.googleapis.com/v1beta/models", header: "x-goog-api-key" },
        { id: "groq", url: "api.groq.com/openai/v1/models", header: "authorization" },
        { id: "nvidia", url: "integrate.api.nvidia.com/v1/models", header: "authorization" },
        { id: "openrouter", url: "openrouter.ai/api/v1/models", header: "authorization" },
      ];
      for (const proveedor of proveedores) {
        guardarClaveProveedor(proveedor.id, VALOR);
        const respuesta = await providers.request(`/providers/${proveedor.id}/probar`, { method: "POST" });
        expect(await respuesta.json()).toEqual({ ok: true, modelos: 2 });
        const llamada = llamadas.at(-1)!;
        expect(llamada.url).toContain(proveedor.url);
        expect(llamada.headers.get(proveedor.header)).toBe(proveedor.header === "authorization" ? `Bearer ${VALOR}` : VALOR);
        expect(await (await providers.request(`/providers/${proveedor.id}/probar`, { method: "POST" })).text()).not.toContain(VALOR);
      }
    } finally {
      globalThis.fetch = fetchOriginal;
    }
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

  test("consulta el balance oficial de DeepSeek sin devolver ni registrar la clave", async () => {
    const secreto = "deepseek-balance-test-secret";
    guardarClaveProveedor("deepseek", secreto);
    const fetchOriginal = globalThis.fetch;
    let encabezado = "";
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.deepseek.com/user/balance");
      encabezado = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "2.50", topped_up_balance: "10.00" }],
      });
    }) as typeof fetch;
    try {
      const respuesta = await providers.request("/providers/deepseek/balance");
      const texto = await respuesta.text();
      expect(respuesta.status).toBe(200);
      expect(encabezado).toBe(`Bearer ${secreto}`);
      expect(texto).not.toContain(secreto);
      expect(JSON.parse(texto)).toMatchObject({
        estado: "activo",
        disponible: true,
        balanceInfos: [{ currency: "USD", totalBalance: "12.50", grantedBalance: "2.50", toppedUpBalance: "10.00" }],
      });
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});


test("DeepSeek y xAI guardan claves cifradas y están disponibles para análisis de solo lectura", async () => {
  const {esClaveDeInferencia}=await import('../src/claves-proveedor');
  for(const [id,variable] of [['deepseek','DEEPSEEK_API_KEY'],['xai','XAI_API_KEY']]){
    expect(guardarClaveProveedor(id!,VALOR)).not.toBeNull();
    expect(entornoProveedores()[variable!]).toBe(VALOR);
    expect(esClaveDeInferencia(variable!)).toBe(true);
    const data=await (await providers.request('/providers')).json() as {id:string;guardable:boolean}[];
    expect(data.find(p=>p.id===id)?.guardable).toBe(true);
  }
});
