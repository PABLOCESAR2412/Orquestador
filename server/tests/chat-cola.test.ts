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
  const res = await chat.request("http://telo/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: proyecto }),
  });
  const c = (await res.json()) as any;
  return { proyecto, carpeta, id: c.id as string };
}
const enviar = (id: string, content: unknown) =>
  chat.request(`http://telo/conversations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
test("el chat guarda el mensaje y encola, encola los solapes en orden y crea una nueva tarea conservando el historial y la sesión", async () => {
  const c = await crear();
  const r = await enviar(c.id, "Revisa el proyecto");
  expect(r.status).toBe(202);
  const first = (await r.json()) as any;
  const tarea = db.query<any, [string]>("SELECT * FROM tasks WHERE id=?").get(first.taskId);
  expect(tarea.status).toBe("queued");
  expect(tarea.conversation_id).toBe(c.id);
  expect(tarea.project_id).toBe(c.proyecto);
  expect(tarea.message_id).toBe(first.messages[0].id);
  db.query(
    "INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload) VALUES (?,?,?,?,'commit','{}')",
  ).run(crypto.randomUUID(), c.proyecto, c.id, first.taskId);
  // Tarea 12: un mensaje más mientras la tarea sigue activa no se rechaza: se encola como tarea nueva, en orden.
  const solape = await enviar(c.id, "No debe solaparse");
  expect(solape.status).toBe(202);
  const solapeId = ((await solape.json()) as any).taskId as string;
  expect(solapeId).not.toBe(first.taskId);
  expect(db.query<any, [string]>("SELECT status FROM tasks WHERE id=?").get(solapeId)?.status).toBe("queued");
  // Al encolar el mensaje siguiente, la acción git pendiente de la tarea anterior queda superseded.
  expect(
    db
      .query<any, [string]>("SELECT state FROM repository_actions WHERE task_id=?")
      .get(first.taskId)?.state,
  ).toBe("superseded");
  db.query(
    "UPDATE tasks SET status='done',provider_session_id='ses_conservada',plan='{}',reporte='{}' WHERE id=?",
  ).run(first.taskId);
  db.query("UPDATE conversations SET runner_session_id='ses_conservada' WHERE id=?").run(c.id);
  const segundo = await enviar(c.id, "Ahora comprueba los cambios");
  expect(segundo.status).toBe(202);
  const segundoCuerpo = (await segundo.json()) as any;
  const segundoId = segundoCuerpo.taskId;
  expect(segundoId).not.toBe(first.taskId);
  expect(segundoId).not.toBe(solapeId);
  // La tarea anterior no se destruye: conserva su reporte y plan intactos
  const anterior = db.query<any, [string]>("SELECT * FROM tasks WHERE id=?").get(first.taskId);
  expect(anterior.status).toBe("done");
  expect(anterior.plan).toBe("{}");
  expect(anterior.reporte).toBe("{}");
  // La nueva tarea hereda la sesión para continuidad
  const nueva = db.query<any, [string]>("SELECT * FROM tasks WHERE id=?").get(segundoId);
  expect(nueva.status).toBe("queued");
  expect(nueva.provider_session_id).toBe("ses_conservada");
  expect(nueva.message_id).toBe(segundoCuerpo.messages[0].id);
  expect(
    db.query<any, [string]>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(c.id)
      .n,
  ).toBe(3);
});
test("seguir vincula la ejecución al mensaje de continuación y conserva la sesión", async () => {
  const c = await crear();
  const primera = (await (await enviar(c.id, "Encargo original")).json()) as any;
  db.query("UPDATE tasks SET status='sin_cuota',modelo_agotado='opencode/agotado',provider_session_id='sesion-conservada' WHERE id=?").run(primera.taskId);
  db.query("UPDATE conversations SET model='opencode/continuacion',cuota_modelo='opencode/agotado' WHERE id=?").run(c.id);
  const response = await chat.request(`http://telo/conversations/${c.id}/seguir`, { method: "POST" });
  expect(response.status).toBe(202);
  const cuerpo = (await response.json()) as any;
  expect(cuerpo.taskId).toBe(primera.taskId);
  expect(cuerpo.messages[0].id).not.toBe(primera.messages[0].id);
  expect(db.query<any, [string]>("SELECT message_id,status,provider_session_id FROM tasks WHERE id=?").get(primera.taskId))
    .toEqual({ message_id: cuerpo.messages[0].id, status: "queued", provider_session_id: "sesion-conservada" });
  expect(db.query("SELECT 1 FROM messages WHERE id=?").get(primera.messages[0].id)).not.toBeNull();
});
test("dos conversaciones de un proyecto reciben tareas distintas", async () => {
  const c = await crear();
  const resOtra = await chat.request("http://telo/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: c.proyecto }),
  });
  const otra = (await resOtra.json()) as any;
  const a = (await (await enviar(c.id, "Primera")).json()) as any;
  const b = (await (await enviar(otra.id, "Segunda")).json()) as any;
  expect(a.taskId).not.toBe(b.taskId);
});
for (const estado of ["running", "analyzing", "waiting_approval"]) {
  test(`el listado conserva visible la tarea ${estado} aunque lleguen mensajes nuevos`, async () => {
    const c = await crear();
    const primera = (await (await enviar(c.id, "Primera tarea")).json()) as any;
    db.query("UPDATE tasks SET status=?,plan_hash='plan-visible' WHERE id=?").run(estado, primera.taskId);
    const segunda = (await (await enviar(c.id, "Segundo turno")).json()) as any;
    const tercera = (await (await enviar(c.id, "Tercer turno")).json()) as any;
    const visible = async () => ((await (await chat.request("http://telo/conversations")).json()) as any[])
      .find((conversacion) => conversacion.id === c.id);
    expect(await visible()).toMatchObject({
      estado_tarea_id: primera.taskId,
      estado_tarea: estado === "waiting_approval" ? "pendiente_aprobacion" : "en_proceso",
      pendiente_aprobacion: estado === "waiting_approval",
    });
    db.query("UPDATE tasks SET status='done' WHERE id=?").run(primera.taskId);
    expect((await visible()).estado_tarea_id).toBe(segunda.taskId);
    db.query("UPDATE tasks SET status='done' WHERE id IN (?,?)").run(segunda.taskId, tercera.taskId);
    expect((await visible()).estado_tarea_id).toBe(tercera.taskId);
  });
  test(`detener alcanza la tarea ${estado} y cancela todos los turnos posteriores`, async () => {
    const c = await crear();
    const primera = (await (await enviar(c.id, "Primera tarea")).json()) as any;
    db.query("UPDATE tasks SET status=?,provider_session_id='sesion-conservada',workspace=? WHERE id=?")
      .run(estado, c.carpeta, primera.taskId);
    const segunda = (await (await enviar(c.id, "Segundo turno")).json()) as any;
    const tercera = (await (await enviar(c.id, "Tercer turno")).json()) as any;
    const terminal = crypto.randomUUID();
    db.query("INSERT INTO tasks(id,title,prompt,model,status,conversation_id,project_id) VALUES (?,'Terminada','p','prueba','done',?,?)")
      .run(terminal, c.id, c.proyecto);

    const response = await chat.request(`http://telo/conversations/${c.id}/detener`, { method: "POST" });
    const cancelando = estado !== "waiting_approval";
    expect(response.status).toBe(cancelando ? 202 : 200);
    expect(await response.json()).toEqual({ outcome: cancelando ? "cancelling" : "cancelled" });
    expect(db.query<any, [string]>("SELECT status,provider_session_id,workspace FROM tasks WHERE id=?").get(primera.taskId))
      .toEqual({ status: cancelando ? estado : "cancelled", provider_session_id: "sesion-conservada", workspace: c.carpeta });
    if (cancelando) {
      expect(db.query("SELECT 1 FROM task_events WHERE task_id=? AND kind='cancelacion_pedida'").get(primera.taskId)).not.toBeNull();
    }
    for (const id of [segunda.taskId, tercera.taskId]) {
      expect(db.query<any, [string]>("SELECT status FROM tasks WHERE id=?").get(id)?.status).toBe("cancelled");
    }
    expect(db.query<any, [string]>("SELECT status FROM tasks WHERE id=?").get(terminal)?.status).toBe("done");
    expect(db.query<any, [string]>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(c.id)?.n).toBe(3);
  });
}
test("una orden directa de Git prepara autorización y no ejecuta Git ni un agente", async () => {
  const c = await crear();
  const r = await enviar(c.id, "haz git init");
  expect(r.status).toBe(202);
  const body = (await r.json()) as any;
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
