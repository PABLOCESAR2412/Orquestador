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
