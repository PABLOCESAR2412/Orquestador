// Gestión de la cola de mensajes fuera de línea o pendientes por chat.
// Se guardan en localStorage para sobrevivir a caídas de red o cambios de vista.

export type MensajeEnCola = { id: string; texto: string; creado: number };

const PREFIJO_COLA = "telo:cola:";
export const claveColaActiva = (id: string) => `telo:cola-activa:${id}`;

export function leerColas(): Record<string, MensajeEnCola[]> {
  const colas: Record<string, MensajeEnCola[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave?.startsWith(PREFIJO_COLA)) continue;
      const id = clave.slice(PREFIJO_COLA.length);
      const valor: unknown = JSON.parse(localStorage.getItem(clave) ?? "null");
      if (!Array.isArray(valor)) continue;
      colas[id] = valor.filter(
        (item): item is MensajeEnCola =>
          !!item && typeof item.id === "string" && typeof item.texto === "string" && typeof item.creado === "number",
      );
    }
  } catch {
    // Si el navegador no permite leer el almacenamiento, la cola vive en memoria.
  }
  return colas;
}

export function guardarCola(id: string, mensajes: MensajeEnCola[]): void {
  try {
    const clave = `${PREFIJO_COLA}${id}`;
    if (mensajes.length) localStorage.setItem(clave, JSON.stringify(mensajes));
    else localStorage.removeItem(clave);
  } catch {
    // La cola sigue disponible hasta cerrar esta pantalla.
  }
}

export function colaActivaPara(id: string | null): boolean {
  if (!id) return true;
  try {
    return localStorage.getItem(claveColaActiva(id)) !== "false";
  } catch {
    return true;
  }
}

export function fijarColaActiva(id: string, activa: boolean): void {
  try {
    localStorage.setItem(claveColaActiva(id), activa ? "true" : "false");
  } catch {
    // Si no hay acceso a almacenamiento se ignora.
  }
}
