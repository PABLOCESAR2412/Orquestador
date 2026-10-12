import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal: nunca se toca server/data (mismo patrón que secretos.test.ts).
// Google se simula sustituyendo fetch: ninguna prueba sale a la red.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { googleRoute } = await import("../src/routes/google");
const { desafioPKCE } = await import("../src/oauth-google");
const { claveMaestra, descifrar } = await import("../src/secretos");
const { db } = await import("../src/db");

const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_REVOCAR = "https://oauth2.googleapis.com/revoke";
const URL_USUARIO = "https://openidconnect.googleapis.com/v1/userinfo";
const PUBLICA = "https://orquestador.ejemplo.test";
const CLIENTE_ID = "cliente-prueba.apps.googleusercontent.com";
// Valores de prueba armados en tiempo de ejecución, sin literales con forma de credencial.
const SECRETO_CLIENTE = `cs-${randomBytes(12).toString("hex")}`;
const CLAVE_CIFRADO = randomBytes(32).toString("base64");

const VARIABLES = ["TELO_PUBLIC_URL", "TELO_GOOGLE_CLIENT_ID", "TELO_GOOGLE_CLIENT_SECRET", "TELO_CLAVE_CIFRADO"];
const ENTORNO_ORIGINAL: Record<string, string | undefined> = Object.fromEntries(
  VARIABLES.map((v) => [v, process.env[v]]),
);
const FETCH_ORIGINAL = globalThis.fetch;

function configurarGoogle(publica = PUBLICA) {
  process.env.TELO_PUBLIC_URL = publica;
  process.env.TELO_GOOGLE_CLIENT_ID = CLIENTE_ID;
  process.env.TELO_GOOGLE_CLIENT_SECRET = SECRETO_CLIENTE;
  process.env.TELO_CLAVE_CIFRADO = CLAVE_CIFRADO;
}

function quitarConfiguracion() {
  for (const v of VARIABLES) delete process.env[v];
}

type Llamada = { url: string; init: RequestInit };
let llamadas: Llamada[] = [];

// Sustituye fetch: registra cada llamada y responde con lo que devuelva el manejador.
function simularGoogle(manejador: (url: string) => Response) {
  llamadas = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    llamadas.push({ url, init });
    return manejador(url);
  }) as unknown as typeof fetch;
}

// Respuestas de Google para un flujo completo: token con refresh, correo de la cuenta y revocación.
function googleFeliz(refresh: string, correo = "persona@ejemplo.test") {
  return (url: string): Response => {
    if (url === URL_TOKEN) {
      return Response.json({ access_token: "acceso-prueba", refresh_token: refresh, scope: "openid email" });
    }
    if (url === URL_USUARIO) return Response.json({ sub: "1234567890", email: correo });
    if (url === URL_REVOCAR) return new Response("", { status: 200 });
    return new Response("", { status: 404 });
  };
}

// Inicia un flujo como lo haría la interfaz y lee el verificador PKCE que quedó guardado.
async function pedirConexion(): Promise<{ estado: string; verificador: string; url: URL }> {
  const res = await googleRoute.request("/google/conectar", { method: "POST" });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const parsed = new URL(url);
  const estado = parsed.searchParams.get("state") ?? "";
  const fila = db
    .query<{ verificador: string }, [string]>("SELECT verificador FROM oauth_estados WHERE estado = ?")
    .get(estado);
  return { estado, verificador: fila?.verificador ?? "", url: parsed };
}

function regreso(query: Record<string, string>) {
  return googleRoute.request(`/google/callback?${new URLSearchParams(query).toString()}`);
}

async function estadoApi(): Promise<{
  configurado: boolean;
  faltantes: string[];
  conectado: boolean;
  cuenta: string | null;
}> {
  return (await (await googleRoute.request("/google/estado")).json()) as {
    configurado: boolean;
    faltantes: string[];
    conectado: boolean;
    cuenta: string | null;
  };
}

function ubicacion(res: Response): string {
  return res.headers.get("location") ?? "";
}

