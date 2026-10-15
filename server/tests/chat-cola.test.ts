import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const raiz = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../src/db");
const { chat } = await import("../src/routes/chat");
const ids: { proyecto: string; carpeta: string }[] = [];
afterEach(() => {
  for (const p of ids.splice(0)) {
    db.query("DELETE FROM tasks WHERE project_id=?").run(p.proyecto);
    db.query("DELETE FROM conversations WHERE project_id=?").run(p.proyecto);
    db.query("DELETE FROM projects WHERE id=?").run(p.proyecto);
    rmSync(p.carpeta, { recursive: true, force: true });
  }
});
async function crear() {
  const proyecto = crypto.randomUUID(),
    carpeta = join(process.env.TELO_PROYECTOS_DIR!, proyecto);
  mkdirSync(carpeta);
  ids.push({ proyecto, carpeta });
  db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,?,?)").run(proyecto, "Chat", carpeta);
  const c = await chat
    .request("http://telo/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: proyecto }),
    })
    .then((r) => r.json());
  return { proyecto, carpeta, id: c.id as string };
}
const enviar = (id: string, content: unknown) =>
  chat.request(`http://telo/conversations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
test("el chat guarda el mensaje y encola, rechaza solapes y conserva la tarea y la sesión entre turnos", async () => {
  const c = await crear();
  const r = await enviar(c.id, "Revisa el proyecto");
  expect(r.status).toBe(202);
  const first = await r.json();
  const tarea = db.query<any, [string]>("SELECT * FROM tasks WHERE id=?").get(first.taskId);
  expect(tarea.phase).toBe("analyzing");
  expect(tarea.conversation_id).toBe(c.id);
  expect(tarea.project_id).toBe(c.proyecto);
  expect((await enviar(c.id, "No debe solaparse")).status).toBe(409);
  db.query(
    "UPDATE tasks SET status='done',phase='completed',provider_session_id='ses_conservada',plan='{}',report='{}' WHERE id=?",
  ).run(first.taskId);
  db.query(
    "INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload) VALUES (?,?,?,?,'commit','{}')",
  ).run(crypto.randomUUID(), c.proyecto, c.id, first.taskId);
  const segundo = await enviar(c.id, "Ahora comprueba los cambios");
  expect(segundo.status).toBe(202);
  expect((await segundo.json()).taskId).toBe(first.taskId);
  const continua = db.query<any, [string]>("SELECT * FROM tasks WHERE id=?").get(first.taskId);
  expect(continua.provider_session_id).toBe("ses_conservada");
  expect(continua.plan).toBeNull();
  expect(continua.report).toBeNull();
  expect(
    db
      .query<any, [string]>("SELECT state FROM repository_actions WHERE task_id=?")
      .get(first.taskId).state,
  ).toBe("superseded");
  expect(
    db.query<any, [string]>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(c.id)
      .n,
  ).toBe(2);
});
test("dos conversaciones de un proyecto reciben tareas distintas", async () => {
  const c = await crear();
  const otra = await chat
    .request("http://telo/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: c.proyecto }),
    })
    .then((r) => r.json());
  const a = await enviar(c.id, "Primera").then((r) => r.json()),
    b = await enviar(otra.id, "Segunda").then((r) => r.json());
  expect(a.taskId).not.toBe(b.taskId);
});
test("una orden directa de Git prepara autorización y no ejecuta Git ni un agente", async () => {
  const c = await crear();
  const r = await enviar(c.id, "haz git init");
  expect(r.status).toBe(202);
  const body = await r.json();
  expect(body.action.state).toBe("pending");
  expect(body.action.action).toBe("init");
  expect(existsSync(join(c.carpeta, ".git"))).toBe(false);
  expect(
    db.query<any, [string]>("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id=?").get(c.id).n,
  ).toBe(0);
});
test("rechaza cuerpos de chat inválidos sin guardar mensajes", async () => {
  const c = await crear();
  for (const content of [null, 42, {}, [], ""])
    expect((await enviar(c.id, content)).status).toBe(400);
  expect(
    (
      await chat.request("http://telo/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      })
    ).status,
  ).toBe(400);
  expect(
    db.query<any, [string]>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(c.id)
      .n,
  ).toBe(0);
});
