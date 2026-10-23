// Persistencia de borradores por chat en localStorage.
// Permite que un mensaje no enviado sobreviva a cambios de pestaña o recargas.

const claveBorrador = (id: string) => `telo:borrador:${id}`;

export function leerBorrador(id: string): string {
  try {
    return localStorage.getItem(claveBorrador(id)) ?? "";
  } catch {
    return "";
  }
}

export function guardarBorrador(id: string, texto: string): void {
  try {
    if (texto) localStorage.setItem(claveBorrador(id), texto);
    else localStorage.removeItem(claveBorrador(id));
  } catch {
    // Sin almacenamiento disponible: se ignora.
  }
}

// Envío en vuelo: guarda lo que era el borrador mientras el servidor no confirma el mensaje.
// Si la app muere justo tras vaciar el compositor (recarga, cierre, pestaña), al reabrir el
// chat se reconstruye el borrador; y si el servidor ya lo guardó, el marcador se retira
// tirando del contenido exacto enviado, sin duplicar nada.
export interface EnvioEnVuelo {
  // El texto del compositor tal como lo escribió el usuario (con adjuntos aún no adjuntados).
  texto: string;
  // El mensaje compuesto y enviado, para reconocerlo en el hilo cuando ya está guardado.
  contenido: string;
  fecha: number;
}

const claveEnvio = (id: string) => `telo:envio:${id}`;

export function leerEnvio(id: string): EnvioEnVuelo | null {
  try {
    const bruto = localStorage.getItem(claveEnvio(id)) ?? "";
    if (!bruto) return null;
    const dato = JSON.parse(bruto) as EnvioEnVuelo;
    if (typeof dato?.texto !== "string" || typeof dato?.contenido !== "string") return null;
    return dato;
  } catch {
    return null;
  }
}

export function guardarEnvio(id: string, texto: string, contenido: string): void {
  try {
    localStorage.setItem(claveEnvio(id), JSON.stringify({ texto, contenido, fecha: Date.now() }));
  } catch {
    // Sin almacenamiento disponible: el borrador se comporta como hasta ahora.
  }
}

export function borrarEnvio(id: string): void {
  try {
    localStorage.removeItem(claveEnvio(id));
  } catch {
    // Sin almacenamiento disponible: se ignora.
  }
}
