import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// El módulo de trabajo abre la base al cargarse: se usa una carpeta temporal antes de importarlo.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "telo-sensibles-"));
const { esSensible } = await import("../src/workspace");

test("«secret» o «secrets» como palabra del nombre marca el archivo como sensible", () => {
  for (const ruta of ["config/client_secret.json", "secrets.yaml", "app/secret.txt", "deploy/my-secrets.env"]) {
    expect(esSensible(ruta)).toBe(true);
  }
});

test("un nombre que solo contiene «secret» dentro de otra palabra no bloquea el commit", () => {
  for (const ruta of ["server/src/secretos.ts", "web/src/components/proyecto-secretos.tsx", "server/tests/secretos.test.ts"]) {
    expect(esSensible(ruta)).toBe(false);
  }
});

test("los archivos de claves, .env y credenciales siguen siendo sensibles", () => {
  for (const ruta of [".env", "api/.env.production", "keys/server.pem", "id_rsa", "credentials.json"]) {
    expect(esSensible(ruta)).toBe(true);
  }
});
