import { expect, test } from "bun:test";
import { archivosConSecretos, archivosConSecretosEnBlobs } from "../src/redaccion";

test("un token de ejemplo no oculta otra credencial en la misma línea", () => {
  const falso = "ghp_" + "ficticio".repeat(4);
  const otro = "ghp_" + "79QZ26VBD48RMS38KWP9N6XCA";
  expect(archivosConSecretos(`diff --git a/a.txt b/a.txt\n+${falso} ${otro}`, [])).toEqual(["a.txt"]);
});

test("un NUL dentro del blob no falsifica la etiqueta ni oculta su primera línea", () => {
  const valor = "valor-ficticio-conocido-987654";
  expect(archivosConSecretosEnBlobs([
    { ruta: ".opencode-data.bin", contenido: `\0etiqueta-falsa\0${valor}\n` },
  ], [valor])).toEqual([".opencode-data.bin"]);
});
