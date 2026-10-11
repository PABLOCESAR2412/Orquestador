// Inicio de sesión con Google (OAuth 2.0 con PKCE) para la cuenta del único usuario.
//
// Flujo:
// 1. POST /api/google/conectar (con sesión) guarda un estado y un verificador PKCE, y devuelve la URL de Google.
// 2. El navegador va a Google y el usuario acepta.
// 3. Google vuelve a /api/google/callback con un código y el mismo estado.
//
// El callback no pide sesión: la llamada llega desde otro sitio y la cookie SameSite=Strict no viaja.
// Lo que lo protege es el estado: solo existe si una sesión válida lo creó, sirve una vez y caduca.
//
// Guardamos solo el token de actualización, cifrado con la clave de secretos (AAD "oauth:google").
// El token de acceso se usa una vez para leer el correo y se descarta. El secreto del cliente va en
// el cuerpo de las peticiones POST, nunca en una URL.

import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import { db } from "./db";
import { cifrar, claveMaestra, descifrar } from "./secretos";

const PROVEEDOR = "google";
const AAD = "oauth:google";
const URL_AUTORIZACION = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_REVOCAR = "https://oauth2.googleapis.com/revoke";
const URL_USUARIO = "https://openidconnect.googleapis.com/v1/userinfo";
// Solo identidad: el correo de la cuenta. La lectura de uso pedirá su propio permiso cuando se pruebe.
const ALCANCE = "openid email";
const CADUCIDAD_ESTADO_MS = 10 * 60_000;
const TIEMPO_MAX_RED_MS = 15_000;

export type CodigoGoogle =
  | "google_no_configurado"
  | "google_estado_invalido"
  | "google_cancelado"
  | "google_fallido"
  | "google_sin_refresh";

// Error con un código fijo para la interfaz. Nunca lleva detalles de Google ni tokens.
export class ErrorGoogle extends Error {
  constructor(
    readonly code: CodigoGoogle,
    readonly status: 400 | 502 | 503,
  ) {
    super(code);
  }
}

export type EstadoGoogle = {
  configurado: boolean;
  faltantes: string[];
  conectado: boolean;
  cuenta: string | null;
  conectado_en: string | null;
};

type ConfigGoogle = {
  clienteId: string;
  clienteSecreto: string;
  redireccion: string;
  clave: Buffer;
};

type FilaConexion = { iv: string; tag: string; value_enc: string };

// Solo acepta https; http se permite únicamente para localhost (desarrollo).
function urlPublica(): URL | null {
  const texto = config.publicUrl;
  if (!texto) return null;
  try {
    const url = new URL(texto);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url;
  } catch {
    return null;
  }
}

// Nombres de las variables que faltan. Nunca sus valores.
export function faltantesGoogle(): string[] {
  const faltan: string[] = [];
  if (!urlPublica()) faltan.push("TELO_PUBLIC_URL");
  if (!config.googleClientId) faltan.push("TELO_GOOGLE_CLIENT_ID");
  if (!config.googleClientSecret) faltan.push("TELO_GOOGLE_CLIENT_SECRET");
  if (!claveMaestra()) faltan.push("TELO_CLAVE_CIFRADO");
  return faltan;
}

function configuracionGoogle(): ConfigGoogle | null {
  const base = urlPublica();
  const clave = claveMaestra();
  if (!base || !config.googleClientId || !config.googleClientSecret || !clave) return null;
  return {
    clienteId: config.googleClientId,
    clienteSecreto: config.googleClientSecret,
    redireccion: new URL("/api/google/callback", base.origin).toString(),
    clave,
  };
}

// Desafío PKCE S256: base64url(sha256(verificador)). RFC 7636, apartado 4.2.
export function desafioPKCE(verificador: string): string {
  return createHash("sha256").update(verificador).digest("base64url");
}

// Crea el estado y devuelve la URL de autorización. Lanza ErrorGoogle si falta configuración.
export function iniciarConexionGoogle(): string {
  const cfg = configuracionGoogle();
  if (!cfg) throw new ErrorGoogle("google_no_configurado", 503);

  const estado = randomBytes(24).toString("base64url");
  const verificador = randomBytes(32).toString("base64url");
  const ahora = new Date();
  db.query("DELETE FROM oauth_estados WHERE expira_en < ?").run(ahora.toISOString());
  db.query("INSERT INTO oauth_estados (estado, verificador, expira_en) VALUES (?, ?, ?)").run(
    estado,
    verificador,
    new Date(ahora.getTime() + CADUCIDAD_ESTADO_MS).toISOString(),
  );

  const url = new URL(URL_AUTORIZACION);
  url.search = new URLSearchParams({
    client_id: cfg.clienteId,
    redirect_uri: cfg.redireccion,
    response_type: "code",
    scope: ALCANCE,
    state: estado,
    code_challenge: desafioPKCE(verificador),
    code_challenge_method: "S256",
    // Pedimos token de actualización: sin acceso sin conexión Google no lo entrega.
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

// Consume el estado: lo borra siempre (sirve una sola vez) y devuelve el verificador solo si no caducó.
// Las dos consultas van en una transacción síncrona, así que dos regresos no pueden usar el mismo estado.
function consumirEstado(estado: string | undefined): string | null {
  if (!estado || estado.length > 128) return null;
  return db.transaction(() => {
    const fila = db
      .query<{ verificador: string; expira_en: string }, [string]>(
        "SELECT verificador, expira_en FROM oauth_estados WHERE estado = ?",
      )
      .get(estado);
    db.query("DELETE FROM oauth_estados WHERE estado = ?").run(estado);
    if (!fila || fila.expira_en < new Date().toISOString()) return null;
    return fila.verificador;
  })();
}

type RespuestaToken = { access_token: string; refresh_token?: string; scope?: string };

async function pedirTokens(cfg: ConfigGoogle, codigo: string, verificador: string): Promise<RespuestaToken> {
  const respuesta = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: codigo,
      client_id: cfg.clienteId,
      client_secret: cfg.clienteSecreto,
      redirect_uri: cfg.redireccion,
      grant_type: "authorization_code",
      code_verifier: verificador,
    }),
    signal: AbortSignal.timeout(TIEMPO_MAX_RED_MS),
  }).catch(() => null);
  if (!respuesta?.ok) throw new ErrorGoogle("google_fallido", 502);
  const json = (await respuesta.json().catch(() => null)) as Partial<RespuestaToken> | null;
  if (!json?.access_token) throw new ErrorGoogle("google_fallido", 502);
  return { access_token: json.access_token, refresh_token: json.refresh_token, scope: json.scope };
}

