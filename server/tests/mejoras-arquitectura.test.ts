import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicar, eventosDesde } from "../src/bus";
import { limpiarSesionesAntiguas, crearSesionDispositivo } from "../src/auth";
import { proyectoOcupado } from "../src/ocupacion";
import { conInstrucciones } from "../src/ejecutar";
import { analytics } from "../src/routes/analytics";
import { db } from "../src/db";

describe("resiliencia SSE: buffer circular y Last-Event-ID", () => {
  test("asigna secuencia incremental a cada evento y los recupera con eventosDesde", () => {
    const id1 = publicar({ tipo: "chat", conversacion_id: "conv-1", estado: "en_curso" });
    const id2 = publicar({ tipo: "chat", conversacion_id: "conv-1", estado: "terminado" });

    expect(id2).toBeGreaterThan(id1);

    const pendientes = eventosDesde(id1);
    expect(pendientes.length).toBeGreaterThanOrEqual(1);
    const encontrado = pendientes.find((p) => p.id === id2);
    expect(encontrado).toBeDefined();
    expect(encontrado?.evento.tipo).toBe("chat");

    // Si pide desde un id futuro o inexistente muy alto, devuelve array vacío
    expect(eventosDesde(id2 + 1000)).toEqual([]);
  });
});

describe("mantenimiento y purga de sesiones", () => {
  test("limpiarSesionesAntiguas no borra sesiones recientes y elimina las vencidas", () => {
    const s = crearSesionDispositivo({ userAgent: "Prueba Limpieza", ip: "127.0.0.1" });

    // Modificar last_seen_at para simular una sesión de hace 90 días
    db.query("UPDATE auth_sessions SET last_seen_at = datetime('now', '-90 days') WHERE id = ?").run(s.id);

    const borradas = limpiarSesionesAntiguas(60);
    expect(borradas).toBeGreaterThanOrEqual(1);

    const verificacion = db.query("SELECT id FROM auth_sessions WHERE id = ?").get(s.id);
    expect(verificacion).toBeNull();
  });
});

describe("serialización de proyecto y ocupación", () => {
  test("proyectoOcupado devuelve true cuando hay una tarea en waiting_approval", () => {
    const pId = crypto.randomUUID();
    const tId = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Test Serializacion', '/tmp')").run(pId);
    expect(proyectoOcupado(pId)).toBe(false);

    db.query("INSERT INTO tasks (id, project_id, title, prompt, model, status) VALUES (?, ?, 'Task', 'Test', 'model', 'waiting_approval')")
      .run(tId, pId);
    expect(proyectoOcupado(pId)).toBe(true);

    db.query("UPDATE tasks SET status='done' WHERE id=?").run(tId);
    expect(proyectoOcupado(pId)).toBe(false);
  });
});

describe("compartir_contexto entre chats del proyecto", () => {
  test("inyecta contexto de otros chats cuando compartir_contexto está activo", () => {
    const pId = crypto.randomUUID();
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path, compartir_contexto) VALUES (?, 'Proyecto Compartido', '/tmp', 1)").run(pId);
    db.query("INSERT INTO conversations (id, project_id, title) VALUES (?, ?, 'Investigación DB')").run(c1, pId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'Se eligió SQLite WAL para persistencia')")
      .run(crypto.randomUUID(), c1);

    db.query("INSERT INTO conversations (id, project_id, title) VALUES (?, ?, 'Desarrollo API')").run(c2, pId);

    const promptConContexto = conInstrucciones(pId, "Crea la ruta de tareas", c2);
    expect(promptConContexto).toContain("Contexto compartido de otros chats del proyecto:");
    expect(promptConContexto).toContain('Chat "Investigación DB": Se eligió SQLite WAL');
    expect(promptConContexto).toContain("Crea la ruta de tareas");
  });

  test("no inyecta contexto de otros chats si compartir_contexto está desactivado", () => {
    const pId = crypto.randomUUID();
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();
    db.query("INSERT INTO projects (id, name, repo_path, compartir_contexto) VALUES (?, 'Proyecto Aislado', '/tmp', 0)").run(pId);
    db.query("INSERT INTO conversations (id, project_id, title) VALUES (?, ?, 'Chat Secreto')").run(c1, pId);
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', 'Datos sensibles')")
      .run(crypto.randomUUID(), c1);

    const promptSinContexto = conInstrucciones(pId, "Acción normal", c2);
    expect(promptSinContexto).toBe("Acción normal");
  });
});

describe("documentos guía en tareas sin proyecto", () => {
  test("lee AGENTS.md y CLAUDE.md del workspace y los antepone al prompt", () => {
    const raiz = mkdtempSync(join(tmpdir(), "telo-guias-"));
    try {
      writeFileSync(join(raiz, "AGENTS.md"), "Convenciones del repo: usa bun y pruebas con bun test.\n");
      writeFileSync(join(raiz, "CLAUDE.md"), "Guía: reinicia el worker tras cambiar el worker.\n");
      const salida = conInstrucciones(null, "Repara el scroll del diagrama", null, raiz);
      expect(salida).toContain("Documentos guía del workspace (AGENTS.md, CLAUDE.md");
      expect(salida).toContain("Convenciones del repo: usa bun y pruebas con bun test.");
      expect(salida).toContain("Guía: reinicia el worker tras cambiar el worker.");
      expect(salida).toContain("Repara el scroll del diagrama");
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  test("sin documentos guía deja el prompt intacto", () => {
    const raiz = mkdtempSync(join(tmpdir(), "telo-guias-"));
    try {
      expect(conInstrucciones(null, "Pregunta simple", null, raiz)).toBe("Pregunta simple");
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});

describe("métricas de tokens de razonamiento en analíticas", () => {
  test("suma reasoning_tokens al total de tokens por tarea, por tipo y por modelo", async () => {
    const tId = crypto.randomUUID();
    db.query("INSERT INTO tasks (id, title, prompt, model, status) VALUES (?, 'Tarea R1', 'Razonar', 'deepseek/r1', 'done')").run(tId);
    db.query(`INSERT INTO usage (id, task_id, model, provider, input_tokens, output_tokens, reasoning_tokens, cost, tokens_precision, cost_precision)
      VALUES (?, ?, 'deepseek/r1', 'deepseek', 100, 50, 400, 0.05, 'medida', 'estimado')`)
      .run(crypto.randomUUID(), tId);

    const res = await analytics.request("/analytics?days=30&modelo=deepseek/r1");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // 100 input + 50 output + 400 reasoning = 550 tokens
    expect(data.byTask.find((t: any) => t.taskId === tId)?.tokens).toBe(550);
    expect(data.byType.find((t: any) => t.tipo === "tarea")?.tokens).toBe(550);
    expect(data.byModel.find((m: any) => m.model === "deepseek/r1")?.tokens).toBe(550);
  });
});


