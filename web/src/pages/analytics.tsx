import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Analytics, type Task } from "../api";
import { compact } from "../components/charts";
import { diaCompleto, VolumenLlamadas } from "../components/an-volumen";
import { Paginacion } from "../components/paginacion";
import { cuando } from "../components/tarea-formato";
import { agenteDeTarea, duracionSeg, fechaUtc, nombreAgente } from "../lib/tareas-vista";
import { errorText, formatUsd } from "../lib/model";
import "../styles-analiticas.css";

const PERIODS = [7, 30, 90] as const;
const FILAS_POR_PAGINA = 10;
const DIA_MS = 86_400_000;

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

const TIPO_USO: Record<"chat" | "tarea" | "otro", { nombre: string; detalle: string }> = {
  chat: { nombre: "Chat", detalle: "Llamadas vinculadas directamente a una conversación." },
  tarea: { nombre: "Tareas del agente", detalle: "Llamadas generadas durante tareas del agente." },
  otro: { nombre: "Otras llamadas", detalle: "Llamadas sin una conversación o tarea asociada." },
};

// Tiempo de cómputo estimado: duración media de cada modelo (ponderada por sus tareas) × tareas hechas.
// El servidor no suma la duración de cada tarea, así que es una estimación y se muestra como tal.
export function tiempoComputoSeg(data: Analytics): number | null {
  const medidos = data.byModel.filter((m) => m.duracionMediaSeg !== null && m.tareas > 0);
  const pesos = medidos.reduce((s, m) => s + m.tareas, 0);
  if (pesos === 0 || data.tasks.done === 0) return null;
  const media = medidos.reduce((s, m) => s + (m.duracionMediaSeg ?? 0) * m.tareas, 0) / pesos;
  return media * data.tasks.done;
}

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
  const tareas = useQuery({ queryKey: ["tasks"], queryFn: api.listTasks });
  const names = new Map((models.data?.models ?? []).map((m) => [m.id, m.name]));
  const nombreModelo = (id: string) => names.get(id) ?? id;

  const proyectosOpciones = data?.proyectos ?? [];
  const modelosOpciones = data ? [...new Set([...data.modelos, ...(modelo ? [modelo] : [])])] : [];
  const filtrado = proyecto !== "" || modelo !== "";
  const sinUso = data !== undefined && data.totals.calls === 0;

  // Ejecuciones: las tareas del periodo con los mismos filtros. La lista llega con las 50 más recientes.
  const inicioPeriodo = Date.now() - days * DIA_MS;
  const ejecuciones: Task[] = (tareas.data ?? []).filter(
    (t) =>
      fechaUtc(t.created_at).getTime() >= inicioPeriodo &&
      (!proyecto || t.project_id === proyecto) &&
      (!modelo || t.model === modelo),
  );
  const totalPaginas = Math.max(1, Math.ceil(ejecuciones.length / FILAS_POR_PAGINA));
  const paginaTabla = Math.min(pagina, totalPaginas);
  const filasTabla = ejecuciones.slice((paginaTabla - 1) * FILAS_POR_PAGINA, paginaTabla * FILAS_POR_PAGINA);

  const tiempo = data ? tiempoComputoSeg(data) : null;
  const primerDia = data?.byDay[0]?.day;
  const ultimoDia = data?.byDay.at(-1)?.day;
  const rango = primerDia && ultimoDia ? `Del ${diaCompleto(primerDia)} al ${diaCompleto(ultimoDia)}` : "";
  const maxModelo = data ? Math.max(0, ...data.byModel.map((r) => r.tokens)) : 0;
  const totalCosto = data ? data.byModel.reduce((s, r) => s + r.cost, 0) : 0;

  return (
    <div className="page-wrap an-pagina">
      <main className="container an-principal">
        <header className="an-cabecera">
          <div className="an-cabecera-texto">
            <p className="an-eyebrow">
              <span>Métricas del sistema</span>
              <span className="an-eyebrow-sep" aria-hidden="true">·</span>
              <span>Instancia local</span>
            </p>
            <h1 className="an-titulo">Analíticas de consumo</h1>
            <p className="an-subtitulo">Métricas de tokens, gasto estimado y tiempo de cómputo en tu servidor.</p>
          </div>
          <div className="an-cabecera-acciones">
            <nav aria-label="Periodo" className="an-segmentado" role="group">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="an-periodo"
                  aria-pressed={days === p}
                  aria-label={`${p} días`}
                  onClick={() => {
                    setDays(p);
                    setPagina(1);
                  }}
                >
                  {p}d
                </button>
              ))}
            </nav>
          </div>
        </header>

        <div className="an-filtros">
          <label className="an-campo">
            <span className="an-campo-etiqueta">Proyecto</span>
            <select className="an-select" value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {proyectosOpciones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="an-campo">
            <span className="an-campo-etiqueta">Modelo</span>
            <select className="an-select" value={modelo} onChange={(e) => setModelo(e.target.value)}>
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
          <section className="an-panel" aria-live="polite">
            <p className="error" role="alert">
              {errorText(query.error)}
            </p>
            <div>
              <button type="button" className="an-boton" onClick={() => void query.refetch()}>
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
            <section className="an-kpis" aria-label="Resumen de consumo">
              <Kpi
                etiqueta="Gasto estimado"
                valor={data.totals.calls > 0 && data.calidad?.sinCoste === data.totals.calls ? "No disponible" : usd(data.totals.cost)}
                pie={`Últimos ${data.days} días`}
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                }
              />
              <Kpi
                etiqueta="Tokens procesados"
                valor={data.totals.calls > 0 && data.calidad?.sinTokens === data.totals.calls ? "No disponible" : compact(data.totals.inputTokens + data.totals.outputTokens)}
                pie={data.totals.calls > 0 && data.calidad?.sinTokens === data.totals.calls ? "El proveedor no informó tokens" : `Prompt ${compact(data.totals.inputTokens)} · Completion ${compact(data.totals.outputTokens)}`}
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                }
              />
              <Kpi
                etiqueta="Tiempo de cómputo"
                valor={formatDuracion(tiempo)}
                pie={
                  data.tasks.done > 0
                    ? `Estimado: ${data.tasks.done} ${data.tasks.done === 1 ? "tarea hecha" : "tareas hechas"}`
                    : "Sin tareas terminadas"
                }
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
              />
            </section>

            {data.calidad && (
              <section className="an-panel" aria-label="Precisión de las métricas">
                <h2 className="an-panel-titulo">Precisión de las métricas</h2>
                <p className="an-panel-sub">{data.calidad.tokensMedidos} registros con tokens medidos · {data.calidad.costesEstimados} con coste estimado por OpenCode.</p>
                <p className="an-panel-sub">{data.calidad.sinTokens} sin tokens disponibles · {data.calidad.sinCoste} sin coste disponible · {data.calidad.historicos} históricos sin precisión identificada.</p>
                <p className="an-panel-sub">Los totales pueden ser parciales. No son facturas del proveedor; un dato ausente se muestra como «—», no como consumo cero.</p>
              </section>
            )}
            <section className="an-panel" aria-labelledby="an-uso-funcion-titulo">
              <div className="an-panel-cabeza">
                <div className="an-panel-texto">
                  <h2 id="an-uso-funcion-titulo" className="an-panel-titulo">Uso de IA por origen</h2>
                  <p className="an-panel-sub">Consumo de modelos separado del chat directo</p>
                </div>
              </div>

              <div className="an-tabla-caja">
                <table className="an-tabla an-uso-tabla" aria-labelledby="an-uso-funcion-titulo">
                  <thead>
                    <tr>
                      <th scope="col">Origen</th>
                      <th scope="col" className="an-numero">Llamadas IA</th>
                      <th scope="col" className="an-numero">Tokens</th>
                      <th scope="col" className="an-numero">Coste IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byType
                      .filter((r) => r.tipo !== "otro" || r.calls > 0)
                      .map((r) => (
                        <tr key={r.tipo}>
                          <th scope="row" data-etiqueta="Origen">
                            <span className="an-uso-nombre">{TIPO_USO[r.tipo].nombre}</span>
                            <span className="an-uso-detalle">{TIPO_USO[r.tipo].detalle}</span>
                          </th>
                          <td data-etiqueta="Llamadas IA" className="an-numero">{compact(r.calls)}</td>
                          <td data-etiqueta="Tokens" className="an-numero">{r.calls > 0 && r.sinTokens === r.calls ? "—" : compact(r.tokens)}</td>
                          <td data-etiqueta="Coste IA" className="an-numero">{r.calls > 0 && r.sinCoste === r.calls ? "—" : usd(r.cost)}</td>
                        </tr>
                      ))}
                    <tr>
                      <th scope="row" data-etiqueta="Origen">
                        <span className="an-uso-nombre">Recomendaciones del chat</span>
                        <span className="an-uso-detalle">Se calculan localmente; no llaman a un modelo.</span>
                      </th>
                      <td data-etiqueta="Llamadas IA" className="an-numero">0</td>
                      <td data-etiqueta="Tokens" className="an-numero">0</td>
                      <td data-etiqueta="Coste IA" className="an-numero">{usd(0)}</td>
                    </tr>
                    <tr>
                      <th scope="row" data-etiqueta="Origen">
                        <span className="an-uso-nombre">Lectura por voz</span>
                        <span className="an-uso-detalle">Usa la voz del navegador; no envía texto a un modelo.</span>
                      </th>
                      <td data-etiqueta="Llamadas IA" className="an-numero">0</td>
                      <td data-etiqueta="Tokens" className="an-numero">0</td>
                      <td data-etiqueta="Coste IA" className="an-numero">{usd(0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="an-nota">
                El contexto y la actualización de la memoria del proyecto se procesan dentro de las tareas del agente. Sus tokens y coste ya están incluidos y no se miden por separado.
              </p>
            </section>

            <section className="an-panel" aria-labelledby="an-volumen-titulo">
              <div className="an-panel-cabeza">
                <div className="an-panel-texto">
                  <h2 id="an-volumen-titulo" className="an-panel-titulo">Volumen de llamadas diarias</h2>
                  <p className="an-panel-sub">{rango ? `${rango} · ${data.days} días` : `${data.days} días`}</p>
                </div>
                <div className="an-leyenda" aria-hidden="true">
                  <span>
                    <i className="an-leyenda-punto is-hoy" />
                    Día actual
                  </span>
                  <span>
                    <i className="an-leyenda-punto" />
                    Otros días
                  </span>
                </div>
              </div>
              <VolumenLlamadas
                data={data.byDay}
                titulo={`Llamadas por día en los últimos ${data.days} días`}
              />
            </section>

            <div className={`an-rejilla${data.budget ? " es-doble" : ""}`}>
              <section className="an-panel" aria-labelledby="an-modelos-titulo">
                <div className="an-panel-cabeza">
                  <div className="an-panel-texto">
                    <h2 id="an-modelos-titulo" className="an-panel-titulo">Distribución por modelo</h2>
                    <p className="an-panel-sub">Consumo agrupado de tokens y coste</p>
                  </div>
                  <span className="an-chip">{data.byModel.length} activos</span>
                </div>

                {data.byModel.length === 0 ? (
                  <p className="muted-note">Todavía no hay uso en este periodo.</p>
                ) : (
                  <ul className="an-modelos" aria-label="Uso por modelo">
                    {data.byModel.map((r) => {
                      const proporcion = totalCosto > 0 ? r.cost / totalCosto : maxModelo > 0 ? r.tokens / maxModelo : 0;
                      return (
                        <li key={r.model} className="an-modelo">
                          <div className="an-modelo-linea">
                            <span className="an-modelo-nombre" title={r.model}>
                              {nombreModelo(r.model)}
                            </span>
                            <span className="an-modelo-valor">
                              {compact(r.tokens)} tok • {usd(r.cost)}
                            </span>
                          </div>
                          <div className="an-pista" aria-hidden="true">
                            <span className="an-pista-relleno" style={{ width: `${Math.round(proporcion * 100)}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {data.budget && (
                <section className="an-panel" aria-labelledby="an-presupuesto-titulo">
                  <div className="an-panel-cabeza">
                    <div className="an-panel-texto">
                      <h2 id="an-presupuesto-titulo" className="an-panel-titulo">Presupuesto del mes</h2>
                      <p className="an-panel-sub">Mes calendario en UTC</p>
                    </div>
                    <span
                      className={`badge ${data.budget.status === "ok" ? "badge-ok" : data.budget.status === "alerta" ? "badge-signal" : "badge-error"}`}
                    >
                      {BUDGET_LABEL[data.budget.status]}
                    </span>
                  </div>
                  <div className="budget">
                    <div className="budget-row">
                      <span>
                        {usd(data.budget.spentUsd)} de {usd(data.budget.monthlyUsd)}
                      </span>
                      <span className={`budget-status is-${data.budget.status}`}>
                        {data.budget.percent} %
                      </span>
                    </div>
                    <div className="budget-track" aria-hidden="true">
                      <div
                        className={`budget-fill is-${data.budget.status}`}
                        style={{ width: `${Math.min(data.budget.percent, 100)}%` }}
                      />
                    </div>
                    <p className="an-nota">Aviso al {data.budget.alertPercent} %.</p>
                  </div>
                </section>
              )}
            </div>

            <section className="an-panel" aria-labelledby="an-ejecuciones-titulo">
              <div className="an-panel-cabeza">
                <div className="an-panel-texto">
                  <h2 id="an-ejecuciones-titulo" className="an-panel-titulo">Ejecuciones recientes</h2>
                  <p className="an-panel-sub">Tareas del periodo, de las 50 más recientes</p>
                </div>
                <button
                  type="button"
                  className="an-boton"
                  disabled
                  title="La exportación a CSV todavía no está disponible en este servidor."
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Exportar CSV
                </button>
              </div>

              <div className="an-tabla-caja">
                <table className="an-tabla" aria-labelledby="an-ejecuciones-titulo">
                  <thead>
                    <tr>
                      <th scope="col">Marca temporal</th>
                      <th scope="col">Modelo / agente</th>
                      <th scope="col" className="an-numero">Tokens</th>
                      <th scope="col" className="an-numero">Duración</th>
                      <th scope="col" className="an-numero">Coste estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasTabla.length === 0 && (
                      <tr>
                        <td colSpan={5} className="an-tabla-vacia">
                          Sin ejecuciones en este periodo.
                        </td>
                      </tr>
                    )}
                    {filasTabla.map((t) => {
                      const seg = duracionSeg(t);
                      const duracionTexto = t.status === "running" ? "en curso" : formatDuracion(seg);
                      return (
                        <tr key={t.id}>
                          <th scope="row" data-etiqueta="Marca temporal">
                            {cuando(t.started_at ?? t.created_at)}
                          </th>
                          <td data-etiqueta="Modelo / agente" className="an-celda-modelo">
                            <span className="an-modelo-nombre">{nombreModelo(t.model)}</span>
                            <span className="an-chip">{nombreAgente(agenteDeTarea(t))}</span>
                          </td>
                          <td data-etiqueta="Tokens" className="an-numero" title="Tokens informados por el proveedor; los registros antiguos no tienen precisión identificada">
                            {(() => {
                              const uso = data.byTask?.find(u => u.taskId === t.id);
                              return uso && uso.calls > uso.sinTokens ? <>{compact(uso.tokens)}<small> {uso.historicos ? "histórico" : uso.sinTokens ? "parcial" : "medidos"}</small></> : "—";
                            })()}
                          </td>
                          <td data-etiqueta="Duración" className="an-numero">
                            {duracionTexto}
                          </td>
                          <td data-etiqueta="Coste estimado" className="an-numero" title="Coste informado por OpenCode; no es una factura de OpenAI o del proveedor">
                            {(() => {
                              const uso = data.byTask?.find(u => u.taskId === t.id);
                              return uso && uso.calls > uso.sinCoste ? <>{usd(uso.cost)}<small> {uso.historicos ? "histórico" : uso.sinCoste ? "parcial" : "estimado"}</small></> : "—";
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="an-pie-tabla">
                <span className="an-pie-estado">
                  {ejecuciones.length === 0
                    ? "Sin ejecuciones"
                    : `Mostrando ${(paginaTabla - 1) * FILAS_POR_PAGINA + 1}–${Math.min(paginaTabla * FILAS_POR_PAGINA, ejecuciones.length)} de ${ejecuciones.length} ejecuciones`}
                </span>
                <Paginacion
                  pagina={paginaTabla}
                  total={ejecuciones.length}
                  porPagina={FILAS_POR_PAGINA}
                  onCambio={setPagina}
                />
              </div>
              <p className="an-nota">
                El servidor no entrega tokens ni coste por tarea. Los totales de arriba sí vienen del uso registrado.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({
  etiqueta,
  valor,
  pie,
  icono,
}: {
  etiqueta: string;
  valor: string;
  pie?: ReactNode;
  icono?: ReactNode;
}) {
  return (
    <div className="an-kpi">
      <div className="an-kpi-cabeza">
        <span className="an-kpi-etiqueta">{etiqueta}</span>
        {icono && (
          <span className="an-kpi-icono" aria-hidden="true">
            {icono}
          </span>
        )}
      </div>
      <div className="an-kpi-valor">{valor}</div>
      {pie && <div className="an-kpi-pie">{pie}</div>}
    </div>
  );
}
