// Tema por dispositivo: se guarda en este navegador, no en el servidor.
// "oscuro" es el tema de siempre; "claro" invierte los tokens; "sistema" sigue al dispositivo.
export type Tema = "sistema" | "oscuro" | "claro";

const CLAVE = "telo:tema";
const VALORES: Tema[] = ["sistema", "oscuro", "claro"];

export function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v && (VALORES as string[]).includes(v)) return v as Tema;
  } catch {
    // Sin almacenamiento disponible (navegación privada, por ejemplo): se usa el valor por defecto.
  }
  return "oscuro";
}

// Pone el tema en <html data-theme>. Sin atributo, los tokens de :root aplican (oscuro).
export function aplicarTema(tema: Tema = leerTema()) {
  const el = document.documentElement;
  if (tema === "sistema") el.removeAttribute("data-theme");
  else el.dataset.theme = tema;
}

export function guardarTema(tema: Tema) {
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento: el cambio dura hasta recargar.
  }
  aplicarTema(tema);
}
