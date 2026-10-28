import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { db } from "../db";
import { config } from "../config";
import { cifrar, claveMaestra, descifrar, type CifradoSecreto } from "../secretos";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const IDENTITY_SCOPES = "openid email";
const CALLBACK_PATH = "/api/google-drive/oauth/callback";
const STATE_COOKIE = "telo_google_drive_state";
const STATE_COOKIE_PATH = CALLBACK_PATH;
const STATE_TTL_MS = 10 * 60_000;
const TOKEN_AAD = "google-drive|refresh-token";

type EstadoOAuth = { code_verifier: string };
type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  error?: unknown;
};
type UserInfo = { sub?: unknown; email?: unknown; email_verified?: unknown };
type ConexionDrive = {
  account_email: string;
  account_id: string;
  scope: string;
  iv: string;
  tag: string;
  value_enc: string;
};

export const googleDriveOAuth = new Hono();

export function callbackUriGoogleDrive(): string | null {
  if (!config.publicUrl) return null;
  try {
    const url = new URL(config.publicUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) return null;
    if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) return null;
    return `${url.origin}${CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

export function googleDriveConfigurado(): boolean {
  return Boolean(config.googleDriveClientId && config.googleDriveClientSecret && callbackUriGoogleDrive());
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function conectado(): Pick<ConexionDrive, "account_email" | "account_id" | "scope"> | null {
  return db
    .query<Pick<ConexionDrive, "account_email" | "account_id" | "scope">, []>(
      "SELECT account_email, account_id, scope FROM google_drive_connection WHERE id = 1",
    )
    .get() ?? null;
}

function pagina(
  c: Context,
  titulo: string,
  texto: string,
  email?: string,
  status: 200 | 400 | 502 | 503 = 200,
) {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const cuenta = email ? `<p>Cuenta conectada: <strong>${email.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)}</strong></p>` : "";
  return c.html(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><main><h1>${titulo}</h1><p>${texto}</p>${cuenta}<a href="/">Volver a Telo</a></main></html>`, status);
}

function borrarCookie(c: Context, seguro: boolean) {
  deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, httpOnly: true, sameSite: "Lax", secure: seguro });
}

// Estado de conexión y callback exacto para registrar en Google Cloud. No devuelve credenciales.
googleDriveOAuth.get("/google-drive/status", (c) => {
  const uri = callbackUriGoogleDrive();
  const cuenta = conectado();
  return c.json({
    configurado: googleDriveConfigurado(),
    cifrado_disponible: Boolean(claveMaestra()),
    conectado: Boolean(cuenta),
    cuenta: cuenta?.account_email ?? null,
    callback_uri: uri,
  });
});

// Inicia OAuth desde una sesión autenticada. El estado se ata a una cookie HttpOnly SameSite=Lax,
// válida en el retorno superior desde Google, y la autorización usa PKCE S256.
googleDriveOAuth.get("/google-drive/oauth/start", (c) => {
  const redirectUri = callbackUriGoogleDrive();
  if (!config.googleDriveClientId || !config.googleDriveClientSecret || !redirectUri) {
    return c.json({ error: "google_drive_oauth_sin_configurar" }, 503);
  }
  if (!claveMaestra()) return c.json({ error: "clave_cifrado_no_configurada" }, 503);

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const ahora = Date.now();
  db.query("DELETE FROM google_drive_oauth_states WHERE expira_ms <= ?").run(ahora);
  db.query("INSERT INTO google_drive_oauth_states (state_hash, code_verifier, expira_ms) VALUES (?, ?, ?)")
    .run(sha256(state), verifier, ahora + STATE_TTL_MS);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.googleDriveClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `${IDENTITY_SCOPES} ${DRIVE_SCOPE}`);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const seguro = new URL(redirectUri).protocol === "https:";
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: seguro,
    path: STATE_COOKIE_PATH,
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  c.header("Cache-Control", "no-store");
  return c.redirect(url.toString(), 302);
});

