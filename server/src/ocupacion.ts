import { db } from "./db";

// Quién escribe en la carpeta de cada proyecto. Un chat de un proyecto con Git trabaja directamente
// en esa carpeta, y el agente puede modificar su .git. Por eso, mientras el servidor lee Git de un
// proyecto no arranca ningún chat en él, y mientras hay un chat (o una tarea) en curso no se lee Git.

const conversacionesEnCurso = new Set<string>();
const proyectosRevisados = new Set<string>();

export function ocuparConversacion(id: string): void {
  conversacionesEnCurso.add(id);
}

export function liberarConversacion(id: string): void {
  conversacionesEnCurso.delete(id);
}

export function conversacionEnCurso(id: string): boolean {
  return conversacionesEnCurso.has(id);
}

// El servidor está leyendo Git de este proyecto ahora mismo: no debe arrancar un chat en él.
export function proyectoRevisandose(projectId: string): boolean {
  return proyectosRevisados.has(projectId);
}

// Hay un chat o una tarea en curso que trabaja en la carpeta del proyecto.
export function proyectoOcupado(projectId: string): boolean {
  if (proyectosRevisados.has(projectId)) return true;
  const chats = db
    .query<{ id: string }, [string]>("SELECT id FROM conversations WHERE project_id = ?")
    .all(projectId);
  if (chats.some((c) => conversacionesEnCurso.has(c.id))) return true;
  return db.query("SELECT 1 FROM tasks WHERE project_id = ? AND status = 'running' LIMIT 1").get(projectId) !== null;
}

// Ejecuta `fn` sobre la carpeta del proyecto si nadie más la usa. Devuelve null si está ocupada.
export async function conProyectoRevisado<T>(projectId: string, fn: () => Promise<T>): Promise<T | null> {
  if (proyectoOcupado(projectId)) return null;
  proyectosRevisados.add(projectId);
  try {
    return await fn();
  } finally {
    proyectosRevisados.delete(projectId);
  }
}
