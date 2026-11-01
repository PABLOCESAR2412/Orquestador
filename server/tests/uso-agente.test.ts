import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RAIZ_PRUEBAS = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(RAIZ_PRUEBAS, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(RAIZ_PRUEBAS, "data");
process.env.TELO_PROYECTOS_DIR = join(RAIZ_PRUEBAS, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });

const { db } = await import("../src/db");
const { registrarUsoAgente, conEstilo, conContratoEjecucion, CONTRATO_EJECUCION } = await import("../src/ejecutar");
const projectId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const projectPath = join(process.env.TELO_PROYECTOS_DIR!, `uso-${projectId}`);
mkdirSync(projectPath, { recursive: true });
db.query("INSERT INTO projects (id, name, repo_path) VALUES (?, 'Uso de prueba', ?)").run(projectId, projectPath);
db.query("INSERT INTO conversations (id, project_id) VALUES (?, ?)").run(conversationId, projectId);
db.query(
  "INSERT INTO tasks (id, title, prompt, model, status, project_id) VALUES (?, 'Uso', 'Prueba', 'google/prueba', 'failed', ?)",
).run(taskId, projectId);

afterAll(() => {
  db.query("DELETE FROM usage WHERE project_id = ?").run(projectId);
  db.query("DELETE FROM tasks WHERE id = ?").run(taskId);
  db.query("DELETE FROM conversations WHERE id = ?").run(conversationId);
  db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  rmSync(projectPath, { recursive: true, force: true });
});

describe("registro inmediato del uso del agente", () => {
  test("atribuye modelos enrutados a su integración y conserva coste cero reportado", () => {
    for (const modelo of ["openrouter/google/gemini-prueba:free", "openrouter/nvidia/nemotron-prueba:free", "google/gemini-prueba-gratis", "opencode/gemini-prueba", "opencode/argon"]) {
      registrarUsoAgente(modelo, { input: 1_000_000, output: 100_000, reasoning: 0, cacheRead: 0, cost: 0, tokensMedidos: true, costeDisponible: true }, { projectId, conversationId });
      const uso = db.query<any, [string, string]>("SELECT provider,cost,cost_precision FROM usage WHERE model=? AND project_id=? ORDER BY rowid DESC LIMIT 1").get(modelo, projectId);
      expect(uso).toEqual({ provider: modelo.split("/")[0], cost: 0, cost_precision: "estimado" });
    }
  });
  test("las respuestas de chat incluyen una guía visual breve para los entregables", () => {
    expect(conEstilo("Crea un gráfico con estos datos", "chat")).toContain("Calidad visual por defecto");
    expect(conEstilo("Investiga y corrige estos defectos", "chat")).toContain("no las encadenes en un párrafo largo");
    expect(conEstilo("Crea un video", "chat")).toContain("no lo presentes como terminado hasta comprobar que el MP4 existe");
  });

  test("el contrato común respeta el formato del llamador y exige evidencia comprobable", () => {
    const prompt = conContratoEjecucion('{ "estado": "completado" }');
    expect(prompt).toContain("cualquier modelo y proveedor");
    expect(prompt).toContain("JSON para análisis/reportes");
    expect(prompt).toContain("conversación natural para chats");
    expect(prompt).toContain("nunca inventes resultados");
    expect(prompt).toContain("enlaces directos en Markdown");
    expect(prompt).toContain("libros, videos, informes, datasets");
    expect(prompt).toContain("nunca inventes enlaces ni fuentes");
    expect(prompt).toContain("no reveles razonamiento interno privado");
    expect(prompt).toContain("Redacta en español la actividad visible y los avisos de progreso");
    expect(prompt).toEndWith('{ "estado": "completado" }');
    expect(CONTRATO_EJECUCION.length).toBeLessThan(2_000);
  });

  test("guarda cada paso y el intento de respaldo con su modelo", () => {
    const contexto = { projectId, conversationId, taskId };
    registrarUsoAgente(
      "google/prueba",
      { input: 120, output: 30, reasoning: 8, cacheRead: 40, cost: 0 },
      contexto,
    );
    registrarUsoAgente(
      "google/prueba",
      { input: 10, output: 2, reasoning: 1, cacheRead: 3, cost: 0.01 },
      contexto,
    );
    registrarUsoAgente(
      "respaldo/prueba",
      { input: 20, output: 5, reasoning: 2, cacheRead: 0, cost: 0.02 },
      contexto,
    );
    const filas = db
      .query<any, [string]>("SELECT * FROM usage WHERE task_id = ? ORDER BY rowid")
      .all(taskId);
    expect(filas).toHaveLength(3);
    expect(filas.map((fila) => fila.model)).toEqual([
      "google/prueba",
      "google/prueba",
      "respaldo/prueba",
    ]);
    expect(filas[0]).toMatchObject({
      provider: "google",
      input_tokens: 120,
      output_tokens: 30,
      reasoning_tokens: 8,
      cache_read_tokens: 40,
      cost: 0,
      project_id: projectId,
      conversation_id: conversationId,
      task_id: taskId,
    });
    expect(filas.reduce((total, fila) => total + fila.cost, 0)).toBeCloseTo(0.03);
    expect(filas.reduce((total, fila) => total + fila.input_tokens, 0)).toBe(150);
  });

  test("el uso del chat admite contexto sin tarea", () => {
    registrarUsoAgente(
      "google/chat",
      { input: 1, output: 2, reasoning: 0, cacheRead: 0, cost: 0 },
      { conversationId, projectId },
    );
    const fila = db
      .query<
        any,
        [string]
      >("SELECT task_id, conversation_id FROM usage WHERE model = 'google/chat' AND project_id = ?")
      .get(projectId);
    expect(fila).toEqual({ task_id: null, conversation_id: conversationId });
  });

  test("guarda el conteo de respaldo como estimado y deja el coste sin confirmar", () => {
    registrarUsoAgente(
      "google/gemini-4-argon",
      { input: 40, output: 10, reasoning: 0, cacheRead: 0, cost: 0, tokensMedidos: false, tokensEstimados: true, costeDisponible: false },
      { conversationId, projectId },
    );
    const fila = db.query<any, [string]>(
      "SELECT input_tokens, output_tokens, cost, tokens_precision, cost_precision FROM usage WHERE model='google/gemini-4-argon' AND project_id=? ORDER BY rowid DESC LIMIT 1",
    ).get(projectId);
    expect(fila).toEqual({ input_tokens: 40, output_tokens: 10, cost: 0, tokens_precision: "estimado", cost_precision: "no_disponible" });
  });
});