function contarFilas(tabla: string): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${tabla}`).get()?.n ?? 0;
}

afterEach(() => {
  globalThis.fetch = FETCH_ORIGINAL;
  for (const v of VARIABLES) {
    const valor = ENTORNO_ORIGINAL[v];
    if (valor === undefined) delete process.env[v];
    else process.env[v] = valor;
  }
  db.exec("DELETE FROM oauth_estados; DELETE FROM oauth_conexiones;");
});

describe("PKCE", () => {
  test("el desafío S256 coincide con el ejemplo de la RFC 7636", () => {
    expect(desafioPKCE("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("configuración", () => {
  test("sin variables, el estado nombra lo que falta y conectar responde 503 sin crear estado", async () => {
    quitarConfiguracion();
    const estado = await estadoApi();
    expect(estado.configurado).toBe(false);
    expect(estado.faltantes).toEqual(expect.arrayContaining(VARIABLES));

    const res = await googleRoute.request("/google/conectar", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "google_no_configurado" });
    expect(contarFilas("oauth_estados")).toBe(0);
  });

  test("una dirección pública sin https no vale, pero localhost sí (desarrollo)", async () => {
    configurarGoogle("http://ejemplo.test");
    expect((await estadoApi()).faltantes).toContain("TELO_PUBLIC_URL");

    configurarGoogle("http://localhost:3000");
    expect((await estadoApi()).configurado).toBe(true);
  });
});

describe("conectar", () => {
  test("la URL de Google lleva PKCE, estado y permiso sin conexión, y nunca el secreto", async () => {
    configurarGoogle();
    const { url, estado, verificador } = await pedirConexion();

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENTE_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${PUBLICA}/api/google/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(desafioPKCE(verificador));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(estado.length).toBeGreaterThanOrEqual(32);
    expect(url.toString()).not.toContain(SECRETO_CLIENTE);
  });

  test("el estado caduca a los 10 minutos", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    const fila = db
      .query<{ expira_en: string }, [string]>("SELECT expira_en FROM oauth_estados WHERE estado = ?")
      .get(estado);
    const restante = Date.parse(fila?.expira_en ?? "") - Date.now();
    expect(restante).toBeGreaterThan(9 * 60_000);
    expect(restante).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("regreso desde Google", () => {
  test("un estado que no existe no llama a Google y vuelve a Ajustes con un motivo fijo", async () => {
    configurarGoogle();
    simularGoogle(googleFeliz("no-debe-usarse"));
    const res = await regreso({ code: "codigo-falso", state: "estado-inventado" });
    expect(res.status).toBe(302);
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_estado_invalido");
    expect(llamadas).toHaveLength(0);
    expect(contarFilas("oauth_conexiones")).toBe(0);
  });

  test("un estado sirve una sola vez", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle(googleFeliz("refresh-uno"));

    expect(ubicacion(await regreso({ code: "codigo-1", state: estado }))).toBe("/ajustes?google=ok");
    expect(ubicacion(await regreso({ code: "codigo-1", state: estado }))).toBe(
      "/ajustes?google=error&motivo=google_estado_invalido",
    );
    expect(llamadas.filter((l) => l.url === URL_TOKEN)).toHaveLength(1);
  });

  test("un estado caducado se rechaza sin llamar a Google", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    db.query("UPDATE oauth_estados SET expira_en = ? WHERE estado = ?").run("2020-01-01T00:00:00.000Z", estado);
    simularGoogle(googleFeliz("refresh-caducado"));

    const res = await regreso({ code: "codigo-2", state: estado });
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_estado_invalido");
    expect(llamadas).toHaveLength(0);
  });

  test("cancelar en Google gasta el estado y no guarda nada", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle(googleFeliz("no-debe-usarse"));

    const res = await regreso({ error: "access_denied", state: estado });
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_cancelado");
    expect(contarFilas("oauth_estados")).toBe(0);
    expect(llamadas).toHaveLength(0);
  });

  test("el intercambio manda el verificador y el secreto en el cuerpo, no en la URL", async () => {
    configurarGoogle();
    const { estado, verificador } = await pedirConexion();
    simularGoogle(googleFeliz("refresh-cuerpo"));
    await regreso({ code: "codigo-3", state: estado });

    const token = llamadas.find((l) => l.url === URL_TOKEN);
    expect(token?.init.method).toBe("POST");
    const cuerpo = new URLSearchParams(String(token?.init.body));
    expect(cuerpo.get("code")).toBe("codigo-3");
    expect(cuerpo.get("code_verifier")).toBe(verificador);
    expect(cuerpo.get("client_secret")).toBe(SECRETO_CLIENTE);
    expect(cuerpo.get("redirect_uri")).toBe(`${PUBLICA}/api/google/callback`);

    const usuario = llamadas.find((l) => l.url === URL_USUARIO);
    expect(new Headers(usuario?.init.headers).get("Authorization")).toBe("Bearer acceso-prueba");
    for (const l of llamadas) expect(l.url).not.toContain(SECRETO_CLIENTE);
  });

  test("guarda el token de actualización cifrado y la API solo devuelve el correo", async () => {
    configurarGoogle();
    const refresh = `refresh-${randomBytes(16).toString("hex")}`;
    const { estado } = await pedirConexion();
    simularGoogle(googleFeliz(refresh, "persona@ejemplo.test"));

    expect(ubicacion(await regreso({ code: "codigo-4", state: estado }))).toBe("/ajustes?google=ok");

    const fila = db
      .query<{ iv: string; tag: string; value_enc: string }, []>(
        "SELECT iv, tag, value_enc FROM oauth_conexiones WHERE proveedor = 'google'",
      )
      .get();
    const clave = claveMaestra();
    if (!clave || !fila) throw new Error("Faltan la conexión guardada o la clave de cifrado");
    expect(JSON.stringify(fila)).not.toContain(refresh);
    expect(descifrar(clave, fila, "oauth:google")).toBe(refresh);
    // El token va atado a su tipo: con otro texto asociado no se abre.
    expect(() => descifrar(clave, fila, "oauth:otra-cosa")).toThrow();

    const cuerpo = await (await googleRoute.request("/google/estado")).text();
    expect(cuerpo).toContain("persona@ejemplo.test");
    expect(cuerpo).not.toContain(refresh);
    expect(cuerpo).not.toContain(SECRETO_CLIENTE);
    expect(cuerpo).not.toContain("acceso-prueba");
  });

  test("sin token de actualización no guarda nada y lo dice", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle(() => Response.json({ access_token: "acceso-prueba", scope: "openid email" }));

    const res = await regreso({ code: "codigo-5", state: estado });
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_sin_refresh");
    expect(contarFilas("oauth_conexiones")).toBe(0);
  });

  test("si Google rechaza el código, no guarda nada", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const res = await regreso({ code: "codigo-6", state: estado });
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_fallido");
    expect(contarFilas("oauth_conexiones")).toBe(0);
  });

  test("si no se puede leer la cuenta, revoca el token recién emitido y no guarda nada", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle((url) => {
      if (url === URL_USUARIO) return new Response("", { status: 500 });
      return googleFeliz("refresh-huerfano")(url);
    });

    const res = await regreso({ code: "codigo-11", state: estado });
    expect(ubicacion(res)).toBe("/ajustes?google=error&motivo=google_fallido");
    expect(contarFilas("oauth_conexiones")).toBe(0);
    const revocacion = llamadas.find((l) => l.url === URL_REVOCAR);
    expect(new URLSearchParams(String(revocacion?.init.body)).get("token")).toBe("refresh-huerfano");
  });

  test("reconectar otra cuenta revoca el token anterior", async () => {
    configurarGoogle();
    const anterior = `refresh-anterior-${randomBytes(6).toString("hex")}`;
    const primero = await pedirConexion();
    simularGoogle(googleFeliz(anterior, "uno@ejemplo.test"));
    await regreso({ code: "codigo-7", state: primero.estado });

    const segundo = await pedirConexion();
    simularGoogle(googleFeliz("refresh-nuevo", "dos@ejemplo.test"));
    expect(ubicacion(await regreso({ code: "codigo-8", state: segundo.estado }))).toBe("/ajustes?google=ok");

    const revocacion = llamadas.find((l) => l.url === URL_REVOCAR);
    expect(new URLSearchParams(String(revocacion?.init.body)).get("token")).toBe(anterior);
    expect((await estadoApi()).cuenta).toBe("dos@ejemplo.test");
  });
});

describe("desconectar", () => {
  test("borra la conexión y revoca el token enviándolo en el cuerpo", async () => {
    configurarGoogle();
    const refresh = `refresh-baja-${randomBytes(6).toString("hex")}`;
    const { estado } = await pedirConexion();
    simularGoogle(googleFeliz(refresh));
    await regreso({ code: "codigo-9", state: estado });

    simularGoogle(googleFeliz(refresh));
    const res = await googleRoute.request("/google", { method: "DELETE" });
    expect(await res.json()).toEqual({ ok: true });
    expect(contarFilas("oauth_conexiones")).toBe(0);

    const revocacion = llamadas.find((l) => l.url === URL_REVOCAR);
    expect(revocacion).toBeDefined();
    expect(new URLSearchParams(String(revocacion?.init.body)).get("token")).toBe(refresh);
    expect(revocacion?.url).not.toContain(refresh);
  });

  test("si Google no responde, la conexión local se borra igual", async () => {
    configurarGoogle();
    const { estado } = await pedirConexion();
    simularGoogle(googleFeliz("refresh-sin-red"));
    await regreso({ code: "codigo-10", state: estado });

    simularGoogle(() => {
      throw new Error("red caída");
    });
    const res = await googleRoute.request("/google", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(contarFilas("oauth_conexiones")).toBe(0);
  });

  test("desconectar sin conexión responde ok y no llama a Google", async () => {
    simularGoogle(googleFeliz("no-debe-usarse"));
    const res = await googleRoute.request("/google", { method: "DELETE" });
    expect(await res.json()).toEqual({ ok: true });
    expect(llamadas).toHaveLength(0);
  });
});
