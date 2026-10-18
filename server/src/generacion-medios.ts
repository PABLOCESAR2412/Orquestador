export type TipoMedio = "imagen" | "video";
export type ResolucionImagen = "1K" | "2K" | "4K";
export type ResolucionVideo = "720p" | "1080p" | "4k";

export type SolicitudMedio = {
  tipo: TipoMedio;
  prompt: string;
  modelo: string;
  resolucion: ResolucionImagen | ResolucionVideo;
  relacion: "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16";
  duracionSegundos: number | null;
  costoEstimadoUsd: number;
};

const MODELO_IMAGEN = "gemini-nano-banana-2.1";
const MODELO_VIDEO_LITE = "veo-3.1-lite-generate-preview";
const MODELO_VIDEO_FAST = "veo-3.1-fast-generate-preview";
const RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"] as const;
const ACCION_EXPLICITA = /^(?:(?:hola[, ]+)?(?:por favor[, ]+)?)?(?:me gustar[ií]a que me hagas|quisiera que me hagas|me puedes hacer|puedes hacerme|puedes crear(?:me)?|podr[ií]as crear(?:me)?|quiero que (?:me )?(?:generes?|hagas?|crees?|produzcas|dibujes|ilustres)|necesito que (?:me )?(?:generes?|hagas?|crees?|produzcas|dibujes|ilustres)|quiero (?:una?\s+(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip|animaci[oó]n|pel[ií]cula|logotipo|logo|p[oó]ster|infograf[ií]a)|generar\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip)|hacer\s+(?:un\s+)?(?:video|v[ií]deo|clip))|necesito (?:una?\s+(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip|animaci[oó]n|pel[ií]cula|logotipo|logo|p[oó]ster|infograf[ií]a)|generar\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip)|hacer\s+(?:un\s+)?(?:video|v[ií]deo|clip))|hazme|haz|genera(?:me)?|gen[eé]rame|crear|crea(?:me)?|dibuja|ilustra|produce|make|generate|create)\b/i;

function relacionDesde(prompt: string, defecto: SolicitudMedio["relacion"]): SolicitudMedio["relacion"] {
  const explicita = new RegExp(`(?:relaci[oó]n(?: de aspecto)?\\s*)?\\b(${RATIOS.map((r) => r.replace(":", "\\:")).join("|")})\\b`, "i").exec(prompt)?.[1];
  if (explicita) return RATIOS.find((r) => r.toLowerCase() === explicita.toLowerCase()) ?? defecto;
  if (/\b(vertical|retrato|portrait|m[oó]vil|stories|reel)\b/i.test(prompt)) return "9:16";
  if (/\b(horizontal|apaisad[oa]|panor[aá]mic[oa]|landscape|wide)\b/i.test(prompt)) return "16:9";
  return defecto;
}

export function detectarSolicitudMedio(texto: string): SolicitudMedio | null {
  const prompt = texto.trim();
  if (!prompt) return null;
  const comando = /^\/(imagen|video|v[ií]deo)\b\s*/i.exec(prompt);
  const esPeticion = Boolean(comando) || ACCION_EXPLICITA.test(prompt);
  if (
    !esPeticion ||
    /^(?:c[oó]mo|como|qu[eé]|cu[aá]l|por qu[eé])\b/i.test(prompt) ||
    /^(?:(?:quiero|necesito)\s+(?:saber|entender|analizar|revisar|describir|explicar|ver|evaluar)|(?:haz|hazme|puedes hacerme|podr[ií]as hacerme)\s+(?:un\s+)?an[aá]lisis)\b/i.test(prompt)
  ) return null;

  const tipo: TipoMedio | null = /\b(video|v[ií]deo|clip|animaci[oó]n|pel[ií]cula)\b/i.test(prompt)
    ? "video"
    : /\b(imagen|foto|ilustraci[oó]n|dibujo|logotipo|logo|p[oó]ster|poster|infograf[ií]a)\b/i.test(prompt)
      ? "imagen"
      : null;
  if (!tipo) return null;

  const relacion = relacionDesde(prompt, tipo === "video" ? "16:9" : "1:1");
  if (tipo === "imagen") {
    const peticion4k = /\b4\s*k\b/i.test(prompt);
    const peticion2k = /\b2\s*k\b/i.test(prompt);
    const resolucion: ResolucionImagen = peticion4k ? "4K" : peticion2k ? "2K" : "1K";
    const costo = resolucion === "4K" ? 0.113 : resolucion === "2K" ? 0.0504 : 0.0336;
    return { tipo, prompt, modelo: MODELO_IMAGEN, resolucion, relacion, duracionSegundos: null, costoEstimadoUsd: costo };
  }

  const solicitada = Number(/\b(4|6|8)\s*(?:s|seg(?:undos?)?)\b/i.exec(prompt)?.[1] ?? 4);
  const resolucion: ResolucionVideo = /\b4\s*k\b/i.test(prompt) ? "4k" : /\b1080\s*p\b/i.test(prompt) ? "1080p" : "720p";
  const duracionSegundos = resolucion === "720p" ? solicitada : 8;
  const modelo = resolucion === "4k" ? MODELO_VIDEO_FAST : MODELO_VIDEO_LITE;
  const costoPorSegundo = resolucion === "4k" ? 0.3 : resolucion === "1080p" ? 0.08 : 0.05;
  return { tipo, prompt, modelo, resolucion, relacion, duracionSegundos, costoEstimadoUsd: Number((costoPorSegundo * duracionSegundos).toFixed(3)) };
}

