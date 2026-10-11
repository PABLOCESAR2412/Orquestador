import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Analytics } from "../api";
import { compact, DailyBars, ModelBars, shortDay } from "../components/charts";
import { useShell } from "../components/shell-context";
import { errorText, formatUsd } from "../lib/model";

const PERIODS = [7, 30, 90] as const;

export const usd = (n: number) => {
  if (n === 0) return "US$ 0.00";
  return formatUsd(n);
};

// Duración media de las tareas: "45 s", "2 min 30 s", "1 h 5 min".
export function formatDuracion(seg: number | null): string {
  if (seg === null) return "—";
  const total = Math.round(seg);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

const BUDGET_LABEL: Record<"ok" | "alerta" | "excedido", string> = {
  ok: "En rango",
  alerta: "Cerca del límite",
  excedido: "Excedido",
};

export function AnalyticsPage() {
  const { toggleDrawer } = useShell();
  const [days, setDays] = useState<number>(30);
  // "" significa sin filtro.
  const [proyecto, setProyecto] = useState("");
  const [modelo, setModelo] = useState("");

  // Mantiene la gráfica anterior mientras llega el nuevo periodo o filtro, sin saltos.
  const query = useQuery({
    queryKey: ["analytics", days, proyecto, modelo],
    queryFn: () => api.getAnalytics(days, { proyecto: proyecto || null, modelo: modelo || null }),
    placeholderData: keepPreviousData,
  });
  const data: Analytics | undefined = query.data;
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const names = new Map((models.data?.models ?? []).map((m) => [m.id, m.name]));
  const nombreModelo = (id: string) => names.get(id) ?? id;

  // Opciones de los filtros: las que manda el servidor, más el modelo elegido por si ya no aparece.
  const proyectosOpciones = data?.proyectos ?? [];
  const modelosOpciones = data ? [...new Set([...data.modelos, ...(modelo ? [modelo] : [])])] : [];
  const filtrado = proyecto !== "" || modelo !== "";
  const sinUso = data !== undefined && data.totals.calls === 0;

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-title-row">
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
            <div className="page-meta-badge">
              <span className="pill-dot is-live" aria-hidden="true" />
              <span>Métricas de Infraestructura</span>
            </div>
            <h1>Analíticas de Consumo</h1>
            <p className="page-desc">
              Monitoreo de tokens, costos y tareas en tu servidor.
            </p>
          </div>
        </div>
      </header>

      {/* Filtros en una fila, sobre las gráficas y los indicadores */}
      <div className="analitica-filtros">
        <div className="period" role="group" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`pill${days === p ? " on" : ""}`}
              aria-pressed={days === p}
              onClick={() => setDays(p)}
            >
              {p}d
            </button>
          ))}
        </div>
        <label className="filtro-campo">
          <span>Proyecto</span>
          <select className="filtro-select" value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
            <option value="">Todos los proyectos</option>
            {proyectosOpciones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filtro-campo">
          <span>Modelo</span>
          <select className="filtro-select" value={modelo} onChange={(e) => setModelo(e.target.value)}>
            <option value="">Todos los modelos</option>
            {modelosOpciones.map((id) => (
              <option key={id} value={id}>
                {nombreModelo(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isPending && !data && <p className="muted-note">Cargando analíticas…</p>}

      {query.isError && (
        <div className="estado-linea">
          <p className="error" role="alert">
            {errorText(query.error)}
          </p>
          <button type="button" className="ghost" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </div>
      )}

      {sinUso && (
        <p className="muted-note">
          {filtrado
            ? "Sin uso con estos filtros en este periodo. Prueba otro proyecto o modelo, o quita los filtros."
            : "Todavía no hay uso en este periodo."}
        </p>
      )}

      {data && (
        <>
          <section className="kpis" aria-label="Resumen de consumo">
            <Kpi
              label="Gasto Total Estimado"
              value={usd(data.totals.cost)}
              hint={`Últimos ${data.days} días`}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              }
            />
            <Kpi
              label="Tokens Procesados"
              value={compact(data.totals.inputTokens + data.totals.outputTokens)}
              hint={
                <span>
                  In: {compact(data.totals.inputTokens)} • Out: {compact(data.totals.outputTokens)}
                </span>
              }
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 3 12 12 18 12" />
                </svg>
              }
            />
            <Kpi
              label="Llamadas Registradas"
              value={compact(data.totals.calls)}
              hint="A modelos de lenguaje"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              }
            />
            <Kpi
              label="Tareas del Servidor"
              value={`${data.tasks.done} hechas`}
              hint={
                <span>
                  {data.tasks.failed} fallidas • {data.tasks.queued + data.tasks.running} activas
                </span>
              }
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              }
            />
          </section>

          <section className="panel">
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                  <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
                  <path d="M18 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-8h-4z" />
                </svg>
                <h2>Presupuesto del mes</h2>
              </div>
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
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                <h2>Volumen Diario de Ejecución</h2>
              </div>
              <span className="panel-tag">Total: {usd(data.totals.cost)}</span>
            </div>
            <DailyBars
              data={data.byDay}
              formatValue={usd}
              title={`Costo por día en los últimos ${data.days} días`}
            />
          </section>

          <section className="panel">
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" y1="16" x2="8" y2="16" />
                  <line x1="16" y1="16" x2="16" y2="16" />
                </svg>
                <h2>Desglose por Agente de IA</h2>
              </div>
              <span className="panel-tag">{data.byModel.length} modelos registrados</span>
            </div>
            <ModelBars
              rows={data.byModel.map((r) => ({ ...r, model: nombreModelo(r.model) }))}
              formatValue={usd}
            />

            {data.byModel.length > 0 && (
              <div className="tabla-scroll">
                <table className="comparacion">
                  <caption>Comparación por modelo en los últimos {data.days} días</caption>
                  <thead>
                    <tr>
                      <th scope="col">Modelo</th>
                      <th scope="col">Costo</th>
                      <th scope="col">Tokens</th>
                      <th scope="col">Llamadas</th>
                      <th scope="col">Tareas</th>
                      <th scope="col">Duración media</th>
                      <th scope="col">Costo por tarea</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((r) => (
                      <tr key={r.model}>
                        <th scope="row">{nombreModelo(r.model)}</th>
                        <td>{usd(r.cost)}</td>
                        <td>{compact(r.tokens)}</td>
                        <td>{r.calls}</td>
                        <td>{r.tareas}</td>
                        <td>{formatDuracion(r.duracionMediaSeg)}</td>
                        <td>{r.costoPorTareaUsd === null ? "—" : usd(r.costoPorTareaUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

function Kpi({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-foot">{hint}</div>}
    </div>
  );
}
