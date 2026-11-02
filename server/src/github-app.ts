import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "./config";
import { db } from "./db";
import { instalacionGithubApp } from "./github-auth";

const API = "https://api.github.com";
const VERSION_API = "2026-03-10";
const AGENTE = "Telo-Orquestador";

export type PermisosGithubApp = { contents?: "read" | "write"; pull_requests?: "read" | "write"; actions?: "read" };

export type InstalacionGithubApp = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  repository_selection: "all" | "selected";
  permissions: Record<string, "read" | "write">;
  configuration_url: string | null;
  account_id?: number | null;
  account_type?: "User" | "Organization" | null;
};

type InstalacionApi = {
  id: number;
  account?: { id?: number; type?: string; login?: string; name?: string | null; avatar_url?: string } | null;
  repository_selection?: "all" | "selected";
  permissions?: Record<string, "read" | "write">;
  html_url?: string;
};

export class ErrorGithubApp extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 502 | 503 = 502) {
    super(message);
  }
}

function configuracion() {
  const appId = config.githubAppId || "";
  const keyPath = config.githubAppPrivateKeyPath || "";
  const faltantes = [
    ...(!/^\d+$/.test(appId) ? ["TELO_GITHUB_APP_ID"] : []),
    ...(!keyPath ? ["TELO_GITHUB_APP_PRIVATE_KEY_PATH"] : []),
  ];
  return { appId, keyPath, faltantes, configurado: faltantes.length === 0 };
}

export function estadoGithubApp() {
  const { faltantes, configurado } = configuracion();
  return { configurado, faltantes };
}

function clavePrivada(): string {
  const cfg = configuracion();
  if (!cfg.configurado) throw new ErrorGithubApp("github_app_no_configurada", "Falta configurar la GitHub App en el servidor.", 503);
  try {
    return readFileSync(cfg.keyPath, "utf8");
  } catch {
    throw new ErrorGithubApp("github_app_clave_ilegible", "El servidor no puede leer la clave privada de la GitHub App.", 503);
  }
}

function codificarBase64Url(valor: string): string {
  return Buffer.from(valor).toString("base64url");
}

function jwtDeApp(): string {
  const cfg = configuracion();
  const ahora = Math.floor(Date.now() / 1000);
  const encabezado = codificarBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const carga = codificarBase64Url(JSON.stringify({ iss: cfg.appId, iat: ahora - 30, exp: ahora + 9 * 60 }));
  const sinFirma = `${encabezado}.${carga}`;
  try {
    const firmador = createSign("RSA-SHA256");
    firmador.update(sinFirma);
    return `${sinFirma}.${firmador.sign(clavePrivada()).toString("base64url")}`;
  } catch (error) {
    if (error instanceof ErrorGithubApp) throw error;
    throw new ErrorGithubApp("github_app_clave_invalida", "La clave privada de la GitHub App no es válida.", 503);
  }
}

async function llamarGithub<T>(ruta: string, token: string, body?: unknown): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": AGENTE,
        "X-GitHub-Api-Version": VERSION_API,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ErrorGithubApp("github_sin_conexion", "No se pudo conectar con api.github.com.", 503);
  }
  if (!respuesta.ok) {
    if ([403, 404, 422].includes(respuesta.status) && ruta.includes("/access_tokens")) {
      const cuerpo = bodyComoRegistro(body);
      const permiso = cuerpo?.permissions && typeof cuerpo.permissions === "object"
        ? Object.keys(cuerpo.permissions as Record<string, unknown>)[0]
        : null;
      const nombrePermiso = permiso === "pull_requests" ? "Pull requests" : permiso === "actions" ? "Actions" : "Contents";
      throw new ErrorGithubApp(
        "github_app_sin_acceso",
        `La GitHub App no puede usar ${nombrePermiso} en este repositorio. Comprueba que el repo esté incluido en la instalación y que la App tenga el acceso solicitado en GitHub.`,
        403,
      );
    }
    if (respuesta.status === 404 || respuesta.status === 422) {
      throw new ErrorGithubApp("github_app_sin_acceso", "La GitHub App no tiene acceso a ese repositorio o le falta el permiso solicitado. Revisa la instalación y los permisos de la App en GitHub.", 403);
    }
    if (respuesta.status === 401) {
      throw new ErrorGithubApp("github_app_credencial_rechazada", "GitHub rechazó la configuración de la App. Revisa el App ID y la clave privada del servidor.", 503);
    }
    if (respuesta.status === 403) {
      throw new ErrorGithubApp("github_app_error", "GitHub rechazó la consulta de instalaciones. Revisa el App ID y la clave privada configurados en el servidor.", 502);
    }
    throw new ErrorGithubApp("github_app_error", `GitHub respondió con error ${respuesta.status}.`, 502);
  }
  return (await respuesta.json()) as T;
}

async function jwtGet<T>(ruta: string): Promise<T> {
  return llamarGithub<T>(ruta, jwtDeApp());
}

export async function listarInstalacionesGithubApp(): Promise<InstalacionGithubApp[]> {
  const data = await jwtGet<InstalacionApi[]>("/app/installations?per_page=100");
  return data.map(normalizarInstalacion).filter((i): i is InstalacionGithubApp => i !== null);
}

