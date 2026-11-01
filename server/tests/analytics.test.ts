import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = join(tmpdir(), "telo-analytics-pruebas");
if (!process.env.TELO_PRUEBAS_ANALITICAS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_ANALITICAS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });

const { db } = await import("../src/db");
const { analytics } = await import("../src/routes/analytics");
const app = new Hono().route("/", analytics);

afterEach(() => {
  db.query("DELETE FROM uso_jev").run();
  db.query("DELETE FROM usage").run();
  db.query("DELETE FROM tasks").run();
  db.query("DELETE FROM conversations").run();
  db.query("DELETE FROM projects").run();
});

test("separa precisión de datos nuevos y históricos sin inventar consumo cero", async () => {
  db.query("INSERT INTO tasks(id,title,prompt,model,status) VALUES ('precision-tarea','Precisión','Prueba','test','done')").run();
  db.query(`INSERT INTO usage(id,provider,model,task_id,input_tokens,output_tokens,cost,tokens_precision,cost_precision)
    VALUES ('medido','test','test','precision-tarea',12,3,0,'medida','estimado'),
           ('ausente','test','test','precision-tarea',0,0,0,'no_disponible','no_disponible')`).run();
  db.query("INSERT INTO usage(id,provider,model,cost) VALUES ('historico','test','test',0.2)").run();
  const datos = await (await app.request('/analytics?days=30')).json() as any;
  expect(datos.calidad).toEqual({ tokensMedidos: 1, tokensEstimados: 0, costesEstimados: 1, sinTokens: 1, sinCoste: 1, historicos: 1 });
  expect(datos.byTask[0]).toMatchObject({ taskId: 'precision-tarea', calls: 2, tokens: 15, cost: 0, sinTokens: 1, sinCoste: 1 });
  expect(datos.byType.find((fila: any) => fila.tipo === 'tarea')).toMatchObject({ sinTokens: 1, sinCoste: 1 });
  expect(datos.totals.cost).toBe(0.2);
});

test("separa llamadas de chat y tareas y aplica los filtros a cada origen", async () => {
  db.query("INSERT INTO projects (id, name) VALUES ('proyecto-a', 'Proyecto A'), ('proyecto-b', 'Proyecto B')").run();
  db.query("INSERT INTO conversations (id, project_id, title) VALUES ('chat-a', 'proyecto-a', 'Chat A'), ('chat-b', 'proyecto-b', 'Chat B')").run();
  db.query(
    "INSERT INTO tasks (id, title, prompt, model, status, project_id, conversation_id) VALUES ('tarea-a', 'Tarea A', 'prompt', 'modelo-a', 'done', 'proyecto-a', 'chat-a')",
  ).run();

  const insertarUso = db.query(
    `INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, cost, project_id, task_id)
     VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?)`,
  );
  insertarUso.run("uso-chat", "chat-a", "modelo-a", 10, 5, 0.01, "proyecto-a", null);
  insertarUso.run("uso-tarea", "chat-a", "modelo-a", 100, 30, 0.05, "proyecto-a", "tarea-a");
  insertarUso.run("uso-otro", null, "modelo-a", 3, 2, 0.02, "proyecto-a", null);
  insertarUso.run("uso-filtrado", "chat-b", "modelo-b", 50, 20, 0.1, "proyecto-b", null);

  const respuesta = await app.request("/analytics?days=30&proyecto=proyecto-a&modelo=modelo-a");
  expect(respuesta.status).toBe(200);
  const datos = (await respuesta.json()) as {
    totals: { calls: number };
    byType: { tipo: "chat" | "tarea" | "otro"; calls: number; tokens: number; cost: number }[];
  };
  expect(datos.totals.calls).toBe(3);
  expect(datos.byType.map(({tipo,calls,tokens,cost}) => ({tipo,calls,tokens,cost}))).toEqual([
    { tipo: "chat", calls: 1, tokens: 15, cost: 0.01 },
    { tipo: "tarea", calls: 1, tokens: 130, cost: 0.05 },
    { tipo: "otro", calls: 1, tokens: 5, cost: 0.02 },
  ]);
});

