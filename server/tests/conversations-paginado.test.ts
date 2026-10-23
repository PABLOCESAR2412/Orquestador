import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

// Paginación del historial: ?limite=&antes= reparte el listado con el mismo orden
// (anclados primero, luego por fecha), sin romper la respuesta heredada de sin límite.
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

const CREADOS: { id: string }[] = [];
// 6 conversaciones: la 3.ª anclada (la más reciente de las ancladas); el resto por fecha descendente.
CREADOS.push({ id: insertar("2026-01-01T00:00:00.000Z", null) });
CREADOS.push({ id: insertar("2026-02-01T00:00:00.000Z", null) });
CREADOS.push({ id: insertar("2025-12-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z") });
CREADOS.push({ id: insertar("2026-03-01T00:00:00.000Z", null) });
CREADOS.push({ id: insertar("2026-04-01T00:00:00.000Z", null) });
CREADOS.push({ id: insertar("2026-05-01T00:00:00.000Z", null) });

interface PaginaRespuesta {
  conversations?: { id: string }[];
  siguiente?: string | null;
}

async function pedirPagina(url: string): Promise<PaginaRespuesta> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return await res.json() as PaginaRespuesta;
}

async function pedirLista(url: string): Promise<{ id: string }[]> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return await res.json() as { id: string }[];
}

function idsDe(pagina: PaginaRespuesta): string[] {
  return (pagina.conversations ?? []).map((c) => c.id);
}

// Anclados primero, luego por created_at descendente (la fecha de creación desempata con rowid,
// pero en este grupo de suelo no hay empates).
const esperadoOrden = [CREADOS[2], CREADOS[5], CREADOS[4], CREADOS[3], CREADOS[1], CREADOS[0]].map((c) => c.id);

describe("paginación del listado de conversaciones", () => {
  test("sin limite responde la lista completa (comportamiento heredado)", async () => {
    const lista = await pedirLista("/api/conversations");
    expect(Array.isArray(lista)).toBe(true);
    expect(lista.map((c) => c.id)).toEqual(esperadoOrden);
  });

  test("con limite reparte por el mismo orden de la lista completa", async () => {
    const primera = await pedirPagina("/api/conversations?limite=2");
    expect(idsDe(primera)).toEqual(esperadoOrden.slice(0, 2));
    expect(primera.siguiente).toBeTruthy();

    const segunda = await pedirPagina(`/api/conversations?limite=2&antes=${primera.siguiente}`);
    expect(idsDe(segunda)).toEqual(esperadoOrden.slice(2, 4));
    expect(segunda.siguiente).toBeTruthy();

    const tercera = await pedirPagina(`/api/conversations?limite=2&antes=${segunda.siguiente}`);
    expect(idsDe(tercera)).toEqual(esperadoOrden.slice(4, 6));
    expect(tercera.siguiente).toBe(null);
  });

  test("un cursor con límite mayor cubre el resto y llega a siguiente nulo", async () => {
    const primera = await pedirPagina("/api/conversations?limite=2");
    const resto = await pedirPagina(`/api/conversations?limite=50&antes=${primera.siguiente}`);
    expect(idsDe(resto)).toEqual(esperadoOrden.slice(2));
    expect(resto.siguiente).toBe(null);
  });

  test("un cursor inválido ofrece la primera página y no rompe", async () => {
    const pagina = await pedirPagina("/api/conversations?limite=3&antes=nonsense");
    expect(idsDe(pagina)).toEqual(esperadoOrden.slice(0, 3));
    expect(pagina.siguiente).toBeTruthy();
  });

  test("limite=0 (u otro no numérico) vuelve al listado heredado", async () => {
    const lista = await pedirLista("/api/conversations?limite=0");
    expect(Array.isArray(lista)).toBe(true);
  });

  test("las páginas encadenadas no pierden ni repiten conversaciones", async () => {
    const vistas: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const pagina = await pedirPagina(`/api/conversations?limite=2${cursor ? `&antes=${cursor}` : ""}`);
      for (const id of idsDe(pagina)) {
        expect(id).not.toBe(vistas[vistas.length - 1]);
        vistas.push(id);
      }
      if (!pagina.siguiente) break;
      cursor = pagina.siguiente;
      expect(vistas.length).toBeLessThan(esperadoOrden.length + 1);
    }
    expect(vistas).toEqual(esperadoOrden);
  });
});

afterAll(() => {
  db.query("DELETE FROM conversations WHERE title = 'Paginación'").run();
});
