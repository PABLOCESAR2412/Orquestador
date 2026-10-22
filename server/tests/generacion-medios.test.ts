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
      .toMatchObject({ tipo: "video", modelo: "gemini-omni-1.1-flash", resolucion: "720p", duracionSegundos: 6, relacion: "9:16", costoEstimadoUsd: 0.6 });
  });

  test("Omni mantiene la duración pedida también en resolución 4K", () => {
    expect(detectarSolicitudMedio("Crea un video 4K horizontal de 4 segundos"))
      .toMatchObject({ modelo: "gemini-omni-1.1-flash", resolucion: "4k", duracionSegundos: 4, costoEstimadoUsd: 0.4 });
  });

  test("acepta el intervalo de duración de Gemini Omni y usa cuatro segundos por defecto", () => {
    expect(detectarSolicitudMedio("Crea un video de 3 segundos")?.duracionSegundos).toBe(3);
    expect(detectarSolicitudMedio("Crea un video de 10 segundos")?.duracionSegundos).toBe(10);
    expect(detectarSolicitudMedio("Crea un video")?.duracionSegundos).toBe(4);
  });

  test("envía videos con voz al generador que devuelve el MP4 con audio", () => {
    expect(detectarSolicitudMedio("Haz un video de 8 segundos con narración en español"))
      .toMatchObject({ tipo: "video", modelo: "gemini-omni-1.1-flash", duracionSegundos: 8 });
    expect(detectarSolicitudMedio("Genera un video con voz en off y subtítulos")?.tipo).toBe("video");
    expect(detectarSolicitudMedio("Crea un video con voz de fondo")?.tipo).toBe("video");
    expect(detectarSolicitudMedio("Haz un video y ponle una voz cálida")?.tipo).toBe("video");
    expect(detectarSolicitudMedio("Haz un video sin voz ni narración")?.tipo).toBe("video");
    expect(detectarSolicitudMedio("Haz un video vertical de 8 segundos con música épica")?.tipo).toBe("video");
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

  test("crea video con Gemini Omni y conserva la URI segura para continuar", async () => {
    const solicitud = detectarSolicitudMedio("Hazme un video vertical de 8 segundos")!;
    let payload: Record<string, any> | null = null;
    const fetcher = (async (_input: string | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({
        id: "v1_123",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/file-123:download?alt=media" }] }],
      });
    }) as typeof fetch;
    const inicio = await iniciarVideo(solicitud, "test-api-key", fetcher);
    expect(inicio.tipo).toBe("operacion");
    expect(inicio.tipo === "operacion" && inicio.valor).toContain("telo-video-v2:");
    expect(payload).toMatchObject({
      model: "gemini-omni-1.1-flash",
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p", delivery: "uri" },
    });
  });

  test("pide narración hablada en el idioma solicitado y no agrega voz si no se pidió", async () => {
    const narrado = detectarSolicitudMedio("Haz un video de 6 segundos con voz en off en español")!;
    let promptEnviado = "";
    const fetcher = (async (_input: string | URL, init?: RequestInit) => {
      promptEnviado = JSON.parse(String(init?.body)).input;
      return Response.json({ id: "v1_123", status: "completed", output_video: { data: Buffer.from([1, 2]).toString("base64") } });
    }) as typeof fetch;
    const salida = await iniciarVideo(narrado, "test-api-key", fetcher);
    expect(salida.tipo).toBe("contenido");
    expect(promptEnviado).toContain("integra una narración hablada y claramente audible en el mismo MP4");
    expect(promptEnviado).toContain("si no se indica, español neutro");

    const silencioso = detectarSolicitudMedio("Haz un video de 6 segundos sin voz")!;
    await iniciarVideo(silencioso, "test-api-key", fetcher);
    expect(promptEnviado).not.toContain("Audio solicitado:");
    expect(promptEnviado).toContain("no agregues voz, diálogo ni narración");
  });

  test("espera que el archivo Google quede activo y descarga solo desde hosts permitidos", async () => {
    let llamados = 0;
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      llamados++;
      if (String(input).includes("/files/file-123") && !String(input).includes(":download")) {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-api-key");
        return Response.json({ state: llamados === 1 ? "PROCESSING" : "ACTIVE" });
      }
      if (String(input).includes("generativelanguage.googleapis.com")) {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-api-key");
        return new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/temporary/x.mp4" } });
      }
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
      return new Response(new Uint8Array([0, 1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const operacion = `telo-video-v2:${JSON.stringify({ tipo: "archivo", uri: "https://generativelanguage.googleapis.com/v1beta/files/file-123:download?alt=media" })}`;
    const resultado = await esperarVideo(operacion, "test-api-key", { fetcher, esperar: async () => {}, timeoutMs: 1000 });
    expect([...resultado]).toEqual([0, 1, 2, 3]);
    expect(llamados).toBe(4);
  });

  test("continúa una interacción pendiente y acepta el MP4 inline de tamaño limitado", async () => {
    let llamados = 0;
    const fetcher = (async (input: string | URL) => {
      llamados++;
      expect(String(input)).toContain("/interactions/v1_123");
      return Response.json(llamados === 1
        ? { id: "v1_123", status: "in_progress" }
        : { id: "v1_123", status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from([1, 2, 3]).toString("base64") }] }] });
    }) as typeof fetch;
    const operacion = `telo-video-v2:${JSON.stringify({ tipo: "interaccion", id: "v1_123" })}`;
    const resultado = await esperarVideo(operacion, "test-api-key", { fetcher, esperar: async () => {}, timeoutMs: 1000 });
    expect([...resultado]).toEqual([1, 2, 3]);
    expect(llamados).toBe(2);
  });

  test("reanuda operaciones Veo antiguas que ya estaban guardadas", async () => {
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("/operations/op-123")) {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-api-key");
        return Response.json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/file-123:download?alt=media" } }] } } });
      }
      if (String(input).includes("generativelanguage.googleapis.com")) {
        return new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/temporary/x.mp4" } });
      }
      return new Response(new Uint8Array([7, 8]), { status: 200 });
    }) as typeof fetch;
    const resultado = await esperarVideo("models/veo-lite/operations/op-123", "test-api-key", { fetcher, esperar: async () => {}, timeoutMs: 1000 });
    expect([...resultado]).toEqual([7, 8]);
  });

  test("traduce errores del proveedor sin revelar su cuerpo", () => {
    expect(errorSeguroDeMedio(new Error("google_http_403"))).toContain("Google rechazó la API key");
    expect(errorSeguroDeMedio(new Error("google_http_429"))).toContain("límite de uso");
  });
});
