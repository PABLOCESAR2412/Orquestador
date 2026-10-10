import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

// Acceso con una clave única (TELO_CLAVE). No hay cuentas ni tabla de sesiones:
// la cookie es un HMAC de una constante con la clave. Cambiar la clave cierra todas las sesiones.

export const COOKIE_SESION = "telo_sesion";
export const MIN_CARACTERES_CLAVE = 16;
const CONTEXTO_SESION = "telo-sesion-v1";

export function tokenSesion(): string | null {
  if (!config.clave) return null;
  return createHmac("sha256", config.clave).update(CONTEXTO_SESION).digest("hex");
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

export function sesionValida(valor: string | undefined): boolean {
  if (config.sinClave) return true;
  const esperado = tokenSesion();
  return esperado !== null && valor !== undefined && iguales(valor, esperado);
}
