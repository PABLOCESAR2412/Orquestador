import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { db } from "./db";

export const COOKIE_SESION = "telo_sesion";
export const MIN_CARACTERES_CLAVE = 16;

export type SesionInfo = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  actual?: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Compara resúmenes SHA-256 para que la longitud de la clave no se filtre.
function iguales(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function claveCorrecta(intento: string): boolean {
  return config.clave !== null && iguales(intento, config.clave);
}

// Crea una sesión dinámica para el dispositivo actual con un token criptográfico único.
export function crearSesionDispositivo(opts: { userAgent?: string; ip?: string }): { id: string; token: string } {
  const id = crypto.randomUUID();
  const secreto = randomBytes(24).toString("hex");
  const token = `telo-ses-${id}-${secreto}`;
  const th = hashToken(token);
  try {
    db.query(
      "INSERT INTO auth_sessions (id, token_hash, user_agent, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))",
    ).run(id, th, opts.userAgent?.slice(0, 500) ?? null, opts.ip?.slice(0, 100) ?? null);
  } catch {
    // Si la tabla no está creada aún en migraciones muy tempranas, no falla
  }
  return { id, token };
}

const ultimasVistas = new Map<string, number>();
const INTERVALO_ACTUALIZACION_SESION_MS = 5 * 60_000;
const DIAS_INACTIVIDAD_SESION = 60;

// Solo acepta sesiones registradas: todas pueden revocarse.
export function sesionValida(valor: string | undefined): boolean {
  if (config.sinClave) return true;
  if (!valor) return false;

  // 1. Búsqueda en auth_sessions por hash del token
  try {
    const th = hashToken(valor);
    const row = db.query<{ id: string; vigente: number }, [number, string]>(
      "SELECT id, last_seen_at > datetime('now', '-' || ? || ' days') AS vigente FROM auth_sessions WHERE token_hash = ?",
    ).get(DIAS_INACTIVIDAD_SESION, th);
    if (row) {
      if (row.vigente !== 1) {
        db.query("DELETE FROM auth_sessions WHERE id = ?").run(row.id);
        ultimasVistas.delete(row.id);
        return false;
      }
      const ahora = Date.now();
      const ultima = ultimasVistas.get(row.id) ?? 0;
      if (ahora - ultima >= INTERVALO_ACTUALIZACION_SESION_MS) {
        ultimasVistas.set(row.id, ahora);
        try {
          db.query("UPDATE auth_sessions SET last_seen_at = datetime('now') WHERE id = ?").run(row.id);
        } catch {
          // Si la base está ocupada, la sesión sigue siendo válida
        }
      }
      return true;
    }
  } catch {
    // Si la base no está disponible, se rechaza la sesión.
  }

  // El HMAC antiguo no admite revocación: exige un nuevo inicio de sesión.
  return false;
}

export function obtenerIdSesion(valor: string | undefined): string | null {
  if (!valor) return null;
  try {
    const th = hashToken(valor);
    const row = db.query<{ id: string }, [string]>("SELECT id FROM auth_sessions WHERE token_hash = ?").get(th);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export function listarSesiones(tokenActual?: string): SesionInfo[] {
  try {
    const actualId = obtenerIdSesion(tokenActual);
    const rows = db
      .query<SesionInfo, []>(
        "SELECT id, user_agent, ip, created_at, last_seen_at FROM auth_sessions ORDER BY last_seen_at DESC",
      )
      .all();
    return rows.map((r) => ({
      ...r,
      actual: actualId !== null && r.id === actualId,
    }));
  } catch {
    return [];
  }
}

export function revocarSesion(id: string): boolean {
  try {
    const res = db.query("DELETE FROM auth_sessions WHERE id = ?").run(id);
    return res.changes > 0;
  } catch {
    return false;
  }
}

export function revocarOtrasSesiones(tokenActual?: string): number {
  try {
    const actualId = obtenerIdSesion(tokenActual);
    if (!actualId) {
      const res = db.query("DELETE FROM auth_sessions").run();
      return res.changes;
    }
    const res = db.query("DELETE FROM auth_sessions WHERE id != ?").run(actualId);
    return res.changes;
  } catch {
    return 0;
  }
}

export function cerrarSesionPorToken(token: string): void {
  try {
    const th = hashToken(token);
    db.query("DELETE FROM auth_sessions WHERE token_hash = ?").run(th);
  } catch {
    // Si la tabla no existe se ignora
  }
}

// Limpia sesiones que no han tenido actividad en más de N días (por defecto 60).
export function limpiarSesionesAntiguas(dias = DIAS_INACTIVIDAD_SESION): number {
  try {
    const res = db
      .query("DELETE FROM auth_sessions WHERE last_seen_at < datetime('now', '-' || ? || ' days')")
      .run(dias);
    return res.changes;
  } catch {
    return 0;
  }
}

