import { db } from "./db";

// Historial de cada tarea: qué pasó, cuándo y con qué detalle. Sirve para depurar,
// para auditar y como base de las notificaciones (fase 8).

export type TipoEvento =
  | "creada"
  | "iniciada"
  | "sesion_asignada"
  | "cancelacion_pedida"
  | "interrumpida"
  | "reanudada"
  | "reintento_creado"
  | "terminada";

export type EventoTarea = {
  id: number;
  task_id: string;
  kind: TipoEvento;
  detail: string | null;
  created_at: string;
};

const DETALLE_MAX = 800;

export function registrarEvento(taskId: string, tipo: TipoEvento, detalle?: string | null) {
  db.query("INSERT INTO task_events (task_id, kind, detail) VALUES (?, ?, ?)").run(
    taskId,
    tipo,
    detalle ? detalle.slice(0, DETALLE_MAX) : null,
  );
}

export function listarEventos(taskId: string): EventoTarea[] {
  return db
    .query<EventoTarea, [string]>(
      "SELECT id, task_id, kind, detail, created_at FROM task_events WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);
}
