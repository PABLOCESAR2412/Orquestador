import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = join(tmpdir(), `telo-cerebro-${crypto.randomUUID()}`);
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
process.env.TELO_PRUEBAS_BASE_AISLADA = "1";
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { cerebro } = await import("../src/routes/cerebro");
const app = new Hono();
app.route("/api", cerebro);
const proyectoId = crypto.randomUUID();

beforeAll(() => {
  db.query("INSERT INTO projects (id,name) VALUES (?,?)").run(proyectoId, "Proyecto piloto");
});

describe("baúl Markdown del cerebro", () => {
  test("separa notas globales y del proyecto, busca localmente y deriva enlaces", async () => {
    const global = await app.request("/api/cerebro/notas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: null, title: "Decisiones", content: "# Decisiones\n\nLa arquitectura conserva el historial." }),
    });
    expect(global.status).toBe(201);

    const root = await app.request("/api/cerebro/notas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: proyectoId, title: "Arquitectura", content: "Revisa [[Seguridad]] y conserva las decisiones." }),
    });
    const child = await app.request("/api/cerebro/notas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: proyectoId, title: "Seguridad", content: "Revisar permisos." }),
    });
    expect(root.status).toBe(201);
    expect(child.status).toBe(201);

    const listarProyecto = await app.request(`/api/cerebro/notas?project_id=${proyectoId}`);
    const datosProyecto = await listarProyecto.json() as { notas: { id: string; title: string }[]; busqueda: string };
    expect(datosProyecto.busqueda).toBe("local");
    expect(datosProyecto.notas.map((nota) => nota.title)).toContain("Arquitectura");
    expect(datosProyecto.notas.map((nota) => nota.title)).not.toContain("Decisiones");

    const busqueda = await app.request(`/api/cerebro/notas?project_id=${proyectoId}&q=permisos`);
    expect((await busqueda.json() as { notas: { title: string }[] }).notas.map((nota) => nota.title)).toEqual(["Seguridad"]);

    const grafo = await app.request(`/api/cerebro/grafo?project_id=${proyectoId}`);
    const mapa = await grafo.json() as { nodos: { id: string }[]; enlaces: { source: string; target: string; label: string }[] };
    expect(mapa.nodos).toHaveLength(2);
    expect(mapa.enlaces).toEqual([{ source: (await root.json() as { id: string }).id, target: (await child.json() as { id: string }).id, label: "Seguridad" }]);
  });

  test("permite editar y borrar una nota e impide usar un ámbito inexistente", async () => {
    const creada = await app.request("/api/cerebro/notas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: proyectoId, title: "Borrador", content: "Texto inicial" }),
    });
    const nota = await creada.json() as { id: string };
    const editada = await app.request(`/api/cerebro/notas/${nota.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nota editada", content: "Texto nuevo" }),
    });
    expect((await editada.json() as { title: string; content: string }).title).toBe("Nota editada");
    expect((await app.request(`/api/cerebro/notas?project_id=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await app.request(`/api/cerebro/notas/${nota.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await app.request(`/api/cerebro/notas/${nota.id}`)).status).toBe(404);
  });

  test("rechaza notas con título vacío o contenido fuera del límite", async () => {
    for (const body of [
      { project_id: null, title: "  ", content: "texto" },
      { project_id: null, title: "Nota", content: "x".repeat(48 * 1024 + 1) },
    ]) {
      const respuesta = await app.request("/api/cerebro/notas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(respuesta.status).toBe(400);
    }
  });
});