export function nombreDeMedio(prompt: string, tipo: TipoMedio): string {
  const base = prompt
    .replace(/^\/(?:imagen|video|v[ií]deo)\s*/i, "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  return `${base || (tipo === "imagen" ? "imagen-generada" : "video-generado")}.${tipo === "imagen" ? "png" : "mp4"}`;
}

function promptVisual(solicitud: SolicitudMedio): string {
  const direccion = solicitud.tipo === "video"
    ? "Dirección visual: conserva la continuidad del sujeto, la escena y el estilo durante todo el clip; usa movimiento de cámara deliberado y evita parpadeos, deformaciones o cambios de identidad. Respeta la duración, orientación y estilo solicitados."
    : /infograf[ií]a|l[ií]nea del tiempo|cronolog[ií]a|gr[aá]fico|diagrama|mapa mental|estad[ií]stica/i.test(solicitud.prompt)
      ? "Dirección visual para infografía: organiza la información en una retícula clara con zonas separadas, jerarquía tipográfica y márgenes generosos. Mantén títulos, líneas de tiempo, gráficos, etiquetas y cifras en áreas distintas; alinea los elementos y deja espacio suficiente para que no se solapen ni se recorten. Conserva nombres, fechas y cifras exactamente como se solicitaron, no inventes datos y prioriza legibilidad sobre decoración."
      : "Dirección visual: respeta la estética indicada y crea una composición intencional con un foco claro, equilibrio, espacio negativo y contraste legible. Evita texto accidental, elementos duplicados, solapamientos o recortes; incluye texto solo si se pidió. Respeta la orientación y resolución solicitadas.";
  return `${solicitud.prompt}\n\n${direccion}`;
}

function registro(valor: unknown): Record<string, any> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? valor as Record<string, any> : null;
}

async function respuestaJson(respuesta: Response): Promise<Record<string, any>> {
  if (!respuesta.ok) throw new Error(`google_http_${respuesta.status}`);
  const longitud = Number(respuesta.headers.get("content-length") ?? 0);
  if (longitud > 32 * 1024 * 1024) throw new Error("google_respuesta_grande");
  const texto = await respuesta.text();
  if (texto.length > 32 * 1024 * 1024) throw new Error("google_respuesta_grande");
  return JSON.parse(texto) as Record<string, any>;
}

function decodificarBase64(valor: unknown, maximo: number): Uint8Array {
  if (typeof valor !== "string" || !valor || valor.length > Math.ceil(maximo * 1.4) || !/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) {
    throw new Error("google_archivo_invalido");
  }
  const bytes = Buffer.from(valor, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximo) throw new Error("google_archivo_invalido");
  return new Uint8Array(bytes);
}

export async function generarImagen(
  solicitud: SolicitudMedio,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<{ contenido: Uint8Array; mime: string }> {
  if (solicitud.tipo !== "imagen") throw new Error("tipo_invalido");
  const respuesta = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: solicitud.modelo,
      input: promptVisual(solicitud),
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: solicitud.relacion,
        image_size: solicitud.resolucion,
      },
    }),
  });
  const json = await respuestaJson(respuesta);
  const salida = registro(json.output_image);
  const mime = salida?.mime_type === "image/jpeg" ? "image/jpeg" : salida?.mime_type === "image/webp" ? "image/webp" : "image/png";
  return { contenido: decodificarBase64(salida?.data, 20 * 1024 * 1024), mime };
}

function nombreOperacion(valor: unknown): string {
  if (typeof valor !== "string" || !/^[A-Za-z0-9._/-]{1,500}$/.test(valor) || !valor.includes("/")) {
    throw new Error("google_operacion_invalida");
  }
  return valor.split("/").map(encodeURIComponent).join("/");
}

