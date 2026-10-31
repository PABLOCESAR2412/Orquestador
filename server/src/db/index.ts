import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config";

function abrirBase(dir: string): Database {
  // `bun test` fija NODE_ENV="test": el guard queda activo aunque el preload de
  // bunfig no cargara por correr desde otro directorio.
  if (process.env.TELO_PRUEBAS_BASE_AISLADA === "1" || process.env.NODE_ENV === "test") {
    const destino = resolve(dir);
    const temporales = resolve(tmpdir()) + sep;
    if (!destino.startsWith(temporales)) throw new Error("Las pruebas solo pueden abrir bases dentro del directorio temporal.");
  }
  mkdirSync(dir, { recursive: true });
  const base = new Database(join(dir, "orquestador.db"), { create: true });
  base.exec("PRAGMA journal_mode = WAL;");
  base.exec("PRAGMA foreign_keys = ON;");
  // Si otra escritura tiene el archivo bloqueado, espera hasta 5 s antes de fallar.
  base.exec("PRAGMA busy_timeout = 5000;");
  return base;
}


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
  {
    name: "024_quitar_oauth_google",
    sql: `
      DROP TABLE IF EXISTS oauth_conexiones;
      DROP TABLE IF EXISTS oauth_estados;
    `,
  },
  {
    name: "025_uso_jev_interno",
    sql: `
      CREATE TABLE uso_jev (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('recomendaciones_chat', 'memoria_proyecto', 'clasificacion_tarea', 'prueba_conexion')),
        proyecto_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        conversacion_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        tarea_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        modelo TEXT NOT NULL,
        tokens_entrada INTEGER NOT NULL DEFAULT 0,
        tokens_salida INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX uso_jev_fecha ON uso_jev(created_at);
      CREATE INDEX uso_jev_proyecto ON uso_jev(proyecto_id, created_at);
    `,
  },
  {
    name: "026_metodo_autenticacion_push",
    sql: `
      ALTER TABLE task_approvals ADD COLUMN autenticacion TEXT;
    `,
  },
  {
    name: "027_sesiones_y_propuestas_memoria",
    sql: `
      ALTER TABLE projects ADD COLUMN memoria_propuesta TEXT;
      ALTER TABLE projects ADD COLUMN memoria_propuesta_en TEXT;
      ALTER TABLE projects ADD COLUMN memoria_propuesta_tarea_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX auth_sessions_token_hash ON auth_sessions(token_hash);
    `,
  },
  {
    name: "028_indices_rendimiento_y_sesiones",
    sql: `
      CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS tasks_project_created ON tasks (project_id, created_at);
      CREATE INDEX IF NOT EXISTS conversations_project_created ON conversations (project_id, created_at);
      CREATE INDEX IF NOT EXISTS usage_project ON usage (project_id, created_at);
      CREATE INDEX IF NOT EXISTS usage_conversation ON usage (conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS auth_sessions_last_seen ON auth_sessions (last_seen_at);
    `,
  },
  {
    name: "029_proveedor_google_y_coste_gemini",
    sql: `
      UPDATE usage SET model = REPLACE(model, 'opencode/gemini-', 'google/gemini-') WHERE model LIKE 'opencode/gemini-%';
      UPDATE tasks SET model = REPLACE(model, 'opencode/gemini-', 'google/gemini-') WHERE model LIKE 'opencode/gemini-%';
      UPDATE usage SET provider = 'google' WHERE (model LIKE '%gemini%' OR model LIKE 'google/%') AND provider != 'google';
      UPDATE usage SET
        cost = ROUND((input_tokens * 0.000000075 + output_tokens * 0.0000003), 4),
        cost_precision = 'estimado'
      WHERE provider = 'google' AND cost = 0 AND (input_tokens > 0 OR output_tokens > 0);
    `,
  },
  {
    name: "030_integridad_referencial_tareas",
    sql: `
      UPDATE usage SET task_id = NULL WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM tasks);
      UPDATE programadas SET ultima_tarea_id = NULL WHERE ultima_tarea_id IS NOT NULL AND ultima_tarea_id NOT IN (SELECT id FROM tasks);
      UPDATE tasks SET retry_of = NULL WHERE retry_of IS NOT NULL AND retry_of NOT IN (SELECT id FROM tasks);

      CREATE INDEX IF NOT EXISTS programadas_ultima_tarea ON programadas(ultima_tarea_id);
      CREATE INDEX IF NOT EXISTS tasks_retry_of ON tasks(retry_of);

      CREATE TRIGGER IF NOT EXISTS trg_tasks_delete_referencias
      AFTER DELETE ON tasks
      FOR EACH ROW
      BEGIN
        UPDATE usage SET task_id = NULL WHERE task_id = OLD.id;
        UPDATE programadas SET ultima_tarea_id = NULL WHERE ultima_tarea_id = OLD.id;
        UPDATE tasks SET retry_of = NULL WHERE retry_of = OLD.id;
      END;
    `,
  },
  {
    name: "031_sesion_de_agente_por_modelo",
    sql: `
      ALTER TABLE conversations ADD COLUMN runner_session_model TEXT;
      ALTER TABLE tasks ADD COLUMN provider_session_model TEXT;
    `,
  },
  {
    name: "032_modelo_y_esfuerzo_por_mensaje",
    sql: `
      ALTER TABLE messages ADD COLUMN model TEXT;
      ALTER TABLE messages ADD COLUMN effort TEXT;
    `,
  },
  {
    // Las herramientas que siguen corriendo actualizan el paso que se publicó al iniciarse.
    name: "033_actividad_chat_en_curso",
    sql: `
      DROP INDEX chat_actividad_turno_seq;
      ALTER TABLE chat_actividad RENAME TO chat_actividad_anterior;
      CREATE TABLE chat_actividad (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turno_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'accion')),
        herramienta TEXT,
        call_id TEXT,
        titulo TEXT NOT NULL,
        detalle TEXT,
        estado TEXT NOT NULL CHECK (estado IN ('hecha', 'error', 'texto', 'en_curso')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_actividad (id, conversation_id, turno_id, seq, tipo, herramienta, titulo, detalle, estado, created_at)
        SELECT id, conversation_id, turno_id, seq, tipo, herramienta, titulo, detalle, estado, created_at FROM chat_actividad_anterior;
      DROP TABLE chat_actividad_anterior;
      CREATE UNIQUE INDEX chat_actividad_turno_seq ON chat_actividad(conversation_id, turno_id, seq);
      CREATE INDEX chat_actividad_call ON chat_actividad(conversation_id, turno_id, call_id);
    `,
  },
  {
    // Trabajos de imagen y video: el archivo final se conserva en la base junto con el chat.
    name: "034_generacion_medios",
    sql: `
      CREATE TABLE media_jobs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turno_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('imagen', 'video')),
        prompt TEXT NOT NULL,
        modelo TEXT NOT NULL,
        resolucion TEXT NOT NULL,
        relacion TEXT NOT NULL,
        duracion_segundos INTEGER,
        costo_estimado_usd REAL NOT NULL,
        estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'generando', 'completada', 'error', 'cancelada')),
        operacion TEXT,
        nombre_archivo TEXT,
        mime TEXT,
        bytes INTEGER,
        contenido BLOB,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX media_jobs_conversation ON media_jobs(conversation_id, created_at);
      CREATE INDEX media_jobs_estado ON media_jobs(estado, created_at);
    `,
  },
  {
    // Recupera métricas aproximadas de turnos históricos cuando nunca se guardaron tokens.
    // Se identifican explícitamente como estimados y el coste permanece no disponible.
    name: "035_recuperar_tokens_historicos",
    sql: `
      UPDATE usage AS u
         SET input_tokens = MAX(1, (LENGTH(t.prompt) + 3) / 4),
             output_tokens = MAX(0, (LENGTH(COALESCE(t.result, '')) + 3) / 4),
             tokens_precision = 'estimado'
        FROM tasks t
       WHERE u.task_id = t.id
         AND t.status = 'done'
         AND u.input_tokens = 0 AND u.output_tokens = 0
         AND u.tokens_precision IN ('no_disponible', 'desconocida')
         AND (SELECT COUNT(*) FROM usage u2 WHERE u2.task_id = t.id) = 1;

      INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, cost,
                         project_id, task_id, tokens_precision, cost_precision, created_at)
      SELECT 'hist-task-' || t.id, t.conversation_id,
             CASE WHEN t.model LIKE 'opencode/gemini-%' THEN 'google'
                  WHEN INSTR(t.model, '/') > 0 THEN SUBSTR(t.model, 1, INSTR(t.model, '/') - 1)
                  ELSE 'unknown' END,
             t.model,
             MAX(1, (LENGTH(t.prompt) + 3) / 4),
             MAX(0, (LENGTH(COALESCE(t.result, '')) + 3) / 4), 0,
             t.project_id, t.id, 'estimado', 'no_disponible', COALESCE(t.finished_at, t.created_at)
        FROM tasks t
       WHERE t.status = 'done'
         AND NOT EXISTS (SELECT 1 FROM usage u WHERE u.task_id = t.id);

      INSERT INTO usage (id, conversation_id, provider, model, input_tokens, output_tokens, cost,
                         project_id, tokens_precision, cost_precision, created_at)
      SELECT 'hist-chat-' || assistant.id, c.id,
             CASE WHEN assistant.model LIKE 'opencode/gemini-%' THEN 'google'
                  WHEN INSTR(assistant.model, '/') > 0 THEN SUBSTR(assistant.model, 1, INSTR(assistant.model, '/') - 1)
                  ELSE 'unknown' END,
             assistant.model,
             MAX(1, (LENGTH(user.content) + 3) / 4),
             MAX(0, (LENGTH(assistant.content) + 3) / 4), 0,
             c.project_id, 'estimado', 'no_disponible', assistant.created_at
        FROM messages assistant
        JOIN conversations c ON c.id = assistant.conversation_id
        JOIN messages user ON user.rowid = (
          SELECT MAX(u.rowid) FROM messages u
           WHERE u.conversation_id = assistant.conversation_id
             AND u.role = 'user' AND u.rowid < assistant.rowid
        )
       WHERE assistant.role = 'assistant' AND assistant.model IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM usage u
            WHERE u.conversation_id = c.id
              AND u.created_at >= user.created_at AND u.created_at <= assistant.created_at
         )
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.conversation_id = c.id
              AND t.created_at >= user.created_at AND t.created_at <= assistant.created_at
         );
    `,
  },
  {
    // Permite que una tarea de resolución de conflictos continúe sobre la rama fuente de un PR.
    name: "036_rama_fuente_tarea",
    sql: `
      ALTER TABLE tasks ADD COLUMN source_branch TEXT;
      ALTER TABLE tasks ADD COLUMN source_base_branch TEXT;
      ALTER TABLE tasks ADD COLUMN source_pr_number INTEGER;
    `,
  },
  {
    // Conserva subagentes como conversaciones hijas del chat que los lanzó.
    name: "037_subchats_subagentes",
    sql: `
      ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE;
      ALTER TABLE conversations ADD COLUMN parent_turn_id TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_turn_id TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_session_id TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_agent TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_prompt TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_status TEXT CHECK (subagent_status IS NULL OR subagent_status IN ('running','done','failed','cancelled','interrupted'));
      ALTER TABLE conversations ADD COLUMN subagent_result TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_workspace TEXT;
      ALTER TABLE conversations ADD COLUMN subagent_config_dir TEXT;
      CREATE UNIQUE INDEX conversations_subagent_session ON conversations(subagent_session_id) WHERE subagent_session_id IS NOT NULL;
      CREATE INDEX conversations_subagent_parent ON conversations(parent_conversation_id, parent_turn_id, created_at);
    `,
  },
  {
    // Conexiones MCP remotas configuradas por el usuario. La credencial se cifra con la clave maestra.
    name: "038_conexiones_mcp",
    sql: `
      CREATE TABLE mcp_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        token_iv TEXT,
        token_tag TEXT,
        token_enc TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK ((token_iv IS NULL AND token_tag IS NULL AND token_enc IS NULL) OR
               (token_iv IS NOT NULL AND token_tag IS NOT NULL AND token_enc IS NOT NULL))
      );
      CREATE INDEX mcp_connections_enabled ON mcp_connections(enabled, name);
    `,
  },
  {
    // Las consultas de repository_actions van por tarea, conversación y estado; sin índices
    // eran recorridos completos que crecían con la historia.
    name: "039_indices_repository_actions",
    sql: `
      CREATE INDEX repository_actions_tarea ON repository_actions(task_id, action, state);
      CREATE INDEX repository_actions_conversacion ON repository_actions(conversation_id, created_at);
      CREATE INDEX repository_actions_proyecto ON repository_actions(project_id, state, created_at);
    `,
  },
  {
    // Notificaciones Web Push (fase 8): una suscripción por dispositivo y el sello de
    // avisos ya enviados, para que un mismo evento de una tarea notifique una sola vez
    // aunque se reabra o reintente.
    name: "040_push",
    sql: `
      CREATE TABLE push_subscripciones (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        creado TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE push_enviados (
        tarea_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        creado TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tarea_id, tipo)
      );
    `,
  },
  {
    // La compactación automática del contexto deja marca en la respuesta del turno que la
    // provocó, para que el hilo la muestre como parte del tema activo (chat suelto, chat de
    // proyecto y continuaciones usan el mismo registro de mensajes).
    name: "041_mensajes_compactados",
    sql: `
      ALTER TABLE messages ADD COLUMN sesion_compactada INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "042_push_entregas",
    sql: `
      CREATE TABLE push_entregas (
        tarea_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        endpoint TEXT NOT NULL REFERENCES push_subscripciones(endpoint) ON DELETE CASCADE,
        carga TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviando','entregada','descartada')),
        intentos INTEGER NOT NULL DEFAULT 0,
        siguiente_ms INTEGER NOT NULL DEFAULT 0,
        bloqueo_hasta_ms INTEGER NOT NULL DEFAULT 0,
        creado_ms INTEGER NOT NULL,
        PRIMARY KEY (tarea_id,tipo,endpoint)
      );
      CREATE INDEX push_entregas_pendientes ON push_entregas(estado,siguiente_ms,bloqueo_hasta_ms);
    `,
  },
  {
    // Tarea 12: los mensajes enviados mientras el chat responde quedan en cola dentro de la
    // conversación y arrancan en orden de llegada cuando el turno libera. Al reiniciar el
    // servidor la marca se limpia: los pendientes no se ejecutan solos, se avisa como hoy.
    name: "043_cola_mensajes",
    sql: `
      ALTER TABLE messages ADD COLUMN en_cola INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // OAuth de Google Drive: los estados PKCE caducan y el refresh token se cifra con la clave
    // maestra; no se guarda el token de acceso.
    name: "044_google_drive_oauth",
    sql: `
      CREATE TABLE google_drive_oauth_states (
        state_hash TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        expira_ms INTEGER NOT NULL,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX google_drive_oauth_states_expira ON google_drive_oauth_states(expira_ms);
      CREATE TABLE google_drive_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        account_email TEXT NOT NULL,
        account_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        value_enc TEXT NOT NULL,
        actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Índice de archivos cifrados en Drive y trabajos de archivo/restauración recuperables.
    name: "045_google_drive_archives",
    sql: `
      CREATE TABLE google_drive_archives (
        task_id TEXT PRIMARY KEY,
        task_title TEXT NOT NULL,
        drive_file_id TEXT NOT NULL,
        archive_name TEXT NOT NULL,
        encrypted_bytes INTEGER NOT NULL,
        source_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        profile_included INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT NOT NULL DEFAULT (datetime('now')),
        local_removed_at TEXT
      );
      CREATE TABLE google_drive_archive_jobs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('archive', 'restore')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed')),
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX google_drive_archive_jobs_estado ON google_drive_archive_jobs(state, created_at);
      CREATE INDEX google_drive_archive_jobs_tarea ON google_drive_archive_jobs(task_id, created_at);
    `,
  },
  {
    // Huella estable del contenido local y recuperación de reemplazos/limpiezas interrumpidos.
    name: "046_google_drive_archive_integrity",
    sql: `
      ALTER TABLE google_drive_archives ADD COLUMN source_sha256 TEXT;
      ALTER TABLE google_drive_archives ADD COLUMN previous_drive_file_id TEXT;
      ALTER TABLE google_drive_archives ADD COLUMN cleanup_started_at TEXT;
    `,
  },
  {
    // Selección persistente del coordinador (model) y sus modelos auxiliares por conversación.
    name: "047_chat_orchestration",
    sql: `
      ALTER TABLE conversations ADD COLUMN orquestacion_habilitada INTEGER NOT NULL DEFAULT 0 CHECK (orquestacion_habilitada IN (0,1));
      ALTER TABLE conversations ADD COLUMN orquestacion_trabajadores TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    // Permite que el coordinador elija qué auxiliares usar en cada petición.
    name: "048_chat_orchestration_auto_selection",
    sql: `
      ALTER TABLE conversations ADD COLUMN orquestacion_seleccion_automatica INTEGER NOT NULL DEFAULT 0 CHECK (orquestacion_seleccion_automatica IN (0,1));
    `,
  },
  {
    // Las tareas anteriores quedan sin asociación: el último mensaje puede ser otro turno en cola.
    name: "049_task_message",
    sql: `ALTER TABLE tasks ADD COLUMN message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;`,
  },
  {
    name: "052_jev_oficina",
    sql: `CREATE TABLE uso_jev_oficina (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      estado TEXT NOT NULL DEFAULT 'iniciada',
      tokens_entrada INTEGER, tokens_salida INTEGER,
      modelo TEXT
    );`,
  },
];

