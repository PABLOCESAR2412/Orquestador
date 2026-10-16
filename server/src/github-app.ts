import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "./config";
import { db } from "./db";
import { instalacionGithubApp } from "./github-auth";

const API = "https://api.github.com";
const VERSION_API = "2026-03-10";
const AGENTE = "Telo-Orquestador";

export type PermisosGithubApp = { contents?: "read" | "write"; pull_requests?: "read" | "write" };

export type InstalacionGithubApp = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  repository_selection: "all" | "selected";
};

type InstalacionApi = {
  id: number;
  account?: { login?: string; name?: string | null; avatar_url?: string } | null;
  repository_selection?: "all" | "selected";
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
    if (respuesta.status === 404 || respuesta.status === 422) {
      throw new ErrorGithubApp("github_app_sin_acceso", "La GitHub App no tiene acceso a ese repositorio o le falta el permiso solicitado. Revisa la instalación y los permisos de la App en GitHub.", 403);
    }
    if (respuesta.status === 401) {
      throw new ErrorGithubApp("github_app_credencial_rechazada", "GitHub rechazó la configuración de la App. Revisa el App ID y la clave privada del servidor.", 503);
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
  return data
    .filter((i) => Number.isSafeInteger(i.id) && i.id > 0 && !!i.account?.login)
    .map((i) => ({
      id: i.id,
      login: i.account!.login!,
      name: i.account!.name?.trim() || i.account!.login!,
      avatar_url: i.account!.avatar_url || "",
      repository_selection: i.repository_selection === "all" ? "all" : "selected",
    }));
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
  const body = {
    repositories: [repo],
    permissions: permisos,
  };
  const respuesta = await llamarGithub<{ token: string }>(
    `/app/installations/${instalacion.id}/access_tokens`,
    jwtDeApp(),
    body,
  );
  if (!respuesta.token) throw new ErrorGithubApp("github_app_token_invalido", "GitHub no devolvió una credencial de instalación.");

  return respuesta.token;
}
