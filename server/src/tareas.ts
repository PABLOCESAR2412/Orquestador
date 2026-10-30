import { db } from "./db";
import { publicarEstado, registrarEvento } from "./eventos";
import { notifyWorker } from "./worker";

// Única forma de crear una tarea: la usan POST /api/tasks, los reintentos y el planificador.

export type NuevaTarea = {
  prompt: string;
  model: string;
  effort: string | null;
  projectId: string | null;
  titulo?: string;
  origen?: string;
  // Tarea original cuando esta es un reintento.
  retryOf?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  providerSessionId?: string | null;
  providerSessionModel?: string | null;
  sourceBranch?: string | null;
  sourceBaseBranch?: string | null;
  sourcePrNumber?: number | null;
};

// Crea la tarea en cola, la publica y despierta al worker. Devuelve su id.
export function crearTarea(opts: NuevaTarea): string {
  const id = crypto.randomUUID();
  const prompt = opts.prompt.trim();
  const titulo = (opts.titulo?.trim() || prompt).slice(0, 60);
  const retryOf = opts.retryOf ?? null;

  const detalle = retryOf
    ? `Reintento de ${retryOf.slice(0, 8)}`
    : opts.origen === "programada"
      ? `Programada: ${titulo}`
      : `Modelo ${opts.model}`;

  db.transaction(() => {
    const messageId = opts.conversationId && opts.messageId
      ? db.query<{ id: string }, [string, string]>("SELECT id FROM messages WHERE id=? AND conversation_id=? AND role='user'")
        .get(opts.messageId, opts.conversationId)?.id ?? null
      : null;
    db.query(
      "INSERT INTO tasks (id, title, prompt, model, effort, status, project_id, retry_of, conversation_id, message_id, provider_session_id, provider_session_model, source_branch, source_base_branch, source_pr_number) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      titulo,
      prompt,
      opts.model,
      opts.effort,
      opts.projectId,
      retryOf,
      opts.conversationId ?? null,
      messageId,
      opts.providerSessionId ?? null,
      opts.providerSessionModel ?? null,
      opts.sourceBranch ?? null,
      opts.sourceBaseBranch ?? null,
      opts.sourcePrNumber ?? null,
    );
    registrarEvento(id, "creada", detalle);
    if (retryOf) registrarEvento(retryOf, "reintento_creado", `Nueva tarea ${id.slice(0, 8)}`);
  })();

  publicarEstado(id);
  notifyWorker();
  return id;
}
