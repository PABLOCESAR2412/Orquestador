import { db } from "./db";
import { crearTarea, type NuevaTarea } from "./tareas";
import { getPreferences } from "./preferences";
import { validateSelection } from "./models";

// Tareas programadas: un prompt que el planificador lanza solo, cada N horas o a una hora fija.
// Las horas se guardan en ISO UTC. "hora" (HH:MM) es la hora local del servidor.

export const LIMITE_PROGRAMADAS = 50;
// Tareas que una sola revisión del planificador puede crear (evita ráfagas al arrancar).
const MAX_CREADAS_POR_REVISION = 3;
const MODELO_POR_DEFECTO = "opencode/big-pickle";
const INTERVALO_PLANIFICADOR_MS = 30_000;
const PROMPT_MAX = 10_000;
const TITULO_MAX = 80;
const HORAS_MAX = 168;
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Frecuencia = "cada_horas" | "diaria";
export type Horario = { frecuencia: Frecuencia; cadaHoras: number | null; hora: string | null };

export type NuevaProgramada = {
  titulo: string;
  prompt: string;
  model: string;
  effort: string | null;
  projectId: string | null;
  horario: Horario;
};

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: 400 | 503; error: string };

const fallo = (error: string, status: 400 | 503 = 400): { ok: false; status: 400 | 503; error: string } => ({
  ok: false,
  status,
  error,
});

// Próxima ejecución en ISO UTC. Con "cada_horas", ahora más N horas. Con "diaria", la siguiente
// ocurrencia de HH:MM en hora local del servidor, estrictamente posterior a "desde".
export function siguienteEjecucion(horario: Horario, desde: Date): string {
  if (horario.frecuencia === "cada_horas") {
    return new Date(desde.getTime() + (horario.cadaHoras ?? 1) * 3_600_000).toISOString();
  }
  const [horas, minutos] = (horario.hora ?? "00:00").split(":").map(Number);
  const candidata = new Date(desde);
  candidata.setHours(horas, minutos, 0, 0);
  if (candidata.getTime() <= desde.getTime()) {
    candidata.setDate(candidata.getDate() + 1);
    candidata.setHours(horas, minutos, 0, 0);
  }
  return candidata.toISOString();
}

// Valida el cuerpo y el modelo. El modelo se comprueba contra la lista de OpenCode.
export async function prepararProgramada(body: Record<string, unknown>): Promise<Resultado<NuevaProgramada>> {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > PROMPT_MAX) return fallo("invalid_prompt");

  let horario: Horario;
  if (body.frecuencia === "cada_horas") {
    const cada = body.cada_horas;
    if (typeof cada !== "number" || !Number.isInteger(cada) || cada < 1 || cada > HORAS_MAX) {
      return fallo("invalid_schedule");
    }
    horario = { frecuencia: "cada_horas", cadaHoras: cada, hora: null };
  } else if (body.frecuencia === "diaria") {
    if (typeof body.hora !== "string" || !PATRON_HORA.test(body.hora)) return fallo("invalid_schedule");
    horario = { frecuencia: "diaria", cadaHoras: null, hora: body.hora };
  } else {
    return fallo("invalid_schedule");
  }

  const titulo =
    typeof body.titulo === "string" && body.titulo.trim() ? body.titulo.trim().slice(0, TITULO_MAX) : prompt.slice(0, 60);

  let projectId: string | null = null;
  if (body.projectId !== undefined && body.projectId !== null && body.projectId !== "") {
    if (typeof body.projectId !== "string") return fallo("project_not_found");
    if (!db.query("SELECT 1 FROM projects WHERE id = ?").get(body.projectId)) return fallo("project_not_found");
    projectId = body.projectId;
  }

  // Igual que las tareas: con modelo explícito, el esfuerzo es el que se pide; si no, el de Ajustes.
  const prefs = getPreferences();
  if (body.model !== undefined && body.model !== null && typeof body.model !== "string") return fallo("model_not_found");
  if (body.effort !== undefined && body.effort !== null && typeof body.effort !== "string") {
    return fallo("effort_not_supported");
  }
  const modeloPedido = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const esfuerzoPedido = typeof body.effort === "string" && body.effort ? body.effort : null;
  const model = modeloPedido ?? prefs.defaultModel ?? MODELO_POR_DEFECTO;
  const effort = modeloPedido ? esfuerzoPedido : esfuerzoPedido ?? prefs.defaultEffort ?? null;

  try {
    const check = await validateSelection(model, effort);
    if (!check.ok) return fallo(check.error);
  } catch {
    return fallo("models_unavailable", 503);
  }

  return { ok: true, valor: { titulo, prompt, model, effort, projectId, horario } };
}

