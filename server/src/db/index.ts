import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, "orquestador.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

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