// Google redirige aquí; la validación de cookie + estado hace segura esta ruta pública.
googleDriveOAuth.get("/google-drive/oauth/callback", async (c) => {
  const redirectUri = callbackUriGoogleDrive();
  const seguro = redirectUri ? new URL(redirectUri).protocol === "https:" : true;
  const state = c.req.query("state") ?? "";
  const cookie = getCookie(c, STATE_COOKIE) ?? "";
  const stateValido = state.length === 43 && state === cookie;
  const hash = stateValido ? sha256(state) : "";
  const consumir = db.transaction((stateHash: string, ahora: number) => {
    const fila = db
      .query<EstadoOAuth, [string, number]>(
        "SELECT code_verifier FROM google_drive_oauth_states WHERE state_hash = ? AND expira_ms > ?",
      )
      .get(stateHash, ahora);
    if (!fila) return null;
    db.query("DELETE FROM google_drive_oauth_states WHERE state_hash = ?").run(stateHash);
    return fila;
  });
  const estado = stateValido ? consumir(hash, Date.now()) : null;
  borrarCookie(c, seguro);
  if (!estado) return pagina(c, "Conexión no validada", "El enlace de autorización venció o no coincide. Vuelve a iniciar la conexión desde Telo.", undefined, 400);
  if (c.req.query("error")) return pagina(c, "Conexión cancelada", "Google no autorizó el acceso. Puedes volver a intentarlo desde Telo.");

  const code = c.req.query("code") ?? "";
  if (!/^[A-Za-z0-9._~/-]{1,2048}$/.test(code) || !config.googleDriveClientId || !config.googleDriveClientSecret || !redirectUri) {
    return pagina(c, "No se pudo conectar Drive", "La respuesta de Google está incompleta. Revisa la configuración OAuth de Telo.", undefined, 400);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleDriveClientId,
        client_secret: config.googleDriveClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: estado.code_verifier,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) return pagina(c, "No se pudo conectar Drive", "Google rechazó la autorización. Revisa el cliente y la URL de retorno registrada.", undefined, 502);
    const tokens = await tokenResponse.json() as TokenResponse;
    if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
      return pagina(c, "Falta autorización persistente", "Google no devolvió el permiso de actualización. Revoca el acceso de Telo en tu Cuenta de Google y vuelve a conectarlo.", undefined, 502);
    }

    const [userResponse, driveResponse] = await Promise.all([
      fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15_000),
      }),
      fetch("https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15_000),
      }),
    ]);
    if (!userResponse.ok || !driveResponse.ok) {
      return pagina(c, "No se pudo verificar Drive", "La API de Drive no aceptó el permiso. Comprueba que Drive API esté habilitada y vuelve a autorizar Telo.", undefined, 502);
    }
    const user = await userResponse.json() as UserInfo;
    if (typeof user.sub !== "string" || typeof user.email !== "string" || user.email_verified !== true) {
      return pagina(c, "Cuenta de Google no verificada", "Google no confirmó la cuenta autorizada. Vuelve a intentarlo con la cuenta correcta.", undefined, 502);
    }

    const clave = claveMaestra();
    if (!clave) return pagina(c, "Falta cifrado en Telo", "Configura la clave de cifrado del servidor antes de guardar la autorización de Drive.", undefined, 503);
    const cifrado = cifrar(clave, tokens.refresh_token, TOKEN_AAD);
    const alcance = typeof tokens.scope === "string" ? tokens.scope : `${IDENTITY_SCOPES} ${DRIVE_SCOPE}`;
    db.query(
      `INSERT INTO google_drive_connection (id, account_email, account_id, scope, iv, tag, value_enc, actualizado_en)
       VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET account_email=excluded.account_email, account_id=excluded.account_id,
       scope=excluded.scope, iv=excluded.iv, tag=excluded.tag, value_enc=excluded.value_enc,
       actualizado_en=excluded.actualizado_en`,
    ).run(user.email, user.sub, alcance, cifrado.iv, cifrado.tag, cifrado.value_enc);
    return pagina(c, "Google Drive conectado", "Telo ya puede solicitar acceso a los archivos que cree o que autorices.", user.email);
  } catch {
    return pagina(c, "No se pudo conectar Drive", "Hubo un problema temporal al completar OAuth. Vuelve a iniciar la conexión desde Telo.", undefined, 502);
  }
});

// Expone un token corto solo a operaciones internas de almacenamiento; nunca a la interfaz ni a los agentes.
export async function obtenerTokenAccesoGoogleDrive(): Promise<string | null> {
  try {
    const clave = claveMaestra();
    if (!clave) return null;
    const conexion = db
      .query<ConexionDrive, []>("SELECT account_email, account_id, scope, iv, tag, value_enc FROM google_drive_connection WHERE id = 1")
      .get();
    if (!conexion) return null;
    const refreshToken = descifrar(clave, conexion as CifradoSecreto, TOKEN_AAD);
    if (!config.googleDriveClientId || !config.googleDriveClientSecret) return null;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.googleDriveClientId,
        client_secret: config.googleDriveClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const tokens = await response.json() as TokenResponse;
    return typeof tokens.access_token === "string" ? tokens.access_token : null;
  } catch {
    return null;
  }
}

googleDriveOAuth.delete("/google-drive/connection", (c) => {
  if (db.query("SELECT 1 FROM google_drive_archive_jobs WHERE state IN ('queued','running') LIMIT 1").get()) {
    return c.json({ error: "google_drive_job_in_progress" }, 409);
  }
  db.query("DELETE FROM google_drive_connection WHERE id = 1").run();
  db.query("DELETE FROM google_drive_oauth_states").run();
  return c.json({ ok: true });
});