function copiarAntesDeMigrar(base: Database, dir: string, primera: string) {
  const carpeta = join(dir, "respaldos-migracion");
  mkdirSync(carpeta, { recursive: true });
  const sello = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const destino = join(carpeta, `antes-${primera}-${sello}.db`);
  base.query("VACUUM INTO ?").run(destino);
  console.log(`Copia previa a las migraciones: ${destino}`);
}

// Tablas cuyas claves foráneas se revisan tras una migración sinClaves.
const TABLAS_CON_CLAVES = [
  "tasks",
  "task_events",
  "task_approvals",
  "task_plans",
  "project_git",
  "repository_actions",
];

function aplicarMigracion(base: Database, m: Migration) {
  const registrar = () => base.query("INSERT INTO schema_migrations (name) VALUES (?)").run(m.name);
  if (!m.sinClaves) {
    base.transaction(() => {
      base.exec(m.sql);
      registrar();
    })();
    return;
  }
  // PRAGMA foreign_keys no cambia dentro de una transacción, por eso se apaga fuera.
  base.exec("PRAGMA foreign_keys = OFF;");
  try {
    base.transaction(() => {
      base.exec(m.sql);
      for (const tabla of TABLAS_CON_CLAVES) {
        if (!base.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabla)) continue;
        const rotas = base.query(`PRAGMA foreign_key_check(${tabla})`).all();
        if (rotas.length > 0) throw new Error(`La migración ${m.name} dejó claves foráneas rotas en ${tabla}`);
      }
      registrar();
    })();
  } finally {
    base.exec("PRAGMA foreign_keys = ON;");
  }
}

