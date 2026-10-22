import { redactar } from "./redaccion";

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
const MODELO_VIDEO = "gemini-omni-1.1-flash";
const VIDEO_OPERACION_PREFIJO = "telo-video-v2:";
const RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"] as const;
const ACCION_EXPLICITA = /^(?:(?:hola[, ]+)?(?:por favor[, ]+)?)?(?:me gustar[ií]a que me hagas|quisiera que me hagas|me puedes hacer|puedes hacerme|puedes crear(?:me)?|podr[ií]as crear(?:me)?|quiero que (?:me )?(?:generes?|hagas?|crees?|produzcas|dibujes|ilustres)|necesito que (?:me )?(?:generes?|hagas?|crees?|produzcas|dibujes|ilustres)|quiero (?:una?\s+(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip|animaci[oó]n|pel[ií]cula|logotipo|logo|p[oó]ster|infograf[ií]a)|generar\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip)|hacer\s+(?:un\s+)?(?:video|v[ií]deo|clip))|necesito (?:una?\s+(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip|animaci[oó]n|pel[ií]cula|logotipo|logo|p[oó]ster|infograf[ií]a)|generar\s+(?:una?\s+)?(?:imagen|foto|ilustraci[oó]n|video|v[ií]deo|clip)|hacer\s+(?:un\s+)?(?:video|v[ií]deo|clip))|hazme|haz|genera(?:me)?|gen[eé]rame|crear|crea(?:me)?|dibuja|ilustra|produce|make|generate|create)\b/i;
const PIDE_VOZ_EN_VIDEO = /\b(?:voz|narraci[oó]n|narrador(?:a)?|locuci[oó]n|voice[\s-]?over|doblaje|narrad[oa]|narrar|hablado|di[aá]logo|conversaci[oó]n)\b/i;
const NIEGA_VOZ_EN_VIDEO = /\b(?:sin|no\s+(?:(?:me|le)\s+)?(?:pongas?|incluyas?|a[nñ]adas?|uses?)|evita|quita|elimina|nada\s+de)\s+(?:(?:ninguna?|la|una)\s+)?(?:voz|narraci[oó]n|narrador(?:a)?|locuci[oó]n|voice[\s-]?over|doblaje|sonido\s+hablado|di[aá]logo|conversaci[oó]n)\b/i;

function solicitaNarracion(prompt: string): boolean {
  return PIDE_VOZ_EN_VIDEO.test(prompt) && !NIEGA_VOZ_EN_VIDEO.test(prompt);
}

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
  const solicitada = Number(/\b(10|[3-9])\s*(?:s|seg(?:undos?)?)\b/i.exec(prompt)?.[1] ?? 4);
  const resolucion: ResolucionVideo = /\b4\s*k\b/i.test(prompt) ? "4k" : /\b1080\s*p\b/i.test(prompt) ? "1080p" : "720p";
  const duracionSegundos = solicitada;
  // Precio oficial de referencia para 720p: ~US$0.10/s. 1080p y 4K se entregan reescalados.
  const costoEstimadoUsd = Number((0.1 * duracionSegundos).toFixed(3));
  return { tipo, prompt, modelo: MODELO_VIDEO, resolucion, relacion, duracionSegundos, costoEstimadoUsd };
}

export function nombreDeMedio(prompt: string, tipo: TipoMedio, mimeImagen = "image/jpeg"): string {
  const base = prompt
    .replace(/^\/(?:imagen|video|v[ií]deo)\s*/i, "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  const extension = tipo === "video" ? "mp4" : mimeImagen === "image/png" ? "png" : mimeImagen === "image/webp" ? "webp" : "jpg";
  return `${base || (tipo === "imagen" ? "imagen-generada" : "video-generado")}.${extension}`;
}

function promptVisual(solicitud: SolicitudMedio): string {
  const direccion = solicitud.tipo === "video"
    ? "Dirección visual: conserva la continuidad del sujeto, la escena y el estilo durante todo el clip; usa movimiento de cámara deliberado y evita parpadeos, deformaciones o cambios de identidad. Respeta la duración, orientación y estilo solicitados."
    : /infograf[ií]a|l[ií]nea del tiempo|cronolog[ií]a|gr[aá]fico|diagrama|mapa mental|estad[ií]stica/i.test(solicitud.prompt)
      ? "Dirección visual para infografía: antes de dibujar, distribuye el contenido en una retícula editorial con márgenes amplios, jerarquía tipográfica sencilla y zonas claramente separadas. Conserva exactamente la ortografía, nombres, fechas, etiquetas y cifras solicitados; no agregues datos, textos ni leyendas. Deja espacio real entre título, subtítulo, rótulos, gráficos y tarjetas. Si hay muchos elementos, usa filas o columnas adicionales y cambia la composición; no comprimas, encimes ni recortes el texto para que quepa. Mantén valores, escalas y etiquetas coherentes. Prioriza tipografía plana, grande y de alto contraste frente a adornos; si se pide 3D, limita la profundidad al fondo y a los elementos decorativos, sin deformar letras ni datos."
      : "Dirección visual: respeta la estética indicada y crea una composición intencional con un foco claro, equilibrio, espacio negativo y contraste legible. Evita texto accidental, elementos duplicados, solapamientos o recortes; incluye texto solo si se pidió. Respeta la orientación y resolución solicitadas.";
  const audio = solicitud.tipo !== "video"
    ? ""
    : solicitaNarracion(solicitud.prompt)
      ? "Audio solicitado: integra una narración hablada y claramente audible en el mismo MP4. Usa el idioma solicitado; si no se indica, español neutro. Mantén una dicción natural y sincronizada con las escenas, sin inventar hechos ni reemplazar la voz por texto en pantalla. Añade música solo si se pidió y mantenla por debajo de la voz."
      : "Audio: no agregues voz, diálogo ni narración; conserva únicamente la música y los sonidos que se pidieron.";
  return `${solicitud.prompt}\n\n${direccion}${audio ? `\n${audio}` : ""}`;
}

function registro(valor: unknown): Record<string, any> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? valor as Record<string, any> : null;
}

