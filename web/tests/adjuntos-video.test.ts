import { describe, expect, test } from "bun:test";
import { leerArchivo } from "../src/lib/adjuntos";

describe("adjuntos de video", () => {
  test("acepta MP4 y WebM para preparar la hoja visual del mensaje", async () => {
    const mp4 = await leerArchivo(new File([Uint8Array.of(1)], "clip.mp4", { type: "video/mp4" }));
    const mp4SinMime = await leerArchivo(new File([Uint8Array.of(1)], "clip-sin-mime.mp4", { type: "application/octet-stream" }));
    const webm = await leerArchivo(new File([Uint8Array.of(1)], "clip.webm", { type: "video/webm" }));

    expect(mp4).toMatchObject({ tipo: "video", nombre: "clip.mp4", tamano: 1 });
    expect(mp4SinMime).toMatchObject({ tipo: "video", nombre: "clip-sin-mime.mp4", tamano: 1 });
    expect(webm).toMatchObject({ tipo: "video", nombre: "clip.webm", tamano: 1 });
  });

  test("rechaza formatos de video que no puede decodificar el compositor", async () => {
    const resultado = await leerArchivo(new File([Uint8Array.of(1)], "clip.avi", { type: "video/x-msvideo" }));

    expect(resultado).toMatchObject({ tipo: "solo_vista", motivo: "Solo se admiten videos MP4 o WebM." });
  });
});
