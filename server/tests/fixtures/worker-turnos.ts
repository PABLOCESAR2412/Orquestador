// Worker y persistencia reales; el proveedor externo se sustituye en este proceso aislado.
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import type { OpcionesAgente } from "../../src/ejecutar";
import { pideSubagentes } from "../../../shared/delegacion";

const acciones: { taskId: string; messageId: string | null }[] = [];
const llamadas: OpcionesAgente[] = [];
mock.module("../../src/comprobaciones-tarea", () => ({ comprobarHerramientas: () => [], revisarDependencias: () => [] }));
mock.module("../../src/jev", () => ({ clasificarTareaJev: async () => null }));
mock.module("../../src/routes/repository-actions", () => ({
  repositoryActions: { request: async (_url: string, init: RequestInit) => {
    acciones.push(JSON.parse(String(init.body)));
    return Response.json({ ok: true });
  } },
}));
mock.module("../../src/subagentes", () => ({ pideSubagentes, prepararSubagentes: async () => ({
  instruccion: "", directorio: "fixture", rutaCaptura: "fixture", finalizarCaptura() {}, limpiar() {},
}) }));
mock.module("../../src/ejecutar", () => ({
  ErrorCuota: class extends Error {},
  promptContinuacion: (prompt: string) => prompt,
  ejecutarAgente: async (opts: OpcionesAgente) => {
    llamadas.push(opts);
    opts.onLinea?.(JSON.stringify({ type: "text", part: { text: `actividad ${opts.taskId}` } }));
    opts.onSubagente?.(JSON.stringify({ kind: "created", sessionId: `hijo_${opts.taskId}_${opts.soloLectura ? "plan" : "obra"}`, title: `hijo ${opts.taskId}` }));
    const text = JSON.stringify(opts.soloLectura ? {
      objetivo: "Verificar atribución", supuestos: [], pasos: [{ id: 1, descripcion: "Revisar", archivos: [] }],
      criterios_de_aceptacion: ["No mezclar turnos"], requiere_aprobacion: ["commit"], riesgos: [], preguntas: [],
    } : { estado: "completado", resumen: "Terminado", cambios: [], pruebas: [], pendientes: [], diff_disponible: false });
    return { text, textoFinal: text, sessionId: null, modelo: opts.model, variante: null };
  },
}));

const { db } = await import("../../src/db");
const { crearTarea } = await import("../../src/tareas");
const { startWorker, aprobarPlan } = await import("../../src/worker");
const proyecto = crypto.randomUUID(), conversacion = crypto.randomUUID();
db.query("INSERT INTO projects(id,name) VALUES (?,'Fixture')").run(proyecto);
db.query("INSERT INTO conversations(id,project_id) VALUES (?,?)").run(conversacion, proyecto);
const mensajeA = crypto.randomUUID(), mensajeB = crypto.randomUUID();
db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','A'),(?,?,'user','B')")
  .run(mensajeA, conversacion, mensajeB, conversacion);
