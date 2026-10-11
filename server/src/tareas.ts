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
    db.query(
      "INSERT INTO tasks (id, title, prompt, model, effort, status, project_id, retry_of) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
    ).run(id, titulo, prompt, opts.model, opts.effort, opts.projectId, retryOf);
    registrarEvento(id, "creada", detalle);
    if (retryOf) registrarEvento(retryOf, "reintento_creado", `Nueva tarea ${id.slice(0, 8)}`);
  })();

  publicarEstado(id);
  notifyWorker();
  return id;
}
