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
  expect(datos.calidad).toEqual({ tokensMedidos: 1, costesEstimados: 1, sinTokens: 1, sinCoste: 1, historicos: 1 });
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
