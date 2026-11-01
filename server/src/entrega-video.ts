import { leerVideo, normalizarRuta } from "./archivos-proyecto";

const PATRONES_RUTA_MP4 = [
  /`([^`\r\n]{1,1024}\.mp4)`/giu,
  /\[[^\]]{1,160}\]\(([^)\s]{1,1024}\.mp4)(?:#[^)]*)?\)/giu,
  /(?<![\p{L}\p{N}_.-])((?:[\p{L}\p{N}_.-]+[\\/])*[\p{L}\p{N}_-]+\.mp4)(?![\p{L}\p{N}_.-])/giu,
];

export function requiereEntregaVideo(prompt: string): boolean {
  const texto = prompt.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const video = /\b(?:videos?|clips?|animaciones?)\b/.test(texto);
  if (!video) return false;
  if (/^[\s¿¡]*(?:como|que|por que|explica|describe|ensena)\b/.test(texto)) return false;
  const accion = /\b(?:crea(?:r)?|genera(?:r)?|haz(?:me|lo)?|produce|renderiza(?:r)?|edita(?:r)?|corrige|modifica(?:r)?|actualiza(?:r)?|anade|anadir|pon(?:er|ga|gas)?|incorpora|entrega(?:r)?|envia(?:r)?|descarga(?:r)?|comparte|dame)\b/.test(texto);
  const deseo = /\b(?:quiero|quisiera|necesito|me gustaria)\b.{0,100}\b(?:video|clip|animacion)/.test(texto);
  return accion || deseo;
}

// Acepta solo rutas relativas que el propio chat puede servir y cuyo contenido tenga firma MP4.
export function buscarVideoVerificado(texto: string, raices: string[]): string | null {
  const candidatos = new Set<string>();
  for (const patron of PATRONES_RUTA_MP4) {
    for (const coincidencia of texto.matchAll(patron)) {
      const ruta = coincidencia[1]?.trim();
      if (ruta) candidatos.add(ruta);
    }
  }

  for (const candidato of candidatos) {
    let segmentos: string[];
    try {
      segmentos = normalizarRuta(candidato);
    } catch {
      continue;
    }
    if (segmentos.length === 0 || !segmentos.at(-1)!.toLowerCase().endsWith(".mp4")) continue;
    for (const raiz of raices) {
      try {
        const archivo = leerVideo(raiz, segmentos);
        archivo.cerrar();
        return segmentos.join("/");
      } catch {
        // Las rutas de salida citadas por un agente pueden no existir o no ser MP4 válidos.
      }
    }
  }
  return null;
}

export function promptRecuperarEntregaVideo(solicitud: string, respuestaAnterior: string): string {
  const extracto = respuestaAnterior.replace(/\s+/g, " ").trim().slice(0, 900);
  return [
    "Chequeo de entrega de video: la solicitud requiere un archivo final y la respuesta anterior no proporcionó una ruta MP4 verificable.",
    "Revisa el workspace y la carpeta de entregables del chat. No repitas trabajo ni render si el archivo ya existe; si existe, responde con su ruta relativa exacta. Si no existe, termina el video y verifica el MP4 antes de responder. Usa un nombre simple sin espacios.",
    "Si no puedes completar o localizar un MP4 válido, dilo como bloqueo y no afirmes que el video fue entregado.",
    `Solicitud original: ${solicitud.slice(0, 1_600)}`,
    extracto ? `Respuesta anterior: ${extracto}` : "",
  ].filter(Boolean).join("\n\n");
}

export function anexarEnlaceVideo(texto: string, ruta: string): string {
  const enlace = `[Ver o descargar el video](${ruta})`;
  if (texto.includes(`](${ruta})`)) return texto;
  return `${texto.trim()}\n\n## Video entregado\n${enlace}`;
}