test("muestra Jev aparte sin sumarlo a las llamadas ni al coste del agente", async () => {
  db.query("INSERT INTO projects (id, name) VALUES ('jev-proyecto', 'Proyecto Jev')").run();
  db.query(`INSERT INTO uso_jev (tipo, proyecto_id, modelo, tokens_entrada, tokens_salida)
    VALUES ('recomendaciones_chat', 'jev-proyecto', 'jev-latest', 12, 3),
           ('memoria_proyecto', 'jev-proyecto', 'jev-latest', 20, 5),
           ('clasificacion_tarea', NULL, 'jev-latest', 4, 2)`).run();

  const respuesta = await app.request("/analytics?days=30&proyecto=jev-proyecto&modelo=jev-latest");
  expect(respuesta.status).toBe(200);
  const datos = (await respuesta.json()) as {
    totals: { calls: number; inputTokens: number; outputTokens: number; cost: number };
    usoJev: { tipo: string; calls: number; inputTokens: number; outputTokens: number; tokens: number }[];
    modelos: string[];
  };
  expect(datos.totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
  expect(datos.usoJev).toEqual([
    { tipo: "memoria_proyecto", calls: 1, inputTokens: 20, outputTokens: 5, tokens: 25 },
    { tipo: "recomendaciones_chat", calls: 1, inputTokens: 12, outputTokens: 3, tokens: 15 },
  ]);
  expect(datos.modelos).toContain("jev-latest");
});

test("agrupa volumen por minuto, completa huecos y limita el rango", async () => {
  db.query("INSERT INTO projects (id, name) VALUES ('proyecto-volumen-a', 'Proyecto volumen A'), ('proyecto-volumen-b', 'Proyecto volumen B')").run();
  db.query(`INSERT INTO usage (id, provider, model, input_tokens, output_tokens, cost, tokens_precision, created_at, project_id)
    VALUES ('minuto-a', 'test', 'modelo-a', 100, 20, 0.01, 'medida', '2026-10-31T10:00:20.000Z', 'proyecto-volumen-a'),
           ('minuto-b', 'test', 'modelo-a', 50, 10, 0.02, 'medida', '2026-10-31T10:02:00.000Z', 'proyecto-volumen-a'),
           ('fuera-rango', 'test', 'modelo-a', 5, 1, 0, 'medida', '2026-10-31T10:03:00.000Z', 'proyecto-volumen-a'),
           ('otro-modelo', 'test', 'modelo-b', 30, 5, 0, 'medida', '2026-10-31T10:00:40.000Z', 'proyecto-volumen-a'),
           ('otro-proyecto', 'test', 'modelo-a', 30, 5, 0, 'medida', '2026-10-31T10:00:40.000Z', 'proyecto-volumen-b')`).run();

  const respuesta = await app.request("/analytics/volumen?intervalo=minuto&desde=2026-10-31T10%3A00%3A00Z&hasta=2026-10-31T10%3A02%3A59Z&proyecto=proyecto-volumen-a&modelo=modelo-a");
  expect(respuesta.status).toBe(200);
  const datos = await respuesta.json() as any;
  expect(datos.puntos).toHaveLength(3);
  expect(datos.puntos.map((punto: any) => punto.calls)).toEqual([1, 0, 1]);
  expect(datos.puntos[0]).toMatchObject({ at: "2026-10-31 10:00:00", tokens: 120 });
  expect(datos.puntos[1]).toMatchObject({ at: "2026-10-31 10:01:00", tokens: 0, modelos: [] });
  expect(datos.puntos[2].modelos[0]).toMatchObject({ model: "modelo-a", calls: 1, tokens: 60 });

  const fueraLimite = await app.request("/analytics/volumen?intervalo=minuto&desde=2026-10-31T00%3A00%3A00Z&hasta=2026-10-31T07%3A00%3A00Z");
  expect(fueraLimite.status).toBe(400);

  const maximo = await app.request("/analytics/volumen?intervalo=minuto&desde=2026-10-31T00%3A00%3A00Z&hasta=2026-10-31T06%3A00%3A59Z");
  expect(maximo.status).toBe(200);
  expect((await maximo.json() as any).puntos).toHaveLength(361);
});

test("expone tokens medidos de entrada y salida por modelo para una estimación API verificable", async () => {
  db.query(`INSERT INTO usage (id, provider, model, input_tokens, output_tokens, cost, tokens_precision, created_at)
    VALUES ('medido-modelo', 'test', 'modelo-precio', 1000, 500, 0, 'medida', datetime('now')),
           ('estimado-modelo', 'test', 'modelo-precio', 2000, 1000, 0, 'estimado', datetime('now'))`).run();
  const datos = await (await app.request("/analytics?days=7")).json() as any;
  expect(datos.byModel[0]).toMatchObject({
    model: "modelo-precio",
    inputTokens: 3000,
    outputTokens: 1500,
    measuredInputTokens: 1000,
    measuredOutputTokens: 500,
    measuredCalls: 1,
    estimatedCalls: 1,
  });
});
