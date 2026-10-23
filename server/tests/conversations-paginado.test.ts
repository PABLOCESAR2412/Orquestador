import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

// Paginación del historial: ?limite=&antes= reparte el listado con el mismo orden
// (anclados primero, luego por fecha), sin romper la respuesta heredada de sin límite.
// La suite comparte la base entre ficheros: las pruebas invariantes que solo aluden a
// las FILA CREADAS AQUÍ (su orden relativo y que no se pierda ni repita ninguna), no al
// contenido completo de la lista.
const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { chat } = await import("../src/routes/chat");

const app = new Hono();
app.route("/api", chat);

function insertar(created_at: string, pinned_at: string | null): string {
  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO conversations (id, title, model, created_at, pinned_at) VALUES (?, 'Paginación', 'opencode/a', ?, ?)",
  ).run(id, created_at, pinned_at);
  return id;
}

// 6 conversaciones: la 3.ª anclada (la más reciente de las ancladas); el resto por fecha descendente.
// El orden esperado de estas filas entre sí: anclado, y de las sueltas la más reciente primero.
const MIO_ANCLADO = insertar("2025-12-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z");
const MI_ORDEN = [
  MIO_ANCLADO,
  insertar("2026-05-01T00:00:00.000Z", null),
  insertar("2026-04-01T00:00:00.000Z", null),
  insertar("2026-03-01T00:00:00.000Z", null),
  insertar("2026-02-01T00:00:00.000Z", null),
  insertar("2026-01-01T00:00:00.000Z", null),
];
const esMio = (id: string) => MI_ORDEN.includes(id);
// El orden relativo del subconjunto propio en una lista del servidor: igual que MI_ORDEN.
const miosDe = (ids: string[]) => ids.filter(esMio);
const esIrrepetible = (ids: string[]) => new Set(ids).size === ids.length;

interface PaginaRespuesta {
  conversations?: { id: string }[];
  siguiente?: string | null;
}

async function pedirPagina(url: string): Promise<PaginaRespuesta> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return await res.json() as PaginaRespuesta;
}

async function pedirLista(): Promise<string[]> {
  const res = await app.request("/api/conversations");
  expect(res.status).toBe(200);
  const lista = await res.json() as { id: string }[];
  expect(Array.isArray(lista)).toBe(true);
  return lista.map((c: { id: string }) => c.id);
}

describe("paginación del listado de conversaciones", () => {
  test("sin limite responde un array con el orden propio preservado (comportamiento heredado)", async () => {
    expect(miosDe(await pedirLista())).toEqual(MI_ORDEN);
  });

  test("cada tanda de limite corta la lista en el mismo orden y no repite ids", async () => {
    const completa = await pedirLista();
    const vistas: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const pagina = await pedirPagina(`/api/conversations?limite=2${cursor ? `&antes=${cursor}` : ""}`);
      const ids = (pagina.conversations ?? []).map((c: { id: string }) => c.id);
      expect(ids.length).toBeLessThanOrEqual(2);
      vistas.push(...ids);
      if (!pagina.siguiente) break;
      cursor = pagina.siguiente;
      expect(vistas.length).toBeLessThanOrEqual(completa.length + 1);
    }
    // Las tandas encadenadas cubren toda la lista sin repeticiones y conservan el orden propio.
    expect(esIrrepetible(vistas)).toBe(true);
    expect(miosDe(vistas)).toEqual(MI_ORDEN);
  });

  test("un cursor de la primera tanda más el resto (límite grande) cubre todo una vez", async () => {
    const primera = await pedirPagina("/api/conversations?limite=2");
    const idsPrimera = (primera.conversations ?? []).map((c: { id: string }) => c.id);
    expect(idsPrimera.length).toBe(2);
    const resto = await pedirPagina(`/api/conversations?limite=50&antes=${primera.siguiente}`);
    const idsResto = (resto.conversations ?? []).map((c: { id: string }) => c.id);
    expect(resto.siguiente).toBe(null);
    expect(esIrrepetible([...idsPrimera, ...idsResto])).toBe(true);
    expect(miosDe([...idsPrimera, ...idsResto])).toEqual(MI_ORDEN);
  });

  test("un cursor inválido ofrece la primera página y no rompe", async () => {
    const completa = await pedirLista();
    const pagina = await pedirPagina("/api/conversations?limite=3&antes=nonsense");
    expect((pagina.conversations ?? []).map((c: { id: string }) => c.id)).toEqual(completa.slice(0, 3));
    expect(pagina.siguiente).toBeTruthy();
  });

  test("limite=0 (u otro no numérico) vuelve al listado heredado", async () => {
    const res = await app.request("/api/conversations?limite=0");
    expect(res.status).toBe(200);
    const lista = await res.json();
    expect(Array.isArray(lista)).toBe(true);
  });
});

afterAll(() => {
  db.query("DELETE FROM conversations WHERE title = 'Paginación'").run();
});
