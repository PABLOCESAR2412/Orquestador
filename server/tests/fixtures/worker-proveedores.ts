import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import type { OpcionesAgente } from "../../src/ejecutar";

let iniciado = false;
mock.module("../../src/comprobaciones-tarea", () => ({ comprobarHerramientas: () => [], revisarDependencias: () => [] }));
mock.module("../../src/jev", () => ({ clasificarTareaJev: async () => null }));
mock.module("../../src/ejecutar", () => ({
  ErrorCuota: class extends Error {}, promptContinuacion: (prompt: string) => prompt,
  ejecutarAgente: async (opts: OpcionesAgente) => {
    if (opts.prompt.includes("BLOQUEAR_PRIMERA")) {
      iniciado = true;
      await new Promise<void>((_, reject) => opts.signal!.addEventListener("abort", () => reject(new Error("cancelada")), { once: true }));
    }
    const text = JSON.stringify({ objetivo: "Inspeccionar", supuestos: [], pasos: [{ id: 1, descripcion: "Revisar", archivos: [] }], criterios_de_aceptacion: ["Revisión"], requiere_aprobacion: ["commit"], riesgos: [], preguntas: [] });
    return { text, textoFinal: text, sessionId: null, usage: null, modelo: opts.model, variante: null };
  },
}));
const { db } = await import("../../src/db");
const { crearTarea } = await import("../../src/tareas");
const { startWorker, cancelTask } = await import("../../src/worker");
const estado = (id: string) => db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id=?").get(id)!.status;
const esperar = async (condicion: () => boolean) => {
  const hasta = Date.now() + 8_000;
  while (!condicion()) { assert(Date.now() < hasta, "El worker no liberó el proveedor esperado"); await Bun.sleep(10); }
};
try {
  const conv = crypto.randomUUID(), mensaje = crypto.randomUUID();
  db.query("INSERT INTO conversations(id,title) VALUES (?,'En espera')").run(conv);
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Revisar')").run(mensaje, conv);
  const ids = Array.from({ length: 12 }, (_, i) => crearTarea({ prompt: i ? "Revisar" : "BLOQUEAR_PRIMERA", model: "opencode/glm-free", effort: null, projectId: null }));
  db.query("UPDATE tasks SET conversation_id=?,message_id=? WHERE id=?").run(conv, mensaje, ids[1]);
  const mensajeCancelado = crypto.randomUUID();
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Cancelar espera')").run(mensajeCancelado, conv);
  db.query("UPDATE tasks SET conversation_id=?,message_id=? WHERE id=?").run(conv, mensajeCancelado, ids[2]);
  const otro = crearTarea({ prompt: "Revisar otro proveedor", model: "google/gemini", effort: null, projectId: null });
  startWorker();
  await esperar(() => iniciado && estado(otro) === "waiting_approval");
  assert.equal(estado(ids[0]), "analyzing");
  assert(ids.slice(1).every(id => estado(id) === "queued"));
  const esperaVisible = (id: string) => db.query<{ estado: string }, [string]>("SELECT estado FROM chat_actividad WHERE call_id=?").get(`queue:task-${id}`);
  assert.equal(esperaVisible(ids[1])?.estado, "en_curso");
  cancelTask(ids[2]);
  assert.equal(esperaVisible(ids[2])?.estado, "error");
  cancelTask(ids[0]);
  await esperar(() => ids.slice(1).filter(id => id !== ids[2]).every(id => estado(id) === "waiting_approval"));
  assert.equal(estado(ids[0]), "cancelled");
  assert.equal(esperaVisible(ids[1])?.estado, "hecha");
  console.log("proveedores independientes verificados"); db.close(); process.exit(0);
} catch (error) { console.error(error); db.close(); process.exit(1); }
