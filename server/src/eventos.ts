import { db } from "./db";
import { publicar } from "./bus";
import { redactar } from "./redaccion";

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
  | "terminada"
  | "modelo_respaldo"
  | "clon_creado"
  | "commit_aprobado"
  | "push_aprobado"
  | "push_fallido";

export type EventoTarea = {
  id: number;
  task_id: string;
  kind: TipoEvento;
  detail: string | null;
  created_at: string;
};

const DETALLE_MAX = 800;

// Guarda el evento y lo publica en el canal en vivo.
export function registrarEvento(taskId: string, tipo: TipoEvento, detalle?: string | null) {
  // Un detalle puede traer texto del agente o de Git: se redacta antes de guardarlo o publicarlo.
  const detail = detalle ? redactar(detalle).slice(0, DETALLE_MAX) : null;
  const { lastInsertRowid } = db
    .query("INSERT INTO task_events (task_id, kind, detail) VALUES (?, ?, ?)")
    .run(taskId, tipo, detail);
  const fila = db
    .query<{ created_at: string }, [number | bigint]>("SELECT created_at FROM task_events WHERE id = ?")
    .get(lastInsertRowid);
  publicar({
    tipo: "evento",
    task_id: taskId,
    kind: tipo,
    detail,
    created_at: fila?.created_at ?? new Date().toISOString(),
  });
}

// Publica el estado actual de una tarea. Llamarlo después de cada cambio de status.
export function publicarEstado(taskId: string) {
  const fila = db
    .query<{ id: string; status: string; finished_at: string | null }, [string]>(
      "SELECT id, status, finished_at FROM tasks WHERE id = ?",
    )
    .get(taskId);
  if (fila) publicar({ tipo: "tarea", id: fila.id, status: fila.status, finished_at: fila.finished_at });
}

export function listarEventos(taskId: string): EventoTarea[] {
  return db
    .query<EventoTarea, [string]>(
      "SELECT id, task_id, kind, detail, created_at FROM task_events WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);
}
