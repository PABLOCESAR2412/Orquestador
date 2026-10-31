import { homedir } from "node:os";

// Carpeta personal del usuario del servidor, leída en cada uso: el HOME que llega en el entorno manda,
// como en aislamiento.ts. Sirve para las skills globales, los CLIs y sus sesiones.
export function carpetaHome(): string {
  const env = process.env.HOME;
  return env && env !== "/" ? env : homedir();
}
