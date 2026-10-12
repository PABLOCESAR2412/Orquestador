import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Analytics } from "../api";
import { AppNav } from "../components/nav";
import { compact, DailyBars, ModelBars, shortDay } from "../components/charts";
import { BotonTema } from "../components/tema-boton";
import { Paginacion } from "../components/paginacion";
import { errorText, formatUsd } from "../lib/model";

const PERIODS = [7, 30, 90] as const;
const FILAS_POR_PAGINA = 10;

export const usd = (n: number) => {
  if (n === 0) return "US$ 0.00";
  return formatUsd(n);
};

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
  const [days, setDays] = useState<number>(30);
  const [proyecto, setProyecto] = useState("");
  const [modelo, setModelo] = useState("");
  const [pagina, setPagina] = useState(1);

  const query = useQuery({
    queryKey: ["analytics", days, proyecto, modelo],
    queryFn: () => api.getAnalytics(days, { proyecto: proyecto || null, modelo: modelo || null }),
    placeholderData: keepPreviousData,
  });
  const data: Analytics | undefined = query.data;
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const names = new Map((models.data?.models ?? []).map((m) => [m.id, m.name]));
  const nombreModelo = (id: string) => names.get(id) ?? id;

  const proyectosOpciones = data?.proyectos ?? [];
  const modelosOpciones = data ? [...new Set([...data.modelos, ...(modelo ? [modelo] : [])])] : [];
  const filtrado = proyecto !== "" || modelo !== "";
  const sinUso = data !== undefined && data.totals.calls === 0;

  const diasTabla = data ? [...data.byDay].reverse() : [];
  const totalPaginas = Math.max(1, Math.ceil(diasTabla.length / FILAS_POR_PAGINA));
  const paginaTabla = Math.min(pagina, totalPaginas);
  const filasTabla = diasTabla.slice((paginaTabla - 1) * FILAS_POR_PAGINA, paginaTabla * FILAS_POR_PAGINA);

  return (
    <div className="page-wrap">
      <AppNav variant="row" />
      <main className="container">
        <header className="header-row">
          <div className="title-group" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Métricas del Sistema</span>
              <span>•</span>
              <span>Instancia local</span>
            </div>
            <h1 className="page-title">Analíticas de consumo</h1>
            <p style={{ color: "var(--ink-2)", fontSize: "13px", margin: 0 }}>
              Métricas de tokens, gasto estimado y tiempo de cómputo en tu servidor.
            </p>
          </div>
          <BotonTema />
        </header>

        <div className="analitica-filtros">
          <nav aria-label="Intervalo de tiempo" className="period" role="group">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={`pill${days === p ? " on" : ""}`}
                aria-pressed={days === p}
                onClick={() => {
                  setDays(p);
                  setPagina(1);
                }}
              >
                {p}d
              </button>
            ))}
          </nav>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <label className="filtro-campo" style={{ margin: 0 }}>
              <select className="filtro-select" value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
                <option value="">Todos los proyectos</option>
                {proyectosOpciones.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filtro-campo" style={{ margin: 0 }}>
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
        </div>

        {query.isPending && !data && <p className="muted-note">Cargando analíticas…</p>}

        {query.isError && (
          <section className="panel" aria-live="polite">
            <p className="error" role="alert">
              {errorText(query.error)}
            </p>
            <div>
              <button type="button" className="btn-ghost" onClick={() => void query.refetch()}>
                Reintentar
              </button>
            </div>
          </section>
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
            {/* 3 KPI Summary Cards */}
            <section className="kpis" aria-label="Resumen de consumo">
              <Kpi
                label="Gasto estimado"
                value={usd(data.totals.cost)}
                hint={`Últimos ${data.days} días`}
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                }
              />
              <Kpi
                label="Tokens procesados"
                value={compact(data.totals.inputTokens + data.totals.outputTokens)}
                hint={
                  <span>
                    In: {compact(data.totals.inputTokens)} • Out: {compact(data.totals.outputTokens)}
                  </span>
                }
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 3 12 12 18 12" />
                  </svg>
                }
              />
              <Kpi
                label="Tiempo de cómputo"
                value={`${data.tasks.done} hechas`}
                hint={
                  <span>
                    {data.tasks.failed} fallidas • {data.totals.calls} llamadas
                  </span>
                }
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
              />
            </section>

            {/* Daily volume bar chart */}
            <section className="panel" aria-labelledby="sec-volumen">
              <div className="card-top">
                <div>
                  <h2 id="sec-volumen" className="panel-title">Volumen de llamadas diarias</h2>
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
                    Últimos {data.days} días
                  </span>
                </div>
                <span className="panel-tag">Total: {usd(data.totals.cost)}</span>
              </div>
              <DailyBars
                data={data.byDay}
                formatValue={usd}
                title={`Costo por día en los últimos ${data.days} días`}
              />
            </section>

            {/* Model breakdown */}
            <section className="panel" aria-labelledby="sec-modelos">
              <div className="card-top">
                <div>
                  <h2 id="sec-modelos" className="panel-title">Distribución por modelo</h2>
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
                    Consumo agrupado de tokens y coste
                  </span>
                </div>
                <span className="panel-tag">{data.byModel.length} activos</span>
              </div>
              <ModelBars
                rows={data.byModel.map((r) => ({ ...r, model: nombreModelo(r.model) }))}
                formatValue={usd}
              />

              {data.byModel.length > 0 && (
                <div className="tabla-scroll">
                  <table className="comparacion">
                    <caption>Comparación detallada por modelo en los últimos {data.days} días</caption>
                    <thead>
                      <tr>
                        <th scope="col">Modelo</th>
                        <th scope="col">Costo</th>
                        <th scope="col">Tokens</th>
                        <th scope="col">Llamadas</th>
                        <th scope="col">Tareas</th>
                        <th scope="col">Duración media</th>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Presupuesto */}
            {data.budget && (
              <section className="panel" aria-labelledby="sec-presupuesto">
                <div className="card-top">
                  <h2 id="sec-presupuesto" className="panel-title">Presupuesto del mes</h2>
                  <span className={`badge ${data.budget.status === "ok" ? "badge-ok" : data.budget.status === "alerta" ? "badge-signal" : "badge-error"}`}>
                    {BUDGET_LABEL[data.budget.status]}
                  </span>
                </div>
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
                  <p className="muted-note" style={{ margin: 0 }}>Aviso al {data.budget.alertPercent} %.</p>
                </div>
              </section>
            )}

            {/* Recent Executions Table */}
            <section className="panel" aria-labelledby="sec-ejecuciones">
              <div className="card-top">
                <div>
                  <h2 id="sec-ejecuciones" className="panel-title">Ejecuciones recientes</h2>
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
                    Registros sincronizados en tiempo real
                  </span>
                </div>
                <button
                  className="btn-ghost"
                  type="button"
                  disabled
                  title="Exportación CSV no disponible en servidor local"
                  style={{ opacity: 0.5, cursor: "not-allowed", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Exportar CSV
                </button>
              </div>
              <div className="tabla-scroll">
                <table className="comparacion">
                  <thead>
                    <tr>
                      <th scope="col">Marca temporal</th>
                      <th scope="col">Tokens</th>
                      <th scope="col">Llamadas</th>
                      <th scope="col" style={{ textAlign: "right" }}>Coste estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasTabla.map((d) => (
                      <tr key={d.day}>
                        <th scope="row" style={{ minWidth: "120px" }}>{shortDay(d.day)}</th>
                        <td>{compact(d.tokens)}</td>
                        <td>{d.calls}</td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{usd(d.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
                <span style={{ fontSize: "12px", color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
                  Mostrando {filasTabla.length} de {diasTabla.length} días registrados
                </span>
                <Paginacion
                  pagina={paginaTabla}
                  total={diasTabla.length}
                  porPagina={FILAS_POR_PAGINA}
                  onCambio={setPagina}
                />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
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