export async function iniciarVideo(
  solicitud: SolicitudMedio,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (solicitud.tipo !== "video" || solicitud.duracionSegundos === null) throw new Error("tipo_invalido");
  const respuesta = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${solicitud.modelo}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      instances: [{ prompt: promptVisual(solicitud) }],
      parameters: {
        aspectRatio: solicitud.relacion,
        durationSeconds: String(solicitud.duracionSegundos),
        resolution: solicitud.resolucion,
        personGeneration: "allow_all",
        numberOfVideos: 1,
      },
    }),
  });
  const json = await respuestaJson(respuesta);
  if (typeof json.name !== "string") throw new Error("google_operacion_invalida");
  return nombreOperacion(json.name);
}

async function descargarVideo(uri: string, apiKey: string, fetcher: typeof fetch, maximo: number): Promise<Uint8Array> {
  let url = new URL(uri);
  let respuesta: Response | null = null;
  for (let salto = 0; salto <= 3; salto++) {
    if (url.protocol !== "https:" || !["generativelanguage.googleapis.com", "storage.googleapis.com"].includes(url.hostname)) {
      throw new Error("google_uri_invalida");
    }
    const headers: Record<string, string> = url.hostname === "generativelanguage.googleapis.com" ? { "x-goog-api-key": apiKey } : {};
    respuesta = await fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if (respuesta.status < 300 || respuesta.status >= 400) break;
    const destino = respuesta.headers.get("location");
    if (!destino || salto === 3) throw new Error("google_uri_invalida");
    url = new URL(destino, url);
  }
  if (!respuesta) throw new Error("google_uri_invalida");
  if (!respuesta.ok) throw new Error(`google_http_${respuesta.status}`);
  const longitud = Number(respuesta.headers.get("content-length") ?? 0);
  if (longitud > maximo || !respuesta.body) throw new Error("google_archivo_grande");
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await lector.cancel();
      throw new Error("google_archivo_grande");
    }
    partes.push(value);
  }
  const resultado = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) { resultado.set(parte, offset); offset += parte.byteLength; }
  return resultado;
}

export async function esperarVideo(
  operacion: string,
  apiKey: string,
  opciones: { fetcher?: typeof fetch; esperar?: (ms: number) => Promise<void>; maximo?: number; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const fetcher = opciones.fetcher ?? fetch;
  const esperar = opciones.esperar ?? ((ms) => Bun.sleep(ms));
  const hasta = Date.now() + (opciones.timeoutMs ?? 7 * 60_000);
  const operacionSegura = nombreOperacion(operacion);
  while (Date.now() < hasta) {
    const respuesta = await fetcher(`https://generativelanguage.googleapis.com/v1beta/${operacionSegura}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await respuestaJson(respuesta);
    if (json.done === true) {
      const error = registro(json.error);
      if (error) throw new Error(`google_http_${Number(error.code) || 500}`);
      const muestra = json.response?.generateVideoResponse?.generatedSamples?.[0];
      const uri = muestra?.video?.uri;
      if (typeof uri !== "string") throw new Error("google_sin_video");
      return descargarVideo(uri, apiKey, fetcher, opciones.maximo ?? 64 * 1024 * 1024);
    }
    await esperar(10_000);
  }
  throw new Error("google_tiempo_agotado");
}

export function errorSeguroDeMedio(err: unknown): string {
  const codigo = err instanceof Error ? err.message : "";
  if (codigo === "google_http_401" || codigo === "google_http_403") return "Google rechazó la API key o el acceso a este modelo. Revisa la clave de Google (Gemini) y que tenga habilitada la API de Gemini.";
  if (codigo === "google_http_429") return "Google alcanzó un límite de uso o facturación. Revisa el presupuesto y los límites de la API antes de volver a intentarlo.";
  if (codigo === "google_tiempo_agotado") return "Google no terminó el video a tiempo. El trabajo quedó detenido; revisa el uso de la API antes de solicitar otro para evitar una generación duplicada.";
  if (codigo === "google_archivo_grande") return "El archivo generado supera el límite de almacenamiento de Telo.";
  if (codigo === "google_archivo_invalido" || codigo === "google_sin_video" || codigo === "google_respuesta_grande") return "Google no devolvió un medio compatible para guardar en este chat.";
  const http = /^google_http_(\d{3})$/.exec(codigo)?.[1];
  if (http) return `Google rechazó la generación (HTTP ${http}). Revisa la configuración de la API o intenta más tarde.`;
  return "No se pudo completar la generación de medios. La respuesta de Google no se guardó; revisa el estado y el uso de la API antes de reintentar.";
}
