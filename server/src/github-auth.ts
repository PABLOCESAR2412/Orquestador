import { db } from "./db";
import { cifrar, claveMaestra, descifrar, type CifradoSecreto } from "./secretos";

type InstalacionGithubAppGuardada = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  repository_selection: "all" | "selected";
  configuration_url?: string | null;
  account_id?: number | null;
  account_type?: "User" | "Organization" | null;
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
  id?: number;
  account_type?: "User" | "Organization" | null;
};

export type GithubAuthStorage = {
  token: string;
  login: string;
  name: string;
  avatar_url: string;
  scopes: string[];
  actualizado_en: string;
  id?: number;
  account_type?: "User" | "Organization" | null;
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
      id: instalacion.account_id ?? undefined,
      account_type: instalacion.account_type,
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
    id: data.id,
    account_type: data.account_type,
  };
}

// Solo una cuenta personal identificada por GitHub puede proporcionar la identidad noreply.
// Los correos elegidos expresamente para un proyecto se conservan.
export function autorGit(guardado?: { author_name?: string | null; author_email?: string | null } | null): { author_name: string; author_email: string } {
  const cuenta = cuentaGithubGlobal();
  const personal = cuenta.account_type === "User" && Number.isSafeInteger(cuenta.id) && cuenta.id! > 0 && /^[A-Za-z0-9-]+$/.test(cuenta.login ?? "");
  const email = guardado?.author_email;
  const heredado = cuenta.login ? `${cuenta.login}@users.noreply.github.com`.toLowerCase() : null;
  const predeterminado = !email || email === "telo@localhost" || email.toLowerCase() === heredado;
  return {
    author_name: guardado?.author_name && guardado.author_name !== "Telo" ? guardado.author_name : personal ? cuenta.name || cuenta.login! : "Telo",
    author_email: predeterminado ? personal ? `${cuenta.id}+${cuenta.login}@users.noreply.github.com` : "telo@localhost" : email,
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
