import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { leerVideo, leerRecursoHtml } from "../src/archivos-proyecto";

const raiz = mkdtempSync(join(tmpdir(), "telo-descriptor-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

// Windows impide renombrar directorios con descriptores abiertos; el ataque es POSIX.
test.skipIf(process.platform === "win32")("el stream conserva el archivo verificado aunque se sustituya la ruta", async () => {
  const carpeta = join(raiz, "original");
  mkdirSync(carpeta);
  const original = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom-original")]);
  writeFileSync(join(carpeta, "video.mp4"), original);
  const archivo = leerVideo(raiz, ["original", "video.mp4"]);
  renameSync(carpeta, join(raiz, "movido"));
  mkdirSync(carpeta);
  writeFileSync(join(carpeta, "video.mp4"), "contenido diferente");
  const servido = Buffer.from(await new Response(archivo.stream()).arrayBuffer());
  expect(servido).toEqual(original);
  expect(() => archivo.stream()).toThrow("cerrado");
});

test("rango inclusive, cierre explícito y cancelación liberan el recurso", async () => {
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom-rango")]);
  writeFileSync(join(raiz, "rango.mp4"), bytes);
  const rango = leerVideo(raiz, ["rango.mp4"]);
  expect(Buffer.from(await new Response(rango.stream(4, 7)).arrayBuffer()).toString()).toBe("ftyp");
  const meta = leerVideo(raiz, ["rango.mp4"]);
  meta.cerrar(); meta.cerrar();
  expect(() => meta.stream()).toThrow("cerrado");
  const cancelado = leerVideo(raiz, ["rango.mp4"]);
  await cancelado.stream().cancel();
  expect(() => cancelado.stream()).toThrow("cerrado");
});

test("los recursos HTML solo admiten extensiones estáticas autorizadas", async () => {
  writeFileSync(join(raiz, "estilos.css"), "body{color:red}");
  const css = leerRecursoHtml(raiz, ["estilos.css"]);
  expect(css.mime).toBe("text/css; charset=utf-8");
  expect(await new Response(css.stream()).text()).toBe("body{color:red}");
  for (const nombre of [".env", "fuente.ts", "datos.txt", "pagina.html"]) {
    writeFileSync(join(raiz, nombre), "contenido");
    expect(() => leerRecursoHtml(raiz, [nombre])).toThrow("formato_recurso_invalido");
  }
});
