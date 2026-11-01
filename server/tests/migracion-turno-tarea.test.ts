import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("la asociación de turno migra sin inventar vínculos y admite escritores anteriores", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-migracion-turno-"));
  const bases: Database[] = [];
  const iniciar = async () => {
    const script = `const {db}=await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/db/index.ts")).href)});db.close();`;
    const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, DATA_DIR: carpeta }, stdout: "pipe", stderr: "pipe" });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
  };
  try {
    await iniciar();
    const anterior = new Database(join(carpeta, "orquestador.db"));
    bases.push(anterior);
    anterior.exec("ALTER TABLE tasks DROP COLUMN message_id; DELETE FROM schema_migrations WHERE name='049_task_message';");
    anterior.exec(`
      INSERT INTO conversations(id,title) VALUES ('chat','Chat');
      INSERT INTO messages(id,conversation_id,role,content) VALUES ('a','chat','user','A'),('b','chat','user','B');
      INSERT INTO tasks(id,title,prompt,model,status,conversation_id,provider_session_id) VALUES ('legacy','A','A','prueba','queued','chat','sesion-conservada');
      INSERT INTO task_events(task_id,kind,detail) VALUES ('legacy','creada','conservar');
    `);
    expect(anterior.query("SELECT id FROM tasks WHERE id='legacy'").get()).toEqual({ id: "legacy" });
    anterior.close();
    await iniciar();
    const migrada = new Database(join(carpeta, "orquestador.db"));
    bases.push(migrada);
    migrada.exec("PRAGMA foreign_keys=ON;");
    expect(migrada.query("SELECT message_id,provider_session_id FROM tasks WHERE id='legacy'").get())
      .toEqual({ message_id: null, provider_session_id: "sesion-conservada" });
    expect(migrada.query("SELECT detail FROM task_events WHERE task_id='legacy'").get()).toEqual({ detail: "conservar" });
    expect(migrada.query("SELECT id FROM messages ORDER BY rowid").all()).toEqual([{ id: "a" }, { id: "b" }]);
    migrada.exec("INSERT INTO tasks(id,title,prompt,model,status) VALUES ('escritor-anterior','Sin chat','p','prueba','queued');");
    expect(migrada.query("SELECT message_id FROM tasks WHERE id='escritor-anterior'").get()).toEqual({ message_id: null });
    migrada.exec("UPDATE tasks SET message_id='a' WHERE id='legacy'; DELETE FROM messages WHERE id='a';");
    expect(migrada.query("SELECT message_id FROM tasks WHERE id='legacy'").get()).toEqual({ message_id: null });
    expect(migrada.query("PRAGMA foreign_key_check").all()).toEqual([]);
    migrada.close();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
    await iniciar();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
  } finally {
    for (const base of bases) { try { base.close(); } catch { /* Ya cerrada. */ } }
    rmSync(carpeta, { recursive: true, force: true });
  }
});
