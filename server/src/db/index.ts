import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, "orquestador.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
// Si otra escritura tiene el archivo bloqueado, espera hasta 5 s antes de fallar.
db.exec("PRAGMA busy_timeout = 5000;");

type Migration = { name: string; sql: string };

const migrations: Migration[] = [
  {
    name: "001_base",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT 'Nuevo chat',
        provider TEXT,
        model TEXT,
        effort TEXT,
        runner_session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: "002_usage",
    sql: `
      CREATE TABLE usage (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: "003_tasks",
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
        result TEXT,
        error TEXT,
        workspace TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX tasks_status_created ON tasks (status, created_at);
    `,
  },
  {
    name: "004_settings",
    sql: `
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: "005_tareas_proyecto",
    sql: `
      ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
    `,
  },
  {
    // SQLite no cambia un CHECK con ALTER, así que la tabla se reconstruye.
    // Nada referencia a tasks, por eso se puede borrar y renombrar sin riesgo.
    name: "006_tareas_interrumpidas",
    sql: `
      CREATE TABLE tasks_nueva (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'interrupted', 'done', 'failed', 'cancelled')),
        result TEXT,
        error TEXT,
        workspace TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
      );
      INSERT INTO tasks_nueva (id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id)
        SELECT id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_nueva RENAME TO tasks;
      CREATE INDEX tasks_status_created ON tasks (status, created_at);
    `,
  },
];

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const applied = new Set(
  db.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name),
);

for (const m of migrations) {
  if (applied.has(m.name)) continue;
  db.transaction(() => {
    db.exec(m.sql);
    db.query("INSERT INTO schema_migrations (name) VALUES (?)").run(m.name);
  })();
  console.log(`Migración aplicada: ${m.name}`);
}
