import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sincronizarRespaldosR2, type AlmacenRespaldosR2, type ObjetoRespaldo } from "../src/respaldo-r2";
import { leerConfiguracionR2Respaldos } from "../src/respaldo-r2-s3";

const temporal = mkdtempSync(join(tmpdir(), "telo-respaldo-r2-"));
afterAll(() => rmSync(temporal, { recursive: true, force: true }));

class AlmacenFalso implements AlmacenRespaldosR2 {
  objetos = new Map<string, { bytes: Uint8Array; etag: string }>();
  fallaValidacion = false;
  borrados: string[][] = [];

  private guardar(clave: string, bytes: Uint8Array) {
    const etag = createHash("sha256").update(bytes).digest("hex");
    this.objetos.set(clave, { bytes, etag });
    return { etag };
  }

  async subirArchivo(clave: string, ruta: string) {
    return this.guardar(clave, readFileSync(ruta));
  }

  async subirTexto(clave: string, contenido: string) {
    return this.guardar(clave, new TextEncoder().encode(contenido));
  }

  async revisar(clave: string): Promise<ObjetoRespaldo> {
    const objeto = this.objetos.get(clave);
    if (!objeto) throw new Error("objeto inexistente");
    return { bytes: objeto.bytes.byteLength + (this.fallaValidacion ? 1 : 0), etag: objeto.etag };
  }

  async listar(prefijo: string, token?: string) {
    const claves = [...this.objetos.keys()].filter((clave) => clave.startsWith(prefijo)).sort();
    const inicio = token ? Number(token) : 0;
    const pagina = claves.slice(inicio, inicio + 1);
    return { claves: pagina, siguienteToken: inicio + 1 < claves.length ? String(inicio + 1) : undefined };
  }

  async borrar(claves: string[]) {
    this.borrados.push(claves);
    for (const clave of claves) this.objetos.delete(clave);
  }
}

function conjunto(sello: string, dir: string) {
  const ruta = join(dir, `orquestador-${sello}.db`);
  writeFileSync(ruta, `base-${sello}`);
  const bytes = readFileSync(ruta).byteLength;
  return { sello, archivos: [{ nombre: `orquestador-${sello}.db`, ruta, bytes }] };
}

test("sube y verifica los conjuntos antes de podar los remotos anteriores", async () => {
  const dir = join(temporal, "completo");
  mkdirSync(dir, { recursive: true });
  const almacen = new AlmacenFalso();
  const prefijo = "respaldos/";
  await almacen.subirTexto(`${prefijo}2026-10-19T00-00-00/manifest.json`, "{}");
  almacen.objetos.set(`${prefijo}2026-10-19T00-00-00/orquestador.db`, { bytes: new Uint8Array([1]), etag: "viejo" });

  const resultado = await sincronizarRespaldosR2(almacen, {
    prefijo,
    conservar: 2,
    creadoEn: "2026-10-21T00:00:00.000Z",
    conjuntos: [
      conjunto("2026-10-20T00-00-00", dir),
      conjunto("2026-10-21T00-00-00", dir),
    ],
  });

  expect(resultado).toEqual({ subidos: 4, retirados: 1, conjuntosCompletos: 2 });
  expect([...almacen.objetos.keys()].some((clave) => clave.startsWith(`${prefijo}2026-10-19T00-00-00/`))).toBe(false);
  expect(almacen.objetos.has(`${prefijo}2026-10-20T00-00-00/manifest.json`)).toBe(true);
  expect(almacen.objetos.has(`${prefijo}2026-10-21T00-00-00/manifest.json`)).toBe(true);
  expect(almacen.borrados.flat().length).toBe(2);
});

test("si un objeto no pasa la comprobación, no elimina respaldos remotos", async () => {
  const dir = join(temporal, "fallo");
  mkdirSync(dir, { recursive: true });
  const almacen = new AlmacenFalso();
  const anterior = "respaldos/2026-10-20T00-00-00/manifest.json";
  await almacen.subirTexto(anterior, "{}");
  almacen.fallaValidacion = true;

  await expect(sincronizarRespaldosR2(almacen, {
    prefijo: "respaldos/",
    conservar: 2,
    conjuntos: [conjunto("2026-10-21T00-00-00", dir)],
  })).rejects.toThrow("se esperaban");

  expect(almacen.objetos.has(anterior)).toBe(true);
  expect(almacen.borrados).toHaveLength(0);
  expect(almacen.objetos.has("respaldos/2026-10-21T00-00-00/manifest.json")).toBe(false);
});

test("rechaza prefijos que pueden salir del espacio de respaldos", async () => {
  const almacen = new AlmacenFalso();
  await expect(sincronizarRespaldosR2(almacen, {
    prefijo: "respaldos/../otro/",
    conservar: 2,
    conjuntos: [],
  })).rejects.toThrow("prefijo de respaldos R2 no es válido");
});

test("la configuración R2 queda desactivada si está vacía y usa retención segura por defecto", () => {
  expect(leerConfiguracionR2Respaldos({})).toBeNull();
  expect(leerConfiguracionR2Respaldos({
    TELO_R2_ACCOUNT_ID: "cuenta",
    TELO_R2_BUCKET: "respaldos",
    TELO_R2_ACCESS_KEY_ID: "acceso",
    TELO_R2_SECRET_ACCESS_KEY: "secreto",
  })).toMatchObject({ prefijo: "respaldos/", conservar: 2, conservarLocal: 1 });
});

test("no permite arrancar con credenciales R2 incompletas ni retenciones inválidas", () => {
  expect(() => leerConfiguracionR2Respaldos({ TELO_R2_ACCOUNT_ID: "cuenta" })).toThrow("configuración R2 incompleta");
  expect(() => leerConfiguracionR2Respaldos({
    TELO_R2_ACCOUNT_ID: "cuenta",
    TELO_R2_BUCKET: "respaldos",
    TELO_R2_ACCESS_KEY_ID: "acceso",
    TELO_R2_SECRET_ACCESS_KEY: "secreto",
    TELO_R2_RESPALDOS_LOCALES: "-1",
  })).toThrow("TELO_R2_RESPALDOS_LOCALES");
});