const base = { model: "fixture/modelo", effort: null, projectId: proyecto, conversationId: conversacion };
const a = crearTarea({ ...base, prompt: "A", messageId: mensajeA });
const b = crearTarea({ ...base, prompt: "B", messageId: mensajeB });
const proyectoLegacy = crypto.randomUUID(), chatLegacy = crypto.randomUUID(), mensajeLegacy = crypto.randomUUID();
db.query("INSERT INTO projects(id,name) VALUES (?,'Legacy')").run(proyectoLegacy);
db.query("INSERT INTO conversations(id,project_id) VALUES (?,?)").run(chatLegacy, proyectoLegacy);
db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','No atribuir por proximidad')").run(mensajeLegacy, chatLegacy);
const legacy = crearTarea({ ...base, projectId: proyectoLegacy, conversationId: chatLegacy, prompt: "Legacy" });
const estado = (id: string) => db.query<{ status: string; plan_hash: string }, [string]>("SELECT status,plan_hash FROM tasks WHERE id=?").get(id)!;
const esperar = async (condicion: () => boolean) => {
  const hasta = Date.now() + 10_000;
  while (!condicion()) {
    assert(Date.now() < hasta, "El worker no completó el flujo esperado");
    await Bun.sleep(10);
  }
};
try {
  startWorker();
  await esperar(() => estado(a).status === "waiting_approval" && estado(legacy).status === "waiting_approval");
  assert.equal(estado(b).status, "queued");
  assert.equal(aprobarPlan(a, null, estado(a).plan_hash), "ok");
  assert.equal(aprobarPlan(legacy, null, estado(legacy).plan_hash), "ok");
  await esperar(() => estado(a).status === "done" && estado(b).status === "waiting_approval" && estado(legacy).status === "done" && acciones.length === 2);
  for (const [id, mensaje] of [[a, mensajeA], [b, mensajeB]]) {
    const actividad = db.query<{ turno_id: string; titulo: string }, [string]>("SELECT turno_id,titulo FROM chat_actividad WHERE conversation_id=?").all(conversacion).filter((item) => item.titulo.includes(id));
    assert(actividad.length > 0);
    assert(actividad.every((item) => item.turno_id === mensaje));
    const hijos = db.query<{ parent_turn_id: string }, [string]>("SELECT parent_turn_id FROM conversations WHERE title=?").all(`hijo ${id}`);
    assert(hijos.length > 0);
    assert(hijos.every((hijo) => hijo.parent_turn_id === mensaje));
  }
  assert.equal(acciones.find((accion) => accion.taskId === a)?.messageId, mensajeA);
  assert.equal(acciones.find((accion) => accion.taskId === legacy)?.messageId, null);
  assert.equal(db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM chat_actividad WHERE conversation_id=?").get(chatLegacy)?.n, 0);
  assert.equal(db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM conversations WHERE parent_conversation_id=?").get(chatLegacy)?.n, 0);
  const proyectoGestionado = crypto.randomUUID(), chatGestionado = crypto.randomUUID(), turnoGestionado = crypto.randomUUID();
  db.query("INSERT INTO projects(id,name) VALUES (?,'Gestionado')").run(proyectoGestionado);
  db.query("INSERT INTO conversations(id,project_id,orquestacion_habilitada,orquestacion_trabajadores) VALUES (?,?,1,?)")
    .run(chatGestionado, proyectoGestionado, JSON.stringify([{ model: "codex/revisor", rol: "seguridad" }]));
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,'user','Usa subagentes para auditar el proyecto')").run(turnoGestionado, chatGestionado);
  const gestionada = crearTarea({ ...base, projectId: proyectoGestionado, conversationId: chatGestionado, messageId: turnoGestionado, prompt: "Usa subagentes para auditar el proyecto" });
  await esperar(() => estado(gestionada).status === "waiting_approval");
  const revisores = llamadas.filter((l) => l.taskId === gestionada && l.usageRole?.startsWith("reviewer:"));
  assert.equal(revisores.length, 1);
  assert.equal(revisores[0].model, "codex/revisor");
  assert.equal(revisores[0].soloLectura, true);
  assert.equal(revisores[0].turnId, turnoGestionado);
  assert(llamadas.find((l) => l.taskId === gestionada && l.usageRole === "analyzer")?.prompt.includes("Informes auxiliares"));
  assert.equal(aprobarPlan(gestionada, null, estado(gestionada).plan_hash), "ok");
  await esperar(() => estado(gestionada).status === "done");
  assert.equal(llamadas.filter((l) => l.taskId === gestionada && l.usageRole === "worker").length, 1);
  const turnoDirecto = crypto.randomUUID();
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,'user','Describe el proyecto')").run(turnoDirecto, chatGestionado);
  const directa = crearTarea({ ...base, projectId: proyectoGestionado, conversationId: chatGestionado, messageId: turnoDirecto, prompt: "Describe el proyecto" });
  await esperar(() => estado(directa).status === "waiting_approval");
  assert.equal(llamadas.filter((l) => l.taskId === directa && l.usageRole?.startsWith("reviewer:")).length, 0);
  console.log("turnos de tareas verificados");
  db.close();
  process.exit(0);
} catch (error) {
  console.error(error);
  db.close();
  process.exit(1);
}
