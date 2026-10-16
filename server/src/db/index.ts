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

// sinClaves: la migración reconstruye una tabla que otras referencian con ON DELETE CASCADE.
// Con claves foráneas activas, SQLite borraría en cascada esas filas al hacer DROP TABLE, así que
// el runner la aplica con PRAGMA foreign_keys = OFF y comprueba la integridad antes de confirmar.
type Migration = { name: string; sql: string; sinClaves?: boolean };

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
  {
    // Anclar: un chat o proyecto anclado tiene fecha; sin fecha, no está anclado.
    name: "007_gestion_chats",
    sql: `
      ALTER TABLE conversations ADD COLUMN pinned_at TEXT;
      ALTER TABLE projects ADD COLUMN pinned_at TEXT;
    `,
  },
  {
    // Cuota o saldo que el usuario anota por cuenta o clave. El saldo restante se
    // recalcula restando el uso registrado desde `updated_at`.
    name: "008_cuotas",
    sql: `
      CREATE TABLE quota_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        remaining_usd REAL NOT NULL,
        limit_usd REAL,
        note TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX quota_accounts_provider ON quota_accounts (provider);
    `,
  },
  {
    // Historial por tarea (para depurar y auditar) y la sesión del agente, para reanudar.
    // retry_of apunta a la tarea original cuando una tarea es un reintento.
    name: "009_eventos_tareas",
    sql: `
      CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX task_events_task ON task_events (task_id, id);
      ALTER TABLE tasks ADD COLUMN provider_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN retry_of TEXT;
    `,
  },
  {
    // Git por tarea: rama de trabajo y commit base del clon. Las aprobaciones de commit y push
    // se guardan como historial (no se sobrescriben). El uso registra proyecto y tarea para
    // poder filtrar analíticas y calcular ventanas de uso.
    name: "010_git_aprobaciones",
    sql: `
      ALTER TABLE tasks ADD COLUMN rama TEXT;
      ALTER TABLE tasks ADD COLUMN base_commit TEXT;
      ALTER TABLE usage ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE usage ADD COLUMN task_id TEXT;
      UPDATE usage SET project_id = (
        SELECT c.project_id FROM conversations c WHERE c.id = usage.conversation_id
      ) WHERE conversation_id IS NOT NULL;
      CREATE INDEX usage_created ON usage (created_at);
      CREATE TABLE task_approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        accion TEXT NOT NULL CHECK (accion IN ('commit', 'push')),
        diff_hash TEXT,
        commit_sha TEXT,
        rama TEXT,
        remoto TEXT,
        detalle TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX task_approvals_task ON task_approvals (task_id, accion, created_at);
    `,
  },
  {
    // Secretos por proyecto, cifrados con AES-256-GCM. Nunca se guarda el valor en claro.
    name: "011_secretos",
    sql: `
      CREATE TABLE project_secrets (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        value_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, name)
      );
    `,
  },
  {
    // Instrucciones por proyecto (texto que recibe cada agente del proyecto) y tareas programadas.
    name: "012_programadas_instrucciones",
    sql: `
      ALTER TABLE projects ADD COLUMN instrucciones TEXT;
      CREATE TABLE programadas (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        frecuencia TEXT NOT NULL CHECK (frecuencia IN ('cada_horas', 'diaria')),
        cada_horas INTEGER,
        hora TEXT,
        activa INTEGER NOT NULL DEFAULT 1,
        proxima_en TEXT NOT NULL,
        ultima_ejecucion TEXT,
        ultima_tarea_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Inicio de sesión con Google: estados de un solo uso (PKCE) y la conexión con el token de
    // actualización cifrado (AES-256-GCM, mismo formato que project_secrets). El token de acceso no se guarda.
    name: "013_oauth_google",
    sql: `
      CREATE TABLE oauth_estados (
        estado TEXT PRIMARY KEY,
        verificador TEXT NOT NULL,
        expira_en TEXT NOT NULL,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE oauth_conexiones (
        proveedor TEXT PRIMARY KEY,
        cuenta_email TEXT NOT NULL,
        cuenta_id TEXT NOT NULL,
        alcance TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        value_enc TEXT NOT NULL,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Memoria del proyecto: lo que los agentes aprenden de sus tareas. Se llena sola y el dueño puede borrarla.
    name: "014_memoria_proyecto",
    sql: `
      ALTER TABLE projects ADD COLUMN memoria TEXT;
      ALTER TABLE projects ADD COLUMN memoria_actualizada_en TEXT;
    `,
  },
  {
    // Clave SSH por proyecto para subir ramas a GitHub (deploy key). La parte privada va cifrada con
    // AES-256-GCM, igual que project_secrets; la pública y su huella se pueden mostrar.
    name: "015_clave_ssh_proyecto",
    sql: `
      CREATE TABLE project_ssh_keys (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        public_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        value_enc TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Documentos guardados desde un mensaje del chat (Word, Excel, HTML, texto o Markdown). El archivo
    // se guarda en la base para que entre en la copia de respaldo. Se borran con su chat.
    name: "016_documentos",
    sql: `
      CREATE TABLE documentos (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        formato TEXT NOT NULL CHECK (formato IN ('docx', 'xlsx', 'html', 'txt', 'md')),
        bytes INTEGER NOT NULL,
        contenido BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX documentos_conversacion ON documentos(conversation_id, created_at);
    `,
  },
  {
    // Proyectos clonados desde GitHub: la URL de origen y la fecha del clonado. Hasta clonar,
    // la carpeta está vacía y la clave SSH del proyecto espera a que se pegue en el repositorio.
    name: "017_clonado_github",
    sql: `
      ALTER TABLE projects ADD COLUMN origen_url TEXT;
      ALTER TABLE projects ADD COLUMN clonado_en TEXT;
    `,
  },
  {
    // Pasos del agente en un chat (texto intermedio y acciones con su vista previa), por turno.
    // turno_id es el id del mensaje del usuario que lo originó. Se borran con su chat.
    name: "018_actividad_chat",
    sql: `
      CREATE TABLE chat_actividad (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turno_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'accion')),
        herramienta TEXT,
        titulo TEXT NOT NULL,
        detalle TEXT,
        estado TEXT NOT NULL CHECK (estado IN ('hecha', 'error', 'texto')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX chat_actividad_turno_seq ON chat_actividad(conversation_id, turno_id, seq);
    `,
  },
  {
    // Analizador y obrero: una tarea pasa por 'analyzing' (el analizador escribe el plan) y
    // 'waiting_approval' (espera la aprobación del usuario) antes de 'running'. El plan, el reporte
    // final y la fecha de aprobación se guardan en la propia tarea.
    // Se reconstruye la tabla: task_events y task_approvals referencian tasks(id) con ON DELETE CASCADE,
    // por eso la migración corre con claves foráneas apagadas (ver sinClaves arriba).
    name: "019_analizador_obrero",
    sinClaves: true,
    sql: `
      CREATE TABLE tasks_nueva (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'analyzing', 'waiting_approval', 'running', 'interrupted', 'done', 'failed', 'cancelled')),
        result TEXT,
        error TEXT,
        workspace TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        provider_session_id TEXT,
        retry_of TEXT,
        rama TEXT,
        base_commit TEXT,
        plan TEXT,
        reporte TEXT,
        plan_aprobado_en TEXT
      );
      INSERT INTO tasks_nueva (id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id, provider_session_id, retry_of, rama, base_commit)
        SELECT id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id, provider_session_id, retry_of, rama, base_commit FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_nueva RENAME TO tasks;
      CREATE INDEX tasks_status_created ON tasks (status, created_at);
    `,
  },
  {
    // Cuota agotada: la tarea se detiene en 'sin_cuota' con el modelo que se quedó sin tokens
    // (modelo_agotado). `continuar` indica que la siguiente ejecución retoma la sesión. El chat guarda
    // el modelo agotado en cuota_modelo hasta que se sigue o se envía un mensaje que sí responde.
    // Reconstruye tasks como 019 (task_events y task_approvals referencian tasks): sinClaves.
    name: "020_cuota_seguir",
    sinClaves: true,
    sql: `
      CREATE TABLE tasks_nueva (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'analyzing', 'waiting_approval', 'running', 'interrupted', 'sin_cuota', 'done', 'failed', 'cancelled')),
        result TEXT,
        error TEXT,
        workspace TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        provider_session_id TEXT,
        retry_of TEXT,
        rama TEXT,
        base_commit TEXT,
        plan TEXT,
        reporte TEXT,
        plan_aprobado_en TEXT,
        modelo_agotado TEXT,
        continuar INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO tasks_nueva (id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id, provider_session_id, retry_of, rama, base_commit, plan, reporte, plan_aprobado_en)
        SELECT id, title, prompt, model, effort, status, result, error, workspace, created_at, started_at, finished_at, project_id, provider_session_id, retry_of, rama, base_commit, plan, reporte, plan_aprobado_en FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_nueva RENAME TO tasks;
      CREATE INDEX tasks_status_created ON tasks (status, created_at);
      ALTER TABLE conversations ADD COLUMN cuota_modelo TEXT;
    `,
  },
  {
    // Claves de proveedor (Groq, NVIDIA, Gemini) guardadas desde Ajustes, cifradas con la clave maestra.
    // Una fila por proveedor; el valor nunca sale por la API.
    name: "021_claves_proveedor",
    sql: `
      CREATE TABLE provider_keys (
        proveedor TEXT PRIMARY KEY,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        value_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Acciones de repositorio, configuración Git por proyecto, planes y vínculo de tareas con chat.
    name: "022_acciones_git_planes",
    sql: `
      ALTER TABLE tasks ADD COLUMN plan_hash TEXT;
      ALTER TABLE tasks ADD COLUMN approved_hash TEXT;
      ALTER TABLE tasks ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;
      ALTER TABLE projects ADD COLUMN compartir_contexto INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE task_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        hash TEXT NOT NULL,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE project_git (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        remote TEXT,
        author_name TEXT NOT NULL DEFAULT 'Telo',
        author_email TEXT NOT NULL DEFAULT 'telo@localhost',
        base_branch TEXT NOT NULL DEFAULT 'main'
      );
      CREATE TABLE repository_actions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX tasks_conversation ON tasks(conversation_id);
    `,
  },
  {
    name: "023_precision_uso",
    sql: `
      ALTER TABLE usage ADD COLUMN tokens_precision TEXT NOT NULL DEFAULT 'desconocida';
      ALTER TABLE usage ADD COLUMN cost_precision TEXT NOT NULL DEFAULT 'desconocida';
      CREATE INDEX usage_task ON usage(task_id);
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

// Antes de cambiar una base que ya tiene datos, guarda una copia consistente (VACUUM INTO)
// en DATA_DIR/respaldos-migracion. Una base nueva no necesita copia.
function copiarAntesDeMigrar(primera: string) {
  const carpeta = join(config.dataDir, "respaldos-migracion");
  mkdirSync(carpeta, { recursive: true });
  const sello = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const destino = join(carpeta, `antes-${primera}-${sello}.db`);
  db.query("VACUUM INTO ?").run(destino);
  console.log(`Copia previa a las migraciones: ${destino}`);
}

const pendientes = migrations.filter((m) => !applied.has(m.name));
if (pendientes.length > 0 && applied.size > 0) copiarAntesDeMigrar(pendientes[0].name);

// Tablas cuyas claves foráneas se revisan tras una migración sinClaves.
const TABLAS_CON_CLAVES = [
  "tasks",
  "task_events",
  "task_approvals",
  "task_plans",
  "project_git",
  "repository_actions",
];

function aplicarMigracion(m: Migration) {
  const registrar = () => db.query("INSERT INTO schema_migrations (name) VALUES (?)").run(m.name);
  if (!m.sinClaves) {
    db.transaction(() => {
      db.exec(m.sql);
      registrar();
    })();
    return;
  }
  // PRAGMA foreign_keys no cambia dentro de una transacción, por eso se apaga fuera.
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.transaction(() => {
      db.exec(m.sql);
      for (const tabla of TABLAS_CON_CLAVES) {
        if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabla)) continue;
        const rotas = db.query(`PRAGMA foreign_key_check(${tabla})`).all();
        if (rotas.length > 0) throw new Error(`La migración ${m.name} dejó claves foráneas rotas en ${tabla}`);
      }
      registrar();
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

for (const m of migrations) {
  if (applied.has(m.name)) continue;
  aplicarMigracion(m);
  console.log(`Migración aplicada: ${m.name}`);
}
