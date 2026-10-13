// Adjuntos del chat. El agente solo recibe texto: los archivos de texto viajan dentro del mensaje entre marcas,
// y el chat los vuelve a mostrar como tarjetas al leer el mensaje. Imágenes y PDF no se envían todavía.

export type Adjunto = { nombre: string; contenido: string };

// Tope por archivo y por mensaje. El cuerpo HTTP del servidor es de 64 KB; con este tope cabe con margen.
export const TOPE_ADJUNTO_CARACTERES = 24_000;
// Archivos más grandes que esto se rechazan antes de leerlos.
const TOPE_ARCHIVO_BYTES = 512 * 1024;

const EXTENSIONES_TEXTO = [
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "css", "js", "jsx",
  "ts", "tsx", "py", "sql", "log", "sh", "go", "rs", "java", "rb", "php", "c", "h", "cpp", "cs", "swift", "kt",
];

const ABRE = '<<adjunto nombre="';
const CIERRA = "<</adjunto>>";

const limpiarNombre = (nombre: string) => nombre.replace(/["\r\n<>]/g, "_").slice(0, 120);

// Mensaje que se envía: el texto del usuario y, después, cada archivo entre sus marcas.
export function componerMensaje(texto: string, adjuntos: Adjunto[]): string {
  const bloques = adjuntos.map(
    (a) => `${ABRE}${limpiarNombre(a.nombre)}">>\n${a.contenido.split(CIERRA).join("<\\/adjunto>>")}\n${CIERRA}`,
  );
  return [texto.trim(), ...bloques].filter((t) => t !== "").join("\n\n");
}

// Separa el texto del usuario de los adjuntos guardados en el mensaje.
export function partirMensaje(contenido: string): { texto: string; adjuntos: Adjunto[] } {
  const adjuntos: Adjunto[] = [];
  const re = /<<adjunto nombre="([^"]+)">>\n([\s\S]*?)\n<<\/adjunto>>/g;
  const texto = contenido.replace(re, (_, nombre: string, cuerpo: string) => {
    adjuntos.push({ nombre, contenido: cuerpo.split("<\\/adjunto>>").join(CIERRA) });
    return "";
  });
  return { texto: texto.trim(), adjuntos };
}

export type ArchivoLeido =
  | { tipo: "texto"; adjunto: Adjunto; recortado: boolean; tamano: number }
  | { tipo: "solo_vista"; nombre: string; motivo: string; tamano: number; imagen: boolean }
  | { tipo: "error"; nombre: string; motivo: string; tamano: number };

function esTexto(archivo: File): boolean {
  if (archivo.type.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript"].includes(archivo.type)) return true;
  const ext = archivo.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONES_TEXTO.includes(ext);
}

// Lee un archivo del navegador. Solo los de texto llegan al agente; el resto se muestra, pero no se envía.
export async function leerArchivo(archivo: File): Promise<ArchivoLeido> {
  const tamano = archivo.size;
  if (archivo.type.startsWith("image/")) {
    return {
      tipo: "solo_vista",
      nombre: archivo.name,
      motivo: "Las imágenes no llegan al agente todavía.",
      tamano,
      imagen: true,
    };
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
