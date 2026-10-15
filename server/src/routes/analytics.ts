import { Hono } from "hono";
import { db } from "../db";
import { getPreferences } from "../preferences";

type Totals = { calls: number; input: number; output: number; cost: number };
type DayRow = { day: string; cost: number; tokens: number; calls: number };
type StatusRow = { status: string; n: number };
type UsoModeloRow = { model: string; cost: number; tokens: number; calls: number };
type TareaModeloRow = { model: string; tareas: number; duracion: number | null };

const TASK_STATUSES = ["queued", "analyzing", "waiting_approval", "running", "interrupted", "sin_cuota", "done", "failed", "cancelled"] as const;

// Fecha UTC en formato AAAA-MM-DD, igual que date() de SQLite.
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

// Proyecto de un uso: el que guardó el uso, o el de su chat o su tarea.
const PROYECTO_DE_USO =
  "COALESCE(u.project_id, (SELECT c.project_id FROM conversations c WHERE c.id = u.conversation_id), " +
  "(SELECT t.project_id FROM tasks t WHERE t.id = u.task_id))";

// Un filtro vacío o ausente no filtra. Uno inexistente da ceros, no error.
const filtro = (valor: string | undefined): string | null => valor?.trim() || null;

export const analytics = new Hono();

// GET /api/analytics?days=30&proyecto=<id>&modelo=<id>  (days de 7 a 365)
analytics.get("/analytics", (c) => {
  const requested = Number(c.req.query("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.max(Math.round(requested), 7), 365) : 30;
  const since = `-${days} days`;
  const proyecto = filtro(c.req.query("proyecto"));
  const modelo = filtro(c.req.query("modelo"));

  // Condiciones de usage (alias u) y de tasks, con los mismos filtros.
  const usoCond = ["u.created_at >= datetime('now', ?)"];
  const usoParams: string[] = [since];
  if (proyecto) {
    usoCond.push(`${PROYECTO_DE_USO} = ?`);
    usoParams.push(proyecto);
  }
  if (modelo) {
    usoCond.push("u.model = ?");
    usoParams.push(modelo);
  }
  const usoWhere = `WHERE ${usoCond.join(" AND ")}`;

  const tareaCond = ["created_at >= datetime('now', ?)"];
  const tareaParams: string[] = [since];
  if (proyecto) {
    tareaCond.push("project_id = ?");
    tareaParams.push(proyecto);
  }
  if (modelo) {
    tareaCond.push("model = ?");
    tareaParams.push(modelo);
  }
  const tareaWhere = `WHERE ${tareaCond.join(" AND ")}`;

  const totals = db
    .query<Totals, string[]>(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(u.input_tokens), 0) AS input,
              COALESCE(SUM(u.output_tokens), 0) AS output,
              COALESCE(SUM(u.cost), 0) AS cost
         FROM usage u ${usoWhere}`,
    )
    .get(...usoParams)!;

  // Un punto por día, incluidos los días sin uso, para que la gráfica no salte.
  const dayRows = db
    .query<DayRow, string[]>(
      `SELECT date(u.created_at) AS day,
              COALESCE(SUM(u.cost), 0) AS cost,
              COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS tokens,
              COUNT(*) AS calls
         FROM usage u ${usoWhere}
        GROUP BY day`,
    )
    .all(...usoParams);
  const byDayMap = new Map(dayRows.map((r) => [r.day, r]));
  const byDay: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(i * 86_400_000);
    byDay.push(byDayMap.get(day) ?? { day, cost: 0, tokens: 0, calls: 0 });
  }

  // Por modelo: costo y tokens de usage, y tareas, duración y costo por tarea de tasks.
  const usoPorModelo = db
    .query<UsoModeloRow, string[]>(
      `SELECT u.model AS model,
              COALESCE(SUM(u.cost), 0) AS cost,
              COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS tokens,
              COUNT(*) AS calls
         FROM usage u ${usoWhere}
        GROUP BY u.model`,
    )
    .all(...usoParams);
  const tareasPorModelo = db
    .query<TareaModeloRow, string[]>(
      `SELECT model,
              COUNT(*) AS tareas,
              AVG(CASE WHEN status = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
                       THEN (julianday(finished_at) - julianday(started_at)) * 86400.0 END) AS duracion
         FROM tasks ${tareaWhere}
        GROUP BY model`,
    )
    .all(...tareaParams);

  type FilaModelo = { model: string; cost: number; tokens: number; calls: number; tareas: number; duracion: number | null };
  const porModelo = new Map<string, FilaModelo>();
  for (const r of usoPorModelo) {
    porModelo.set(r.model, { model: r.model, cost: r.cost, tokens: r.tokens, calls: r.calls, tareas: 0, duracion: null });
  }
  for (const r of tareasPorModelo) {
    const fila = porModelo.get(r.model) ?? { model: r.model, cost: 0, tokens: 0, calls: 0, tareas: 0, duracion: null };
    fila.tareas = r.tareas;
    fila.duracion = r.duracion;
    porModelo.set(r.model, fila);
  }
  const byModel = [...porModelo.values()]
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.tareas - a.tareas)
    .slice(0, 12)
    .map((f) => ({
      model: f.model,
      cost: f.cost,
      tokens: f.tokens,
      calls: f.calls,
      tareas: f.tareas,
      duracionMediaSeg: f.duracion === null ? null : Math.round(f.duracion * 10) / 10,
      costoPorTareaUsd: f.tareas > 0 ? f.cost / f.tareas : null,
    }));

  const statusRows = db
    .query<StatusRow, string[]>(`SELECT status, COUNT(*) AS n FROM tasks ${tareaWhere} GROUP BY status`)
    .all(...tareaParams);
  const tasks = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<(typeof TASK_STATUSES)[number], number>;
  for (const r of statusRows) if (r.status in tasks) tasks[r.status as keyof typeof tasks] = r.n;

  // Presupuesto del mes calendario en UTC. Es global: no depende de los filtros.
  const prefs = getPreferences();
  const spent = db
    .query<{ cost: number }, []>(
      "SELECT COALESCE(SUM(cost), 0) AS cost FROM usage WHERE created_at >= datetime('now', 'start of month')",
    )
    .get()!.cost;
  const budget =
    prefs.monthlyBudgetUsd && prefs.monthlyBudgetUsd > 0
      ? {
          monthlyUsd: prefs.monthlyBudgetUsd,
          spentUsd: spent,
          percent: Math.round((spent / prefs.monthlyBudgetUsd) * 100),
          alertPercent: prefs.budgetAlertPercent,
          status:
            spent >= prefs.monthlyBudgetUsd
              ? "excedido"
              : spent >= (prefs.monthlyBudgetUsd * prefs.budgetAlertPercent) / 100
                ? "alerta"
                : "ok",
        }
      : null;

  // Opciones de los filtros: todos los proyectos, y los modelos con uso o tareas en el periodo.
  const proyectos = db.query<{ id: string; name: string }, []>("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE").all();
  const modelos = db
    .query<{ model: string }, [string, string]>(
      `SELECT model FROM usage WHERE created_at >= datetime('now', ?)
       UNION
       SELECT model FROM tasks WHERE created_at >= datetime('now', ?)
       ORDER BY model`,
    )
    .all(since, since)
    .map((r) => r.model);

  return c.json({
    days,
    filtros: { proyecto, modelo },
    totals: {
      calls: totals.calls,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cost: totals.cost,
    },
    byDay,
    byModel,
    tasks,
    budget,
    proyectos,
    modelos,
  });
});
