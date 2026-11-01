import { db } from "./db";
import { cifrar, claveMaestra, descifrar, type CifradoSecreto } from "./secretos";

type InstalacionGithubAppGuardada = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  repository_selection: "all" | "selected";
  configuration_url?: string | null;
};

export function instalacionGithubApp(): InstalacionGithubAppGuardada | null {
  const row = db
    .query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_app_installation'")
    .get();
  if (!row) return null;
  try {
    const data = JSON.parse(row.value) as InstalacionGithubAppGuardada;
    return Number.isSafeInteger(data.id) && data.id > 0 && typeof data.login === "string" ? data : null;
  } catch {
    return null;
  }
}

export type GithubCuenta = {
  conectado: boolean;
  login?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string[];
  actualizado_en?: string;
  metodo?: "app" | "token";
  sesion_anterior?: boolean;
};

export type GithubAuthStorage = {
  token: string;
  login: string;
  name: string;
  avatar_url: string;
  scopes: string[];
  actualizado_en: string;
};

const KEY = "github_global_auth";
const AAD = "app_settings|github_global_auth";
type GithubAuthEncrypted = CifradoSecreto & { version: 1 };

function cuentaGlobalGuardada(): GithubAuthStorage | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key = ?")
    .get(KEY);
  if (!row) return null;
  try {
    const guardado = JSON.parse(row.value) as Partial<GithubAuthStorage & GithubAuthEncrypted>;
    if (guardado.version === 1 && guardado.iv && guardado.tag && guardado.value_enc) {
      const clave = claveMaestra();
      if (!clave) return null;
      return JSON.parse(descifrar(clave, guardado as GithubAuthEncrypted, AAD)) as GithubAuthStorage;
    }
    // Compatibilidad con filas previas: se cifran al primer acceso cuando ya existe clave maestra.
    if (typeof guardado.token !== "string" || !guardado.token.trim()) return null;
    const cuenta = guardado as GithubAuthStorage;
    const clave = claveMaestra();
    if (clave) {
      const cifrado = cifrar(clave, JSON.stringify(cuenta), AAD);
      const nuevoValor: GithubAuthEncrypted = { version: 1, ...cifrado };
      db.query(
        "UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND value = ?",
      ).run(JSON.stringify(nuevoValor), KEY, row.value);
    }
    return cuenta;
  } catch {
    return null;
  }
}

// Lee el token global de GitHub guardado en app_settings.
// Tiene prioridad sobre los tokens por proyecto para que la sesión activa de la cuenta sea la identidad de GitHub.
export function tokenGithubGlobal(): string | null {
  return cuentaGlobalGuardada()?.token.trim() || null;
}

export function cuentaGithubGlobal(): GithubCuenta {
  const instalacion = instalacionGithubApp();
  if (instalacion) {
    return {
      conectado: true,
      login: instalacion.login,
      name: instalacion.name,
      avatar_url: instalacion.avatar_url,
      metodo: "app",
      sesion_anterior: !!tokenGithubGlobal(),
    };
  }
  const data = cuentaGlobalGuardada();
  if (!data?.token) return { conectado: false };
  return {
    conectado: true,
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
    scopes: data.scopes ?? [],
    actualizado_en: data.actualizado_en,
    metodo: "token",
  };
}

export function guardarCuentaGithubGlobal(data: GithubAuthStorage): void {
  const clave = claveMaestra();
  if (!clave) throw new Error("clave_sin_cifrado");
  const guardado: GithubAuthEncrypted = { version: 1, ...cifrar(clave, JSON.stringify(data), AAD) };
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, JSON.stringify(guardado));
}

export function borrarCuentaGithubGlobal(): void {
  db.query("DELETE FROM app_settings WHERE key = ?").run(KEY);
}
