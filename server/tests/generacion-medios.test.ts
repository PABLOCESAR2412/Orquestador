import { describe, expect, test } from "bun:test";
import {
  detectarSolicitudMedio,
  errorSeguroDeMedio,
  esperarVideo,
  generarImagen,
  iniciarVideo,
  nombreDeMedio,
} from "../src/generacion-medios";

describe("detección de pedidos multimedia", () => {
  test("reconoce imagen y convierte tamaño, orientación y estilo en parámetros", () => {
    const solicitud = detectarSolicitudMedio("Hazme una imagen 4K vertical, estilo acuarela, de un zorro en un bosque")!;
    expect(solicitud).toMatchObject({
      tipo: "imagen",
      modelo: "gemini-nano-banana-2.1",
      resolucion: "4K",
      relacion: "9:16",
      costoEstimadoUsd: 0.113,
    });
    expect(solicitud.prompt).toContain("estilo acuarela");
  });

  test("elige video económico, duración y relación según la solicitud", () => {
    expect(detectarSolicitudMedio("Quiero un video vertical de 6 segundos de una ciudad futurista"))
      .toMatchObject({ tipo: "video", modelo: "veo-3.1-lite-generate-preview", resolucion: "720p", duracionSegundos: 6, relacion: "9:16", costoEstimadoUsd: 0.3 });
  });

  test("la resolución 4K elige Veo Fast y aplica los ocho segundos requeridos", () => {
    expect(detectarSolicitudMedio("Crea un video 4K horizontal de 4 segundos"))
      .toMatchObject({ modelo: "veo-3.1-fast-generate-preview", resolucion: "4k", duracionSegundos: 8, costoEstimadoUsd: 2.4 });
  });

  test("no interpreta preguntas sobre cómo generar como una orden", () => {
    expect(detectarSolicitudMedio("¿Cómo generar un video con Gemini?" )).toBeNull();
    expect(detectarSolicitudMedio("Explícame qué modelos generan imágenes" )).toBeNull();
    expect(detectarSolicitudMedio("Quiero analizar esta imagen" )).toBeNull();
    expect(detectarSolicitudMedio("Haz un análisis de la imagen que te mandé" )).toBeNull();
    expect(detectarSolicitudMedio("Quiero que me hagas un video vertical" )?.tipo).toBe("video");
  });
});

describe("Google API multimedia", () => {
  test("solicita JPEG y conserva el MIME real del resultado", async () => {
    const solicitud = detectarSolicitudMedio("Haz una imagen 2K 16:9")!;
    let payload: Record<string, unknown> | null = null;
    const keys: string[] = [];
    const fetcher = (async (_input: string | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      keys.push(new Headers(init?.headers).get("x-goog-api-key") ?? "");
      return new Response(JSON.stringify({ output_image: { data: Buffer.from("jpeg-data").toString("base64"), mime_type: "image/jpeg" } }), { status: 200 });
    }) as typeof fetch;
    const salida = await generarImagen(solicitud, "test-api-key", fetcher);
    expect(keys[0]).toBe("test-api-key");
    expect(payload).toMatchObject({
      model: "gemini-nano-banana-2.1",
      response_format: { type: "image", mime_type: "image/jpeg", image_size: "2K", aspect_ratio: "16:9" },
    });
    expect(new TextDecoder().decode(salida.contenido)).toBe("jpeg-data");
    expect(salida.mime).toBe("image/jpeg");
    expect(nombreDeMedio("Haz una imagen 2K", "imagen", salida.mime)).toBe("Haz una imagen 2K.jpg");
    expect(nombreDeMedio("Haz una imagen 2K", "imagen")).toBe("Haz una imagen 2K.jpg");
  });

  test("explica el motivo HTTP 400 de Google y redacta cualquier clave que repita", async () => {
    const solicitud = detectarSolicitudMedio("Genera una imagen 1:1")!;
    const clave = "AIzaSyA123456789012345678901234567890123";
    const fetcher = (async (_input: string | URL, _init?: RequestInit) => Response.json({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: `Invalid image_size. ${clave}`,
      },
    }, { status: 400 })) as unknown as typeof fetch;

    try {
      await generarImagen(solicitud, clave, fetcher);
      throw new Error("Google debía rechazar los parámetros de la solicitud");
    } catch (err) {
      const visible = errorSeguroDeMedio(err);
      expect(visible).toContain("HTTP 400");
      expect(visible).toContain("INVALID_ARGUMENT");
      expect(visible).toContain("Invalid image_size");
      expect(visible).not.toContain(clave);
    }
  });

  test("añade una composición legible sin alterar los datos pedidos para una infografía", async () => {
    const solicitud = detectarSolicitudMedio("Crea una infografía con cronología 1939-1945 y 70-85 millones de víctimas")!;
    let promptEnviado = "";
    const fetcher = (async (_input: string | URL, init?: RequestInit) => {
      promptEnviado = JSON.parse(String(init?.body)).input;
      return new Response(JSON.stringify({ output_image: { data: Buffer.from("png-data").toString("base64"), mime_type: "image/png" } }), { status: 200 });
    }) as typeof fetch;
    await generarImagen(solicitud, "test-api-key", fetcher);
    expect(promptEnviado).toContain("cronología 1939-1945 y 70-85 millones de víctimas");
    expect(promptEnviado).toContain("no agregues datos, textos ni leyendas");
    expect(promptEnviado).toContain("no comprimas, encimes ni recortes el texto");
    expect(promptEnviado).toContain("sin deformar letras ni datos");
  });

  test("inicia video con opciones soportadas y guarda su operación", async () => {
    const solicitud = detectarSolicitudMedio("Hazme un video vertical de 8 segundos")!;
    let payload: Record<string, any> | null = null;
    const fetcher = (async (_input: string | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ name: "models/veo-3.1-lite-generate-preview/operations/op-123" }), { status: 200 });
    }) as typeof fetch;
    const operacion = await iniciarVideo(solicitud, "test-api-key", fetcher);
    expect(operacion).toBe("models/veo-3.1-lite-generate-preview/operations/op-123");
    expect(payload).toMatchObject({
      parameters: { aspectRatio: "9:16", durationSeconds: "8", resolution: "720p", numberOfVideos: 1 },
    });
  });

  test("espera la operación y descarga solo desde hosts permitidos", async () => {
    let llamados = 0;
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      llamados++;
      if (String(input).includes("operations/op-123")) {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-api-key");
        return new Response(JSON.stringify(llamados === 1
          ? { done: false }
          : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/x:download?alt=media" } }] } } }), { status: 200 });
      }
      if (String(input).includes("generativelanguage.googleapis.com")) {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-api-key");
        return new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/temporary/x.mp4" } });
      }
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
      return new Response(new Uint8Array([0, 1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const resultado = await esperarVideo("models/veo-lite/operations/op-123", "test-api-key", { fetcher, esperar: async () => {}, timeoutMs: 1000 });
    expect([...resultado]).toEqual([0, 1, 2, 3]);
    expect(llamados).toBe(4);
  });

  test("traduce errores del proveedor sin revelar su cuerpo", () => {
    expect(errorSeguroDeMedio(new Error("google_http_403"))).toContain("Google rechazó la API key");
    expect(errorSeguroDeMedio(new Error("google_http_429"))).toContain("límite de uso");
  });
});
