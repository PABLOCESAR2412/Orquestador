// Los adjuntos de texto viajan entre marcas; las imágenes incluyen una referencia segura al archivo subido.

export type Adjunto = { nombre: string; contenido: string };
export type AdjuntoImagen = { id: string; nombre: string };

// Tope por archivo y por mensaje. El cuerpo HTTP del servidor es de 64 KB; con este tope cabe con margen.
export const TOPE_ADJUNTO_CARACTERES = 24_000;
// Archivos más grandes que esto se rechazan antes de leerlos.
const TOPE_ARCHIVO_BYTES = 512 * 1024;

const EXTENSIONES_TEXTO = [
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "css", "js", "jsx",
  "ts", "tsx", "py", "sql", "log", "sh", "go", "rs", "java", "rb", "php", "c", "h", "cpp", "cs", "swift", "kt",
];
const EXTENSIONES_IMAGEN = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MIME_IMAGEN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TOPE_IMAGEN_BYTES = 8 * 1024 * 1024;

const ABRE = '<<adjunto nombre="';
const CIERRA = "<</adjunto>>";
const MARCADOR_IMAGEN = /<<telo-imagen id="([a-f\d-]{36})" nombre="([^"\r\n<>]{1,120})">>/gi;

const limpiarNombre = (nombre: string) => nombre.replace(/["\r\n<>]/g, "_").slice(0, 120);

// Mensaje que se envía: el texto del usuario y, después, cada archivo entre sus marcas.
export function componerMensaje(texto: string, adjuntos: Adjunto[], imagenes: AdjuntoImagen[] = []): string {
  const bloques = adjuntos.map(
    (a) => `${ABRE}${limpiarNombre(a.nombre)}">>\n${a.contenido.split(CIERRA).join("<\\/adjunto>>")}\n${CIERRA}`,
  );
  const referencias = imagenes.map((imagen) => `<<telo-imagen id="${imagen.id}" nombre="${limpiarNombre(imagen.nombre)}">>`);
  return [texto.trim(), ...bloques, ...referencias].filter((t) => t !== "").join("\n\n");
}

// Separa el texto del usuario de los adjuntos guardados en el mensaje.
export function partirMensaje(contenido: string): { texto: string; adjuntos: Adjunto[]; imagenes: AdjuntoImagen[] } {
  const adjuntos: Adjunto[] = [];
  const re = /<<adjunto nombre="([^"]+)">>\n([\s\S]*?)\n<<\/adjunto>>/g;
  const texto = contenido.replace(re, (_, nombre: string, cuerpo: string) => {
    adjuntos.push({ nombre, contenido: cuerpo.split("<\\/adjunto>>").join(CIERRA) });
    return "";
  });
  const imagenes: AdjuntoImagen[] = [];
  const sinImagenes = texto.replace(MARCADOR_IMAGEN, (_marcador, id: string, nombre: string) => {
    imagenes.push({ id, nombre });
    return "";
  });
  return { texto: sinImagenes.trim(), adjuntos, imagenes };
}

export type ArchivoLeido =
  | { tipo: "texto"; adjunto: Adjunto; recortado: boolean; tamano: number }
  | { tipo: "imagen"; archivo: File; nombre: string; tamano: number }
  | { tipo: "solo_vista"; nombre: string; motivo: string; tamano: number; imagen: boolean }
  | { tipo: "error"; nombre: string; motivo: string; tamano: number };

function esTexto(archivo: File): boolean {
  if (archivo.type.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript"].includes(archivo.type)) return true;
  const ext = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONES_TEXTO.includes(ext);
}

// Lee texto localmente y reserva las imágenes raster para subirlas al endpoint autenticado del chat.
export async function leerArchivo(archivo: File): Promise<ArchivoLeido> {
  const tamano = archivo.size;
  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  if (archivo.type.startsWith("image/") || EXTENSIONES_IMAGEN.has(extension)) {
    if ((archivo.type && !MIME_IMAGEN.has(archivo.type)) || !EXTENSIONES_IMAGEN.has(extension)) {
      return { tipo: "solo_vista", nombre: archivo.name, motivo: "Solo se admiten imágenes PNG, JPEG, GIF o WebP.", tamano, imagen: true };
    }
    if (tamano === 0 || tamano > TOPE_IMAGEN_BYTES) {
      return { tipo: "error", nombre: archivo.name, motivo: "La imagen debe pesar como máximo 8 MB.", tamano };
    }
    return { tipo: "imagen", archivo, nombre: archivo.name, tamano };
  }
  if (!esTexto(archivo)) {
    return {
      tipo: "solo_vista",
      nombre: archivo.name,
      motivo: "Este tipo de archivo no se puede leer todavía. Pega su texto en el mensaje.",
      tamano,
      imagen: false,
    };
  }
  if (archivo.size > TOPE_ARCHIVO_BYTES) {
    return { tipo: "error", nombre: archivo.name, motivo: "El archivo pesa más de 512 KB.", tamano };
  }
  try {
    const texto = await archivo.text();
    const recortado = texto.length > TOPE_ADJUNTO_CARACTERES;
    return {
      tipo: "texto",
      adjunto: { nombre: archivo.name, contenido: recortado ? texto.slice(0, TOPE_ADJUNTO_CARACTERES) : texto },
      recortado,
      tamano,
    };
  } catch {
    return { tipo: "error", nombre: archivo.name, motivo: "No se pudo leer el archivo.", tamano };
  }
}

// Tamaño legible del archivo original para las tarjetas de adjuntos.
export function etiquetaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
