import { Hono } from "hono";
import { db } from "../db";
import { getPreferences } from "../preferences";

type Totals = { calls: number; input: number; output: number; cost: number };
type DayRow = { day: string; cost: number; tokens: number; calls: number };
type ModelRow = { model: string; cost: number; tokens: number; calls: number };
type StatusRow = { status: string; n: number };

const TASK_STATUSES = ["queued", "running", "interrupted", "done", "failed", "cancelled"] as const;

// Fecha UTC en formato AAAA-MM-DD, igual que date() de SQLite.
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

export const analytics = new Hono();

// GET /api/analytics?days=30  (7 a 365)
analytics.get("/analytics", (c) => {
  const requested = Number(c.req.query("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.max(Math.round(requested), 7), 365) : 30;
  const since = `-${days} days`;

  const totals = db
    .query<Totals, [string]>(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input,
              COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(cost), 0) AS cost
         FROM usage WHERE created_at >= datetime('now', ?)`,
    )
    .get(since)!;

  // Un punto por día, incluidos los días sin uso, para que la gráfica no salte.
  const dayRows = db
    .query<DayRow, [string]>(
      `SELECT date(created_at) AS day,
              COALESCE(SUM(cost), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COUNT(*) AS calls
         FROM usage WHERE created_at >= datetime('now', ?)
        GROUP BY day`,
    )
    .all(since);
  const byDayMap = new Map(dayRows.map((r) => [r.day, r]));
  const byDay: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(i * 86_400_000);
    byDay.push(byDayMap.get(day) ?? { day, cost: 0, tokens: 0, calls: 0 });
  }

  const byModel = db
    .query<ModelRow, [string]>(
      `SELECT model,
              COALESCE(SUM(cost), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COUNT(*) AS calls
         FROM usage WHERE created_at >= datetime('now', ?)
        GROUP BY model ORDER BY cost DESC, tokens DESC LIMIT 12`,
    )
    .all(since);

  const statusRows = db
    .query<StatusRow, [string]>(
      "SELECT status, COUNT(*) AS n FROM tasks WHERE created_at >= datetime('now', ?) GROUP BY status",
    )
    .all(since);
  const tasks = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<(typeof TASK_STATUSES)[number], number>;
  for (const r of statusRows) if (r.status in tasks) tasks[r.status as keyof typeof tasks] = r.n;

  // Presupuesto del mes calendario en UTC.
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

  return c.json({
    days,
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
  });
});