function prepararBase(dir: string): Database {
  const base = abrirBase(dir);
  base.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
  const applied = new Set(
    base.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name),
  );
  // Antes de cambiar una base que ya tiene datos, guarda una copia consistente (VACUUM INTO)
  // en DATA_DIR/respaldos-migracion. Una base nueva no necesita copia.
  const pendientes = migrations.filter((m) => !applied.has(m.name));
  if (pendientes.length > 0 && applied.size > 0) copiarAntesDeMigrar(base, dir, pendientes[0].name);
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    aplicarMigracion(base, m);
    console.log(`Migración aplicada: ${m.name}`);
  }
  return base;
}

let dataDirVigente = "";
let baseAbierta: Database | null = null;

// En pruebas cada archivo fija su DATA_DIR y cierra la base al terminar; como este módulo
// es único por proceso, el primer DATA_DIR lo capturaba todo y un `db.close()` rompía a
// los archivos que corrían después. Con este envoltorio la base se abre (y aplica sus
// migraciones) ligada al DATA_DIR vigente y se reabre si algún archivo la cerró.
function baseActual(): Database {
  const dir = process.env.DATA_DIR?.trim() || config.dataDir;
  if (baseAbierta && dir !== dataDirVigente) {
    try {
      baseAbierta.close();
    } catch {
      // ya estaba cerrada
    }
    baseAbierta = null;
  }
  if (!baseAbierta) {
    baseAbierta = prepararBase(dir);
    dataDirVigente = dir;
  }
  return baseAbierta;
}

export const db = new Proxy({} as Database, {
  get(_destino, propiedad) {
    const base = baseActual();
    const destino = base as unknown as object;
    // Un cierre por el proxy deja la base en null: el siguiente acceso la reabre.
    if (propiedad === "close") {
      return (...argumentos: unknown[]) => {
        const resultado = (Reflect.get(destino, "close") as (...los: unknown[]) => unknown).bind(base)(...argumentos);
        baseAbierta = null;
        return resultado;
      };
    }
    const valor = Reflect.get(destino, propiedad);
    return typeof valor === "function" ? (valor as (...argumentos: unknown[]) => unknown).bind(base) : valor;
  },
});