async function respuestaJson(respuesta: Response): Promise<Record<string, any>> {
  if (!respuesta.ok) {
    const longitudError = Number(respuesta.headers.get("content-length") ?? 0);
    let codigoProveedor = "";
    let mensajeProveedor = "";
    // Google suele incluir en el cuerpo el motivo exacto de los HTTP 400. Guardamos solo
    // status y mensaje, nunca el cuerpo entero, para distinguir parámetros inválidos de
    // modelos o permisos no disponibles sin exponer datos de la petición.
    if (!longitudError || longitudError <= 8192) {
      const cuerpo = await respuesta.text().catch(() => "");
      try {
        const error = registro(JSON.parse(cuerpo).error);
        if (typeof error?.status === "string") codigoProveedor = error.status.slice(0, 64);
        if (typeof error?.message === "string") mensajeProveedor = redactar(error.message).replace(/[\r\n\t]+/g, " ").slice(0, 400);
      } catch {
        // Una respuesta no JSON conserva el código HTTP, que basta para el mensaje genérico.
      }
    }
    throw new Error(`google_http_${respuesta.status}${codigoProveedor ? `|${codigoProveedor}` : ""}${mensajeProveedor ? `|${mensajeProveedor}` : ""}`);
  }
  // Un MP4 de hasta 64 MiB codificado como base64 necesita aproximadamente 86 MiB de JSON.
  const maximoJson = 92 * 1024 * 1024;
  const longitud = Number(respuesta.headers.get("content-length") ?? 0);
  if (longitud > maximoJson) throw new Error("google_respuesta_grande");
  const texto = await respuesta.text();
  if (texto.length > maximoJson) throw new Error("google_respuesta_grande");
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
        mime_type: "image/jpeg",
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
): Promise<{ tipo: "operacion"; valor: string } | { tipo: "contenido"; contenido: Uint8Array }> {
  if (solicitud.tipo !== "video" || solicitud.duracionSegundos === null) throw new Error("tipo_invalido");
  const respuesta = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15 * 60_000),
    body: JSON.stringify({
      model: MODELO_VIDEO,
      input: `${promptVisual(solicitud)}\nDuración objetivo: ${solicitud.duracionSegundos} segundos.`,
      response_format: {
        type: "video",
        aspect_ratio: solicitud.relacion,
        resolution: solicitud.resolucion,
        delivery: "uri",
      },
    }),
  });
  const json = await respuestaJson(respuesta);
  const resultado = registro(json.interaction) ?? json;
  if (resultado.status === "failed" || registro(resultado.error)) throw new Error("google_video_fallo");
  const salida = salidaVideo(resultado);
  if (salida?.uri) return { tipo: "operacion", valor: serializarVideoOperacion({ tipo: "archivo", uri: salida.uri }) };
  if (salida?.data) return { tipo: "contenido", contenido: decodificarBase64(salida.data, 64 * 1024 * 1024) };
  if (typeof resultado.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(resultado.id) && resultado.status !== "completed") {
    return { tipo: "operacion", valor: serializarVideoOperacion({ tipo: "interaccion", id: resultado.id }) };
  }
  throw new Error("google_sin_video");
}

type OperacionVideo = { tipo: "archivo"; uri: string } | { tipo: "interaccion"; id: string };

function serializarVideoOperacion(operacion: OperacionVideo): string {
  return `${VIDEO_OPERACION_PREFIJO}${JSON.stringify(operacion)}`;
}

function operacionVideo(valor: string): OperacionVideo | null {
  if (!valor.startsWith(VIDEO_OPERACION_PREFIJO)) return null;
  try {
    const json = JSON.parse(valor.slice(VIDEO_OPERACION_PREFIJO.length));
    if (json?.tipo === "archivo" && typeof json.uri === "string") return { tipo: "archivo", uri: json.uri };
    if (json?.tipo === "interaccion" && typeof json.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(json.id)) {
      return { tipo: "interaccion", id: json.id };
    }
  } catch {}
  throw new Error("google_operacion_invalida");
}

