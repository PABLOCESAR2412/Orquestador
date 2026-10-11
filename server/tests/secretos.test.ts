import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Base temporal: nunca se toca server/data. Se fija antes de importar los módulos con base.
// Una raíz por ejecución, compartida por todos los archivos: config y base se cargan una vez por
// proceso. La primera prueba limpia los restos de la ejecución anterior.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { cifrar, descifrar, nombreSecretoValido, secretosDisponibles, guardarSecreto, entornoDeProyecto, valorSecreto } =
  await import("../src/secretos");
const { secretosRoute } = await import("../src/routes/secretos");
const { db } = await import("../src/db");

const CLAVE_VALIDA = randomBytes(32).toString("base64");
const CLAVE_ORIGINAL = process.env.TELO_CLAVE_CIFRADO;

afterEach(() => {
  if (CLAVE_ORIGINAL === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = CLAVE_ORIGINAL;
});

// Inserta un proyecto directamente en la base (el módulo de secretos no necesita su carpeta).
function proyectoDePrueba(id: string): string {
  db.query("INSERT OR IGNORE INTO projects (id, name, repo_path) VALUES (?, ?, ?)").run(
    id,
    id,
    join(RAIZ_PRUEBAS, "proyectos", id),
  );
  return id;
}

describe("cifrado AES-256-GCM", () => {
  const clave = randomBytes(32);
  const aad = "proyecto-1|API_KEY";

  test("ida y vuelta", () => {
    const cifrado = cifrar(clave, "sk-valor-de-prueba", aad);
    expect(descifrar(clave, cifrado, aad)).toBe("sk-valor-de-prueba");
  });

  test("el mismo valor cifra distinto cada vez (IV aleatorio)", () => {
    const a = cifrar(clave, "igual", aad);
    const b = cifrar(clave, "igual", aad);
    expect(a.iv).not.toBe(b.iv);
    expect(a.value_enc).not.toBe(b.value_enc);
  });

  test("un texto cifrado alterado no descifra", () => {
    const cifrado = cifrar(clave, "valor", aad);
    const bytes = Buffer.from(cifrado.value_enc, "base64");
    bytes[0] ^= 0xff;
    expect(() => descifrar(clave, { ...cifrado, value_enc: bytes.toString("base64") }, aad)).toThrow();
  });

  test("una etiqueta alterada no descifra", () => {
    const cifrado = cifrar(clave, "valor", aad);
    const etiqueta = Buffer.from(cifrado.tag, "base64");
    etiqueta[0] ^= 0x01;
    expect(() => descifrar(clave, { ...cifrado, tag: etiqueta.toString("base64") }, aad)).toThrow();
  });

  test("un AAD distinto (otro proyecto o nombre) no descifra", () => {
    const cifrado = cifrar(clave, "valor", aad);
    expect(() => descifrar(clave, cifrado, "proyecto-2|API_KEY")).toThrow();
    expect(() => descifrar(clave, cifrado, "proyecto-1|OTRO_NOMBRE")).toThrow();
  });

  test("otra clave no descifra", () => {
    const cifrado = cifrar(clave, "valor", aad);
    expect(() => descifrar(randomBytes(32), cifrado, aad)).toThrow();
  });
});

describe("clave del servidor", () => {
  test("sin clave, o con una que no mide 32 bytes, los secretos no están disponibles", () => {
    delete process.env.TELO_CLAVE_CIFRADO;
    expect(secretosDisponibles()).toBe(false);
    process.env.TELO_CLAVE_CIFRADO = "c2hvcnQ=";
    expect(secretosDisponibles()).toBe(false);
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    expect(secretosDisponibles()).toBe(true);
  });
});

describe("nombres de secreto", () => {
  test("acepta nombres en mayúsculas sin prefijos prohibidos", () => {
    for (const bueno of ["API_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "_PRIVADO", "AB"]) {
      expect(nombreSecretoValido(bueno)).toBe(true);
    }
  });

  test("rechaza formato inválido, TELO_ y la denylist de prefijos", () => {
    const malos = [
      "A",
      "minuscula",
      "1ABC",
      "CON-GUION",
      "X".repeat(65),
      "TELO_ALGO",
      "PATH",
      "PATHX",
      "HOME",
      "HOMEBREW_TOKEN",
      "LD_PRELOAD",
      "DYLD_X",
      "GIT_SSH_COMMAND",
      "BASH_ENV",
      "NODE_OPTIONS",
      "PYTHONPATH",
      "IFS",
    ];
    for (const malo of malos) expect(nombreSecretoValido(malo)).toBe(false);
  });
});

describe("secretos por proyecto", () => {
  const rutas = secretosRoute;
  const pid = proyectoDePrueba("proyecto-secretos");
  const base = `/projects/${pid}/secretos`;

  const put = (nombre: string, cuerpo: unknown) =>
    rutas.request(`${base}/${nombre}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });

  test("sin clave, la escritura da 503 y la lista dice que no está disponible", async () => {
    delete process.env.TELO_CLAVE_CIFRADO;
    const res = await put("API_KEY", { valor: "valor-secreto" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "secretos_no_configurados" });

    const lista = await rutas.request(base);
    expect((await lista.json() as { disponible: boolean }).disponible).toBe(false);
  });

  test("con clave: guarda, lista sin valores y entrega el valor solo al entorno", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;

    const res = await put("API_KEY", { valor: "valor-secreto-123" });
    expect(res.status).toBe(200);
    const escrito = await res.text();
    expect(escrito).not.toContain("valor-secreto-123");
    expect(JSON.parse(escrito)).toMatchObject({ nombre: "API_KEY" });

    await put("GITHUB_TOKEN", { valor: "ghp_token_de_prueba" });

    const lista = await rutas.request(base);
    const textoLista = await lista.text();
    expect(textoLista).not.toContain("valor-secreto-123");
    expect(textoLista).not.toContain("ghp_token_de_prueba");
    const datos = JSON.parse(textoLista) as { disponible: boolean; secretos: { nombre: string }[] };
    expect(datos.disponible).toBe(true);
    expect(datos.secretos.map((s) => s.nombre)).toEqual(["API_KEY", "GITHUB_TOKEN"]);

    expect(entornoDeProyecto(pid)).toEqual({ API_KEY: "valor-secreto-123" });
    expect(valorSecreto(pid, "GITHUB_TOKEN")).toBe("ghp_token_de_prueba");
    expect(valorSecreto(pid, "NO_EXISTE")).toBeNull();
  });

  test("un valor que no descifra se omite sin lanzar error", () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    guardarSecreto(pid, "OTRO_SECRETO", "algo");
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    expect(() => entornoDeProyecto(pid)).not.toThrow();
    expect(entornoDeProyecto(pid)).toEqual({});
    expect(valorSecreto(pid, "OTRO_SECRETO")).toBeNull();
  });

  test("validaciones: nombre, valor vacío y valor con NUL", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    expect(await (await put("PATH", { valor: "x" })).json()).toEqual({ error: "invalid_secret_name" });
    expect(await (await put("API_KEY", { valor: "" })).json()).toEqual({ error: "invalid_secret_value" });
    expect(await (await put("API_KEY", { valor: "a\u0000b" })).json()).toEqual({ error: "invalid_secret_value" });
    expect(await (await put("API_KEY", { valor: "x".repeat(8193) })).json()).toEqual({ error: "invalid_secret_value" });
    expect((await put("API_KEY", "[1]")).status).toBe(400);
  });

  test("borrar: primera vez ok, después 404", async () => {
    process.env.TELO_CLAVE_CIFRADO = CLAVE_VALIDA;
    expect(await (await rutas.request(`${base}/API_KEY`, { method: "DELETE" })).json()).toEqual({ ok: true });
    const otra = await rutas.request(`${base}/API_KEY`, { method: "DELETE" });
    expect(otra.status).toBe(404);
    expect(await otra.json()).toEqual({ error: "secret_not_found" });
  });

  test("proyecto inexistente da 404", async () => {
    const res = await rutas.request("/projects/no-existe/secretos");
    expect(res.status).toBe(404);
  });
});
