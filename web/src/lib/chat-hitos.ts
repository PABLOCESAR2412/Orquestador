// Marcas locales de mensajes importantes, separadas por conversación.
const PREFIJO_HITOS = "telo:hitos:";

export function leerHitos(): Record<string, string[]> {
  const hitos: Record<string, string[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave?.startsWith(PREFIJO_HITOS)) continue;
      const valor: unknown = JSON.parse(localStorage.getItem(clave) ?? "null");
      if (Array.isArray(valor)) hitos[clave.slice(PREFIJO_HITOS.length)] = valor.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Las marcas siguen disponibles en memoria si el navegador no permite usar el almacenamiento.
  }
  return hitos;
}

export function guardarHitos(conversacionId: string, ids: string[]): void {
  try {
    const clave = `${PREFIJO_HITOS}${conversacionId}`;
    if (ids.length) localStorage.setItem(clave, JSON.stringify(ids));
    else localStorage.removeItem(clave);
  } catch {
    // Se conserva el estado de esta sesión aunque el almacenamiento esté lleno o bloqueado.
  }
}