async function pedirCuenta(accessToken: string): Promise<{ email: string; id: string }> {
  const respuesta = await fetch(URL_USUARIO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIEMPO_MAX_RED_MS),
  }).catch(() => null);
  const json = respuesta?.ok
    ? ((await respuesta.json().catch(() => null)) as { sub?: string; email?: string } | null)
    : null;
  if (!json?.sub || !json.email) throw new ErrorGoogle("google_fallido", 502);
  return { email: json.email, id: json.sub };
}

// Revoca un token de actualización en Google. Es de mejor esfuerzo: si Google no responde, no bloquea.
// El token va en el cuerpo, nunca en la URL.
async function revocarToken(token: string): Promise<void> {
  await fetch(URL_REVOCAR, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(TIEMPO_MAX_RED_MS),
  }).catch(() => undefined);
}

// Revoca el token de una fila guardada (cifrado). Si la clave no descifra, no hay nada que revocar aquí.
async function revocarFila(fila: FilaConexion): Promise<void> {
  const clave = claveMaestra();
  if (!clave) return;
  let token: string;
  try {
    token = descifrar(clave, fila, AAD);
  } catch {
    return;
  }
  await revocarToken(token);
}

// Procesa el regreso desde Google. Lanza ErrorGoogle con un código fijo si algo falla.
export async function completarConexionGoogle(params: {
  code?: string;
  state?: string;
  error?: string;
}): Promise<void> {
  const cfg = configuracionGoogle();
  if (!cfg) throw new ErrorGoogle("google_no_configurado", 503);

  // El estado se consume antes de mirar nada más: un intento, sea cual sea su resultado, no se reutiliza.
  const verificador = consumirEstado(params.state);
  if (!verificador) throw new ErrorGoogle("google_estado_invalido", 400);
  if (params.error) throw new ErrorGoogle("google_cancelado", 400);
  if (!params.code || params.code.length > 2048) throw new ErrorGoogle("google_fallido", 502);

  const tokens = await pedirTokens(cfg, params.code, verificador);
  if (!tokens.refresh_token) throw new ErrorGoogle("google_sin_refresh", 502);
  let cuenta: { email: string; id: string };
  try {
    cuenta = await pedirCuenta(tokens.access_token);
  } catch (err) {
    await revocarToken(tokens.refresh_token);
    throw err;
  }

  const anterior = db
    .query<FilaConexion, [string]>("SELECT iv, tag, value_enc FROM oauth_conexiones WHERE proveedor = ?")
    .get(PROVEEDOR);
  const cifrado = cifrar(cfg.clave, tokens.refresh_token, AAD);
  db.query(
    `INSERT INTO oauth_conexiones (proveedor, cuenta_email, cuenta_id, alcance, iv, tag, value_enc, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(proveedor) DO UPDATE SET
       cuenta_email = excluded.cuenta_email, cuenta_id = excluded.cuenta_id, alcance = excluded.alcance,
       iv = excluded.iv, tag = excluded.tag, value_enc = excluded.value_enc, actualizado_en = excluded.actualizado_en`,
  ).run(PROVEEDOR, cuenta.email, cuenta.id, tokens.scope ?? ALCANCE, cifrado.iv, cifrado.tag, cifrado.value_enc);

  // Si había otra cuenta conectada, su token ya no se usa: se revoca.
  if (anterior) await revocarFila(anterior);
}

export function estadoGoogle(): EstadoGoogle {
  const faltantes = faltantesGoogle();
  const fila = db
    .query<{ cuenta_email: string; actualizado_en: string }, [string]>(
      "SELECT cuenta_email, actualizado_en FROM oauth_conexiones WHERE proveedor = ?",
    )
    .get(PROVEEDOR);
  return {
    configurado: faltantes.length === 0,
    faltantes,
    conectado: fila !== null,
    cuenta: fila?.cuenta_email ?? null,
    conectado_en: fila?.actualizado_en ?? null,
  };
}

// Borra la conexión local y revoca el token en Google. Si la revocación falla, la conexión local se borra igual.
export async function desconectarGoogle(): Promise<void> {
  const fila = db
    .query<FilaConexion, [string]>("SELECT iv, tag, value_enc FROM oauth_conexiones WHERE proveedor = ?")
    .get(PROVEEDOR);
  if (!fila) return;
  db.query("DELETE FROM oauth_conexiones WHERE proveedor = ?").run(PROVEEDOR);
  await revocarFila(fila);
}