function salidaVideo(json: Record<string, any>): { uri?: string; data?: string } | null {
  const directa = registro(json.output_video);
  if (typeof directa?.uri === "string" || typeof directa?.data === "string") {
    return { uri: directa.uri, data: directa.data };
  }
  if (!Array.isArray(json.steps)) return null;
  for (const paso of json.steps) {
    if (paso?.type !== "model_output" || !Array.isArray(paso.content)) continue;
    for (const contenido of paso.content) {
      if (contenido?.type !== "video" || (contenido.mime_type && contenido.mime_type !== "video/mp4")) continue;
      if (typeof contenido.uri === "string" || typeof contenido.data === "string") {
        return { uri: contenido.uri, data: contenido.data };
      }
    }
  }
  return null;
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
  const hasta = Date.now() + (opciones.timeoutMs ?? 30 * 60_000);
  const actual = operacionVideo(operacion);
  const maximo = opciones.maximo ?? 64 * 1024 * 1024;
  if (actual?.tipo === "archivo") return esperarArchivoVideo(actual.uri, apiKey, fetcher, esperar, hasta, maximo);
  if (actual?.tipo === "interaccion") return esperarInteraccionVideo(actual.id, apiKey, fetcher, esperar, hasta, maximo);
  // Compatibilidad con tareas iniciadas por Telo antes de migrar desde la API de Veo.
  return esperarOperacionVeo(operacion, apiKey, fetcher, esperar, hasta, maximo);
}

function idArchivoGoogle(uri: string): string {
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error("google_uri_invalida"); }
  const coincide = /^\/v1beta\/files\/([A-Za-z0-9_-]+):download$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com" || !coincide) throw new Error("google_uri_invalida");
  return coincide[1]!;
}

async function esperarArchivoVideo(
  uri: string,
  apiKey: string,
  fetcher: typeof fetch,
  esperar: (ms: number) => Promise<void>,
  hasta: number,
  maximo: number,
): Promise<Uint8Array> {
  const id = idArchivoGoogle(uri);
  while (Date.now() < hasta) {
    const respuesta = await fetcher(`https://generativelanguage.googleapis.com/v1beta/files/${encodeURIComponent(id)}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await respuestaJson(respuesta);
    const estado = typeof json.state === "string" ? json.state : json.state?.name;
    if (estado === "ACTIVE") return descargarVideo(uri, apiKey, fetcher, maximo);
    if (estado === "FAILED") throw new Error("google_video_fallo");
    await esperar(5_000);
  }
  throw new Error("google_tiempo_agotado");
}

async function esperarInteraccionVideo(
  id: string,
  apiKey: string,
  fetcher: typeof fetch,
  esperar: (ms: number) => Promise<void>,
  hasta: number,
  maximo: number,
): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("google_operacion_invalida");
  while (Date.now() < hasta) {
    const respuesta = await fetcher(`https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(id)}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await respuestaJson(respuesta);
    const resultado = registro(json.interaction) ?? json;
    if (resultado.status === "failed" || registro(resultado.error)) throw new Error("google_video_fallo");
    if (resultado.status === "completed") {
      const salida = salidaVideo(resultado);
      if (salida?.uri) return esperarArchivoVideo(salida.uri, apiKey, fetcher, esperar, hasta, maximo);
      if (salida?.data) return decodificarBase64(salida.data, maximo);
      throw new Error("google_sin_video");
    }
    await esperar(10_000);
  }
  throw new Error("google_tiempo_agotado");
}

async function esperarOperacionVeo(
  operacion: string,
  apiKey: string,
  fetcher: typeof fetch,
  esperar: (ms: number) => Promise<void>,
  hasta: number,
  maximo: number,
): Promise<Uint8Array> {
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
      return descargarVideo(uri, apiKey, fetcher, maximo);
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
  const http = /^google_http_(\d{3})(?:\|([^|]{1,64}))?(?:\|(.{1,400}))?$/.exec(codigo);
  if (http) {
    const [, estado, estadoProveedor, mensajeProveedor] = http;
    const detalle = mensajeProveedor ? ` Detalle de Google: ${mensajeProveedor}.` : "";
    if (estado === "400" && /model.*(?:not found|not available|not supported)|(?:not found|not available|not supported).*model/i.test(mensajeProveedor ?? "")) {
      return `Google no permite usar el modelo de imagen configurado (HTTP 400).${detalle} Revisa que la API key tenga acceso al modelo Nano Banana 2.1.`;
    }
    if (estado === "400" && /api.?key|credential|authentication/i.test(`${estadoProveedor} ${mensajeProveedor}`)) {
      return `Google rechazó la credencial de la API (HTTP 400).${detalle} Revisa la clave de Gemini en Ajustes.`;
    }
    return `Google rechazó la generación (HTTP ${estado}${estadoProveedor ? ` · ${estadoProveedor}` : ""}).${detalle} Revisa los parámetros y el acceso a la API de Gemini.`;
  }
  return "No se pudo completar la generación de medios. La respuesta de Google no se guardó; revisa el estado y el uso de la API antes de reintentar.";
}