function normalizarInstalacion(i: InstalacionApi): InstalacionGithubApp | null {
  if (!Number.isSafeInteger(i.id) || i.id <= 0 || !i.account?.login) return null;
  return {
      id: i.id,
      login: i.account!.login!,
      name: i.account!.name?.trim() || i.account!.login!,
      avatar_url: i.account!.avatar_url || "",
      repository_selection: i.repository_selection === "all" ? "all" : "selected",
      permissions: Object.fromEntries(
        Object.entries(i.permissions ?? {}).filter(([, permiso]) => permiso === "read" || permiso === "write"),
      ) as Record<string, "read" | "write">,
      configuration_url: urlConfiguracionGithub(i.html_url),
      account_id: Number.isSafeInteger(i.account.id) && i.account.id! > 0 ? i.account.id! : null,
      account_type: i.account.type === "User" || i.account.type === "Organization" ? i.account.type : null,
  };
}

function bodyComoRegistro(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function urlConfiguracionGithub(valor: string | undefined): string | null {
  try {
    const url = new URL(valor ?? "");
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function seleccionarInstalacionGithubApp(id: number): Promise<InstalacionGithubApp> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ErrorGithubApp("github_instalacion_invalida", "Selecciona una instalación válida.", 400);
  }
  const instalacion = (await listarInstalacionesGithubApp()).find((i) => i.id === id);
  if (!instalacion) {
    throw new ErrorGithubApp("github_instalacion_no_encontrada", "Esa instalación no pertenece a la GitHub App configurada.", 404);
  }
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('github_app_installation', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(instalacion));
  return instalacion;
}

export function instalacionSeleccionadaGithubApp(): InstalacionGithubApp | null {
  const row = db.query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_app_installation'").get();
  if (!row) return null;
  try {
    const dato = JSON.parse(row.value) as InstalacionGithubApp;
    return Number.isSafeInteger(dato.id) && typeof dato.login === "string" ? dato : null;
  } catch {
    return null;
  }
}

export function borrarInstalacionGithubApp(): void {
  db.query("DELETE FROM app_settings WHERE key='github_app_installation'").run();
}

function propietarioYRepo(remoto: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(remoto);
  } catch {
    throw new ErrorGithubApp("github_repo_invalido", "La URL de GitHub no es válida.", 400);
  }
  const partes = url.pathname.replace(/\.git\/?$/, "").replace(/^\/+|\/+$/g, "").split("/");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    partes.length !== 2 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(partes[0] ?? "") ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(partes[1] ?? "")
  ) {
    throw new ErrorGithubApp("github_repo_invalido", "La URL de GitHub no es válida.", 400);
  }
  return { owner: partes[0], repo: partes[1] };
}

export async function tokenGithubAppParaRepo(
  remoto: string,
  permisos: PermisosGithubApp,
): Promise<string | null> {
  const instalacion = instalacionGithubApp();
  if (!instalacion) return null;
  const { owner, repo } = propietarioYRepo(remoto);
  if (owner.toLowerCase() !== instalacion.login.toLowerCase()) {
    throw new ErrorGithubApp("github_app_sin_acceso", "La GitHub App seleccionada está instalada en otra cuenta. Vincula la instalación que contiene este repositorio.", 403);
  }
  // Una instalación guardada por versiones anteriores no conservaba el ID de la cuenta.
  // Enriquecer estos metadatos no cambia sus permisos ni reescribe commits existentes.
  if (instalacion.account_id === undefined || instalacion.account_type === undefined) {
    try {
      const actual = normalizarInstalacion(await jwtGet<InstalacionApi>(`/app/installations/${instalacion.id}`));
      if (actual && actual.id === instalacion.id && actual.login.toLowerCase() === instalacion.login.toLowerCase() && instalacionGithubApp()?.id === instalacion.id) {
        db.query("UPDATE app_settings SET value=?,updated_at=datetime('now') WHERE key='github_app_installation'").run(JSON.stringify(actual));
      }
    } catch { /* La emisión del token mantiene su diagnóstico propio si no se puede refrescar el perfil. */ }
  }
  const body = {
    repositories: [repo],
    permissions: permisos,
  };
  let respuesta: { token: string };
  try {
    respuesta = await llamarGithub<{ token: string }>(
      `/app/installations/${instalacion.id}/access_tokens`,
      jwtDeApp(),
      body,
    );
  } catch (error) {
    if (!(error instanceof ErrorGithubApp) || error.code !== "github_app_sin_acceso") throw error;
    const destino = instalacion.configuration_url ?? "https://github.com/settings/installations";
    const nombres: Record<string, string> = { contents: "Contents", pull_requests: "Pull requests", actions: "Actions" };
    const permisosNecesarios = Object.entries(permisos).map(([nombre, acceso]) => `${nombres[nombre] ?? nombre}: ${acceso === "write" ? "Read and write" : "Read-only"}`).join(", ");
    throw new ErrorGithubApp(
      "github_app_sin_acceso",
      `GitHub denegó la instalación de Telo para ${owner}/${repo}. Abre ${destino} y en Configure incluye este repo o todos los repos. En Developer settings → GitHub Apps → Telo-Orquestador → Permissions & events, confirma ${permisosNecesarios} y acepta la actualización de permisos. Después reintenta.`,
      403,
    );
  }
  if (!respuesta.token) throw new ErrorGithubApp("github_app_token_invalido", "GitHub no devolvió una credencial de instalación.");

  return respuesta.token;
}

