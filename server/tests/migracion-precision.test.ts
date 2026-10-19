import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("la migración conserva el uso anterior, respalda e ignora reintentos", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-migracion-"));
  const iniciar = async () => {
    const script = `const {db}=await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/db/index.ts")).href)});db.close();`;
    const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, DATA_DIR: carpeta }, stdout: "pipe", stderr: "pipe" });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
  };
  try {
    await iniciar();
    const anterior = new Database(join(carpeta, "orquestador.db"));
    anterior.exec("DROP INDEX usage_task; ALTER TABLE usage DROP COLUMN tokens_precision; ALTER TABLE usage DROP COLUMN cost_precision; DELETE FROM schema_migrations WHERE name='023_precision_uso';");
    anterior.query("INSERT INTO usage(id,provider,model,input_tokens,output_tokens,cost) VALUES ('antiguo','prueba','prueba',17,4,0.25)").run();
    anterior.close();
    await iniciar();
    const migrada = new Database(join(carpeta, "orquestador.db"));
    expect(migrada.query("SELECT input_tokens,output_tokens,cost,tokens_precision,cost_precision FROM usage WHERE id='antiguo'").get()).toEqual({ input_tokens: 17, output_tokens: 4, cost: 0.25, tokens_precision: "desconocida", cost_precision: "desconocida" });
    // Un servidor anterior puede seguir escribiendo durante una reversión del despliegue.
    migrada.query("INSERT INTO usage(id,provider,model) VALUES ('escritor-anterior','prueba','prueba')").run();
    expect(migrada.query("PRAGMA foreign_key_check").all()).toEqual([]);
    migrada.close();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
    await iniciar();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});

test("la migración recupera tokens aproximados sin inventar costes", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-tokens-historicos-"));
  const iniciar = async () => {
    const script = `const {db}=await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/db/index.ts")).href)});db.close();`;
    const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, DATA_DIR: carpeta }, stdout: "pipe", stderr: "pipe" });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
  };
  try {
    await iniciar();
    const antes = new Database(join(carpeta, "orquestador.db"));
    antes.query("DELETE FROM schema_migrations WHERE name='035_recuperar_tokens_historicos'").run();
    antes.query("INSERT INTO tasks(id,title,prompt,model,status,result,created_at,finished_at) VALUES ('historica','Tarea','un prompt de prueba','opencode/modelo','done','una respuesta suficiente para estimar','2026-10-18','2026-10-18')").run();
    antes.query("INSERT INTO usage(id,provider,model,task_id,input_tokens,output_tokens,cost,tokens_precision,cost_precision) VALUES ('uso-vacio','opencode','opencode/modelo','historica',0,0,0,'no_disponible','no_disponible')").run();
    antes.query("INSERT INTO conversations(id,title,created_at) VALUES ('chat-historico','Chat','2026-10-18')").run();
    antes.query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ('mensaje-usuario','chat-historico','user','pregunta de prueba','2026-10-18 10:00:00')").run();
    antes.query("INSERT INTO messages(id,conversation_id,role,content,created_at,model) VALUES ('mensaje-asistente','chat-historico','assistant','respuesta de prueba','2026-10-18 10:00:01','opencode/modelo')").run();
    antes.close();

    await iniciar();
    const despues = new Database(join(carpeta, "orquestador.db"));
    expect(despues.query("SELECT input_tokens, output_tokens, cost, tokens_precision, cost_precision FROM usage WHERE id='uso-vacio'").get()).toEqual({
      input_tokens: 5, output_tokens: 10, cost: 0, tokens_precision: "estimado", cost_precision: "no_disponible",
    });
    expect(despues.query("SELECT input_tokens, output_tokens, tokens_precision, cost_precision FROM usage WHERE id='hist-chat-mensaje-asistente'").get()).toEqual({
      input_tokens: 5, output_tokens: 5, tokens_precision: "estimado", cost_precision: "no_disponible",
    });
    expect(despues.query("PRAGMA foreign_key_check").all()).toEqual([]);
    despues.close();
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});
