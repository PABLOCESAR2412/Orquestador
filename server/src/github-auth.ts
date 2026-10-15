import { db } from "./db";

export type GithubCuenta = {
  conectado: boolean;
  login?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string[];
  actualizado_en?: string;
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

// Lee el token global de GitHub guardado en app_settings.
// Tiene prioridad sobre los tokens por proyecto para que la sesión activa de la cuenta sea la identidad de GitHub.
export function tokenGithubGlobal(): string | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key = ?")
    .get(KEY);
  if (!row) return null;
  try {
    const data = JSON.parse(row.value) as GithubAuthStorage;
    return typeof data.token === "string" && data.token.trim() ? data.token.trim() : null;
  } catch {
    return null;
  }
}

export function cuentaGithubGlobal(): GithubCuenta {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key = ?")
    .get(KEY);
  if (!row) return { conectado: false };
  try {
    const data = JSON.parse(row.value) as GithubAuthStorage;
    if (!data.token) return { conectado: false };
    return {
      conectado: true,
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
      scopes: data.scopes ?? [],
      actualizado_en: data.actualizado_en,
    };
  } catch {
    return { conectado: false };
  }
}

export function guardarCuentaGithubGlobal(data: GithubAuthStorage): void {
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, JSON.stringify(data));
}

export function borrarCuentaGithubGlobal(): void {
  db.query("DELETE FROM app_settings WHERE key = ?").run(KEY);
}
