// Reglas de proyectos compartidas por el diálogo de alta, la lista y la configuración.

export const MAX_NOMBRE_PROYECTO = 60;

// Misma regla que el servidor para el nombre de la carpeta: sin acentos, minúsculas y guiones.
export function carpetaDe(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Ruta visible de la carpeta de un proyecto en el servidor.
export function rutaCarpeta(carpeta: string): string {
  return `/srv/orquestador/projects/${carpeta}`;
}
