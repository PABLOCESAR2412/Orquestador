import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Analytics } from "../api";
import { compact, DailyBars, ModelBars, shortDay } from "../components/charts";
import { useShell } from "../components/shell-context";

const PERIODS = [7, 30, 90] as const;

export const usd = (n: number) => {
  if (n === 0) return "US$ 0.00";
  return n < 0.01 ? `US$ ${n.toFixed(4)}` : `US$ ${n.toFixed(2)}`;
};

const BUDGET_LABEL: Record<"ok" | "alerta" | "excedido", string> = {
  ok: "En rango",
  alerta: "Cerca del límite",
  excedido: "Excedido",
};

export function AnalyticsPage() {
  const { toggleDrawer } = useShell();
  const [days, setDays] = useState<number>(30);

  // Mantiene la gráfica anterior mientras llega el nuevo periodo, sin saltos.
  const query = useQuery({
    queryKey: ["analytics", days],
    queryFn: () => api.getAnalytics(days),
    placeholderData: keepPreviousData,
  });
  const data: Analytics | undefined = query.data;
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const names = new Map((models.data?.models ?? []).map((m) => [m.id, m.name]));

  return (
    <main className="page">
      <header className="page-head">
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <button
            type="button"
            className="ghost menu-btn"
            aria-label="Abrir menú"
            onClick={toggleDrawer}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <div>
            <h1>Analíticas</h1>
            <p className="page-desc">
              Métricas de tokens, costo acumulado y llamadas registradas en tu servidor.
            </p>
          </div>
        </div>
        <div className="period" role="group" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`pill${days === p ? " on" : ""}`}
              aria-pressed={days === p}
              onClick={() => setDays(p)}
            >
              {p} días
            </button>
          ))}
        </div>
      </header>

      {query.isError && (
        <p className="error" role="alert">
          No se pudieron cargar las analíticas.
        </p>
      )}

      {data && (
        <>
          <section className="kpis" aria-label="Resumen">
            <Kpi label="Costo" value={usd(data.totals.cost)} />
            <Kpi label="Llamadas" value={compact(data.totals.calls)} />
            <Kpi
              label="Tokens"
              value={compact(data.totals.inputTokens + data.totals.outputTokens)}
              hint={`${compact(data.totals.inputTokens)} entrada · ${compact(data.totals.outputTokens)} salida`}
            />
            <Kpi
              label="Tareas hechas"
              value={String(data.tasks.done)}
              hint={`${data.tasks.failed} fallidas · ${data.tasks.queued + data.tasks.running} activas`}
            />
          </section>

          <section className="panel">
            <div className="card-top">
              <h2>Presupuesto del mes</h2>
              {data.budget && (
                <span className={`badge ${data.budget.status === "ok" ? "badge-ok" : data.budget.status === "alerta" ? "badge-signal" : "badge-error"}`}>
                  {BUDGET_LABEL[data.budget.status]}
                </span>
              )}
            </div>
            {data.budget ? (
              <div className="budget">
                <div className="budget-row">
                  <span>
                    {usd(data.budget.spentUsd)} de {usd(data.budget.monthlyUsd)}
                  </span>
                  <span className={`budget-status is-${data.budget.status}`}>
                    {BUDGET_LABEL[data.budget.status]} · {data.budget.percent} %
                  </span>
                </div>
                <div className="budget-track" aria-hidden="true">
                  <div
                    className={`budget-fill is-${data.budget.status}`}
                    style={{ width: `${Math.min(data.budget.percent, 100)}%` }}
                  />
                </div>
                <p className="muted-note">Aviso al {data.budget.alertPercent} %.</p>
              </div>
            ) : (
              <p className="muted-note">
                Sin presupuesto. <Link to="/ajustes" className="foot-link">Define uno en Ajustes</Link>.
              </p>
            )}
          </section>

          <section className="panel">
            <h2>Costo por día</h2>
            <DailyBars
              data={data.byDay}
              formatValue={usd}
              title={`Costo por día en los últimos ${data.days} días`}
            />
          </section>

          <section className="panel">
            <h2>Costo por modelo</h2>
            <ModelBars
              rows={data.byModel.map((r) => ({ ...r, model: names.get(r.model) ?? r.model }))}
              formatValue={usd}
            />
          </section>

          <details className="panel data-table">
            <summary>Ver datos en tabla</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col">Costo</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Llamadas</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byDay].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{shortDay(d.day)}</td>
                    <td>{usd(d.cost)}</td>
                    <td>{compact(d.tokens)}</td>
                    <td>{d.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </main>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}
