// Los adjuntos de texto viajan entre marcas; las imágenes incluyen referencias seguras a archivos subidos.

export type Adjunto = { nombre: string; contenido: string };
export type AdjuntoImagen = { id: string; nombre: string };

// Tope por archivo y por mensaje. El cuerpo HTTP del servidor es de 64 KB; con este tope cabe con margen.
export const TOPE_ADJUNTO_CARACTERES = 24_000;
// Archivos más grandes que esto se rechazan antes de leerlos.
const TOPE_ARCHIVO_BYTES = 512 * 1024;
const TOPE_VIDEO_BYTES = 100 * 1024 * 1024;

const EXTENSIONES_TEXTO = [
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "css", "js", "jsx",
  "ts", "tsx", "py", "sql", "log", "sh", "go", "rs", "java", "rb", "php", "c", "h", "cpp", "cs", "swift", "kt",
];
const EXTENSIONES_IMAGEN = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MIME_IMAGEN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TOPE_IMAGEN_BYTES = 8 * 1024 * 1024;
const EXTENSIONES_VIDEO = new Set(["mp4", "webm"]);
const MIME_VIDEO = new Set(["video/mp4", "video/webm"]);

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
  | { tipo: "video"; archivo: File; nombre: string; tamano: number }
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
  if (archivo.type.startsWith("video/") || EXTENSIONES_VIDEO.has(extension)) {
    const mimeCompatible = !archivo.type || MIME_VIDEO.has(archivo.type) || archivo.type === "application/octet-stream";
    if (!mimeCompatible || !EXTENSIONES_VIDEO.has(extension)) {
      return { tipo: "solo_vista", nombre: archivo.name, motivo: "Solo se admiten videos MP4 o WebM.", tamano, imagen: false };
    }
    if (tamano === 0 || tamano > TOPE_VIDEO_BYTES) {
      return { tipo: "error", nombre: archivo.name, motivo: "El video debe pesar como máximo 100 MB.", tamano };
    }
    return { tipo: "video", archivo, nombre: archivo.name, tamano };
  }
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

// Genera una hoja 2x2 que los modelos con entrada visual pueden analizar como resumen del clip.
// El audio no se transmite: la interfaz lo indica para no presentar los fotogramas como video completo.
export async function crearHojaFotogramas(archivo: File): Promise<File> {
  const url = URL.createObjectURL(archivo);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("No se pudo leer el video en este navegador."));
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error("El video no contiene fotogramas compatibles.");
    }

    const vertical = video.videoHeight > video.videoWidth;
    const anchoCelda = vertical ? 360 : 640;
    const altoCelda = vertical ? 640 : 360;
    const altoEtiqueta = 30;
    const canvas = document.createElement("canvas");
    canvas.width = anchoCelda * 2;
    canvas.height = (altoCelda + altoEtiqueta) * 2;
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("No se pudo preparar la vista del video.");

    const muestras = [0.08, 0.35, 0.65, 0.92];
    for (let indice = 0; indice < muestras.length; indice += 1) {
      const segundo = Math.min(video.duration * muestras[indice]!, Math.max(0, video.duration - 0.04));
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("El video tardó demasiado en decodificarse.")), 8_000);
        video.onseeked = () => { window.clearTimeout(timeout); resolve(); };
        video.onerror = () => { window.clearTimeout(timeout); reject(new Error("No se pudieron extraer fotogramas del video.")); };
        video.currentTime = segundo;
      });

      const columna = indice % 2;
      const fila = Math.floor(indice / 2);
      const x = columna * anchoCelda;
      const y = fila * (altoCelda + altoEtiqueta);
      contexto.fillStyle = "#111318";
      contexto.fillRect(x, y, anchoCelda, altoCelda + altoEtiqueta);
      const escala = Math.min(anchoCelda / video.videoWidth, altoCelda / video.videoHeight);
      const ancho = video.videoWidth * escala;
      const alto = video.videoHeight * escala;
      contexto.drawImage(video, x + (anchoCelda - ancho) / 2, y + (altoCelda - alto) / 2, ancho, alto);
      contexto.fillStyle = "#111318";
      contexto.fillRect(x, y + altoCelda, anchoCelda, altoEtiqueta);
      contexto.fillStyle = "#f0f0f0";
      contexto.font = "14px sans-serif";
      contexto.fillText(`Fotograma ${indice + 1} · ${segundo.toFixed(1)} s`, x + 10, y + altoCelda + 20);
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((resultado) => resultado ? resolve(resultado) : reject(new Error("No se pudo crear la vista del video.")), "image/jpeg", 0.84);
    });
    const base = archivo.name.replace(/\.[^.]+$/, "").slice(0, 100);
    return new File([blob], `Fotogramas de ${base}.jpg`, { type: "image/jpeg" });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Tamaño legible del archivo original para las tarjetas de adjuntos.
export function etiquetaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