// Inserta la programada. Devuelve null si ya hay LIMITE_PROGRAMADAS.
export function insertarProgramada(datos: NuevaProgramada): string | null {
  const id = crypto.randomUUID();
  const { horario } = datos;
  return db.transaction(() => {
    const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM programadas").get()!.n;
    if (total >= LIMITE_PROGRAMADAS) return null;
    db.query(
      `INSERT INTO programadas (id, titulo, prompt, model, effort, project_id, frecuencia, cada_horas, hora, activa, proxima_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      datos.titulo,
      datos.prompt,
      datos.model,
      datos.effort,
      datos.projectId,
      horario.frecuencia,
      horario.cadaHoras,
      horario.hora,
      siguienteEjecucion(horario, new Date()),
    );
    return id;
  })();
}

type FilaProgramada = {
  id: string;
  titulo: string;
  prompt: string;
  model: string;
  effort: string | null;
  project_id: string | null;
  project_name: string | null;
  frecuencia: Frecuencia;
  cada_horas: number | null;
  hora: string | null;
  activa: number;
  proxima_en: string;
  ultima_ejecucion: string | null;
  ultima_tarea_id: string | null;
  created_at: string;
};

const SELECT_PROGRAMADA =
  "SELECT p.id, p.titulo, p.prompt, p.model, p.effort, p.project_id, pr.name AS project_name, p.frecuencia, " +
  "p.cada_horas, p.hora, p.activa, p.proxima_en, p.ultima_ejecucion, p.ultima_tarea_id, p.created_at " +
  "FROM programadas p LEFT JOIN projects pr ON pr.id = p.project_id";

function aProgramada(f: FilaProgramada) {
  return { ...f, activa: f.activa === 1 };
}

export function leerProgramada(id: string) {
  const fila = db.query<FilaProgramada, [string]>(`${SELECT_PROGRAMADA} WHERE p.id = ?`).get(id);
  return fila ? aProgramada(fila) : null;
}

export function listarProgramadas() {
  return db
    .query<FilaProgramada, []>(`${SELECT_PROGRAMADA} ORDER BY p.activa DESC, p.proxima_en ASC, p.created_at ASC`)
    .all()
    .map(aProgramada);
}

// Cambia si está activa. Al reactivar, la próxima ejecución se calcula desde ahora: así no se
// dispara de golpe una ejecución pendiente desde hace días.
export function cambiarActiva(id: string, activa: boolean, ahora: Date = new Date()): boolean {
  const fila = db.query<{ frecuencia: Frecuencia; cada_horas: number | null; hora: string | null; activa: number }, [string]>(
    "SELECT frecuencia, cada_horas, hora, activa FROM programadas WHERE id = ?",
  ).get(id);
  if (!fila) return false;
  const reactivar = activa && fila.activa === 0;
  const proxima = reactivar
    ? siguienteEjecucion({ frecuencia: fila.frecuencia, cadaHoras: fila.cada_horas, hora: fila.hora }, ahora)
    : null;
  db.query("UPDATE programadas SET activa = ?, proxima_en = COALESCE(?, proxima_en) WHERE id = ?").run(
    activa ? 1 : 0,
    proxima,
    id,
  );
  return true;
}

type CrearTarea = (opts: NuevaTarea) => string;

// No volver a lanzar mientras la última ejecución siga abierta, incluso si espera una decisión del usuario.
export function ultimaTareaActiva(programadaId: string): boolean {
  return (
    db
      .query(
        "SELECT 1 FROM programadas p JOIN tasks t ON t.id = p.ultima_tarea_id WHERE p.id = ? AND t.status IN ('queued', 'analyzing', 'waiting_approval', 'running', 'interrupted', 'sin_cuota')",
      )
      .get(programadaId) !== null
  );
}

// Lanza las programadas vencidas. Primero avanza la próxima ejecución y registra la última, y solo
// después crea la tarea: si el avance no se aplica (otra ejecución ya lo hizo), no se crea nada.
// Como mucho MAX_CREADAS_POR_REVISION por revisión (así un arranque con muchas vencidas no lanza una
// ráfaga); las demás siguen vencidas y salen en la siguiente. Si la anterior sigue activa, no se solapa.
// Devuelve cuántas tareas se crearon. Nunca lanza por una programada concreta.
export function ejecutarVencidas(ahora: Date = new Date(), crear: CrearTarea = crearTarea): number {
  const ahoraIso = ahora.toISOString();
  const vencidas = db
    .query<FilaProgramada, [string]>(
      `${SELECT_PROGRAMADA} WHERE p.activa = 1 AND p.proxima_en <= ? ORDER BY p.proxima_en ASC`,
    )
    .all(ahoraIso);

  let creadas = 0;
  for (const p of vencidas) {
    if (creadas >= MAX_CREADAS_POR_REVISION) break;
    const avanzada = db.transaction(() => {
      const siguiente = siguienteEjecucion(
        { frecuencia: p.frecuencia, cadaHoras: p.cada_horas, hora: p.hora },
        ahora,
      );
      const r = db
        .query("UPDATE programadas SET proxima_en = ?, ultima_ejecucion = ? WHERE id = ? AND activa = 1 AND proxima_en = ?")
        .run(siguiente, ahoraIso, p.id, p.proxima_en);
      return r.changes === 1;
    })();
    if (!avanzada) continue;
    if (ultimaTareaActiva(p.id)) continue;

    try {
      const tareaId = crear({
        prompt: p.prompt,
        model: p.model,
        effort: p.effort,
        projectId: p.project_id,
        titulo: p.titulo,
        origen: "programada",
      });
      db.query("UPDATE programadas SET ultima_tarea_id = ? WHERE id = ?").run(tareaId, p.id);
      creadas++;
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      console.error(`Programada ${p.id}: no se pudo crear la tarea. ${mensaje.slice(0, 200)}`);
    }
  }
  return creadas;
}

// Lanza el planificador en el mismo proceso. Revisa al arrancar (así recupera lo vencido mientras
// el servidor estuvo apagado) y luego cada 30 s.
let temporizador: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (temporizador) return;
  const revisar = () => {
    try {
      const creadas = ejecutarVencidas();
      if (creadas > 0) console.log(`Programadas: ${creadas} tarea(s) creada(s).`);
    } catch (err) {
      console.error("Planificador de programadas:", err instanceof Error ? err.message : String(err));
    }
  };
  revisar();
  temporizador = setInterval(revisar, INTERVALO_PLANIFICADOR_MS);
}

export function borrarProgramada(id: string): boolean {
  return db.query("DELETE FROM programadas WHERE id = ?").run(id).changes > 0;
}

export function registrarEjecucionManual(id: string, tareaId: string, ahora: Date = new Date()) {
  db.query("UPDATE programadas SET ultima_ejecucion = ?, ultima_tarea_id = ? WHERE id = ?").run(
    ahora.toISOString(),
    tareaId,
    id,
  );
}
