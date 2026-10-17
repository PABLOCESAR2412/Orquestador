import { useState, useMemo, type ReactNode } from "react";
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

export function parsearModelo(id: string, nombreCatalogo?: string): { nombre: string; proveedor: string } {
  let proveedor = "";
  let base = id;

  if (id.includes("/")) {
    const partes = id.split("/");
    proveedor = partes[0];
    base = partes.slice(1).join("/");
  }

  // Si tenemos un nombre de catálogo amigable que no sea idéntico al ID crudo
  let nombre = nombreCatalogo && nombreCatalogo !== id && !nombreCatalogo.includes("/") ? nombreCatalogo : base;

  const provMap: Record<string, string> = {
    google: "Google",
    opencode: "OpenCode",
    codex: "Codex",
    openai: "OpenAI",
    groq: "Groq",
    nvidia: "NVIDIA",
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
  };
  const provKey = proveedor.toLowerCase();
  const proveedorTag = provMap[provKey] || (proveedor ? proveedor.toUpperCase() : "Modelo");

  // Formato legible para nombres de modelo con guiones
  if (nombre.includes("-") || nombre.includes("_") || /^[a-z0-9]/.test(nombre)) {
    nombre = nombre
      .replace(/[-_]/g, " ")
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\bClaude\b/i, "Claude")
      .replace(/\bGpt\b/i, "GPT")
      .replace(/\bGemini\b/i, "Gemini")
      .replace(/\bArgon\b/i, "Argon");
  }

  return { nombre, proveedor: proveedorTag };
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

const TIPO_USO_JEV: Record<"recomendaciones_chat" | "memoria_proyecto" | "clasificacion_tarea" | "prueba_conexion", { nombre: string; detalle: string }> = {
  recomendaciones_chat: { nombre: "Recomendaciones del chat · Jev", detalle: "Ordena las sugerencias locales según los últimos mensajes." },
  memoria_proyecto: { nombre: "Memoria del proyecto · Jev", detalle: "Puntúa si la propuesta será útil en futuras tareas." },
  clasificacion_tarea: { nombre: "Clasificación de tareas · Jev", detalle: "Sugiere una categoría; no elige el modelo ni ejecuta acciones." },
  prueba_conexion: { nombre: "Pruebas de conexión · Jev", detalle: "Evaluaciones mínimas iniciadas desde Ajustes." },
};

export function tiempoComputoSeg(data: Analytics): number | null {
  const medidos = data.byModel.filter((m) => m.duracionMediaSeg !== null && m.tareas > 0);
  const pesos = medidos.reduce((s, m) => s + m.tareas, 0);
  if (pesos === 0 || data.tasks.done === 0) return null;
  const media = medidos.reduce((s, m) => s + (m.duracionMediaSeg ?? 0) * m.tareas, 0) / pesos;
  return media * data.tasks.done;
}

export function AnalyticsPage() {
  const [pestana, setPestana] = useState<"agentes" | "telo">("agentes");
  const [vistaEjecuciones, setVistaEjecuciones] = useState<"modelo" | "historial">("modelo");
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
  const names = useMemo(() => new Map((models.data?.models ?? []).map((m) => [m.id, m.name])), [models.data]);
  const nombreModelo = (id: string) => names.get(id) ?? id;

  const proyectosOpciones = data?.proyectos ?? [];
  const modelosOpciones = data ? [...new Set([...data.modelos, ...(modelo ? [modelo] : [])])] : [];
  const filtrado = proyecto !== "" || modelo !== "";
  const sinUso = data !== undefined && data.totals.calls === 0;

  // Ejecuciones de tareas en el periodo
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

  // Totales de uso interno de Telo (Jev)
  const jevTotales = useMemo(() => {
    const items = data?.usoJev ?? [];
    const llamadas = items.reduce((s, r) => s + r.calls, 0);
    const tokens = items.reduce((s, r) => s + r.tokens, 0);
    const clasificaciones = items.find((r) => r.tipo === "clasificacion_tarea")?.calls ?? 0;
    const memorias = items.find((r) => r.tipo === "memoria_proyecto")?.calls ?? 0;
    return { llamadas, tokens, clasificaciones, memorias };
  }, [data?.usoJev]);

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

        {/* Pestañas de separación: Modelos y Agentes vs Consumo interno Telo */}
        <nav aria-label="Secciones de analíticas" className="an-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-agentes"
            aria-selected={pestana === "agentes"}
            aria-controls="panel-agentes"
            className={`an-tab${pestana === "agentes" ? " is-activa" : ""}`}
            onClick={() => setPestana("agentes")}
          >
            Modelos y Agentes
          </button>
          <button
            type="button"
            role="tab"
            id="tab-telo"
            aria-selected={pestana === "telo"}
            aria-controls="panel-telo"
            className={`an-tab${pestana === "telo" ? " is-activa" : ""}`}
            onClick={() => setPestana("telo")}
          >
            Consumo interno de Telo (Jev / Sistema)
          </button>
        </nav>

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
              {modelosOpciones.map((id) => {
                const parsed = parsearModelo(id, nombreModelo(id));
                return (
                  <option key={id} value={id}>
                    {parsed.nombre} ({parsed.proveedor})
                  </option>
                );
              })}
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

        {data && pestana === "agentes" && (
          <div id="panel-agentes" role="tabpanel" aria-labelledby="tab-agentes" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
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
                <p className="an-panel-sub">{data.calidad.tokensMedidos} registros con tokens medidos · {data.calidad.costesEstimados} con coste estimado (Google/OpenCode).</p>
                <p className="an-panel-sub">{data.calidad.sinTokens} sin tokens disponibles · {data.calidad.sinCoste} sin coste disponible · {data.calidad.historicos} históricos sin precisión identificada.</p>
                <p className="an-panel-sub">Los totales pueden ser parciales según la respuesta de cada proveedor. No son facturas; un dato ausente se muestra como «—».</p>
              </section>
            )}

            <section className="an-panel" aria-labelledby="an-uso-funcion-titulo">
              <div className="an-panel-cabeza">
                <div className="an-panel-texto">
                  <h2 id="an-uso-funcion-titulo" className="an-panel-titulo">Uso de IA por origen de agente</h2>
                  <p className="an-panel-sub">Consumo de modelos en conversaciones de chat y tareas ejecutadas</p>
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
                  </tbody>
                </table>
              </div>
              <p className="an-nota">
                Las llamadas de los agentes se registran en cada turno. Para consultar el consumo interno de soporte (Jev y clasificador), consulta la pestaña «Consumo interno de Telo».
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
                      const parsed = parsearModelo(r.model, nombreModelo(r.model));
                      return (
                        <li key={r.model} className="an-modelo">
                          <div className="an-modelo-linea">
                            <div className="an-modelo-ident">
                              <span className="an-modelo-nombre" title={r.model}>
                                {parsed.nombre}
                              </span>
                              <span className="an-proveedor-chip">
                                {parsed.proveedor}
                              </span>
                            </div>
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
                  <p className="an-panel-sub">
                    {vistaEjecuciones === "modelo"
                      ? "Resumen acumulado por modelo sin repeticiones"
                      : "Historial detallado de tareas del periodo"}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className="an-vista-toggle" role="group" aria-label="Modo de visualización de ejecuciones">
                    <button
                      type="button"
                      className={`an-vista-btn${vistaEjecuciones === "modelo" ? " is-activo" : ""}`}
                      onClick={() => setVistaEjecuciones("modelo")}
                    >
                      Por modelo
                    </button>
                    <button
                      type="button"
                      className={`an-vista-btn${vistaEjecuciones === "historial" ? " is-activo" : ""}`}
                      onClick={() => setVistaEjecuciones("historial")}
                    >
                      Historial de tareas
                    </button>
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
                    CSV
                  </button>
                </div>
              </div>

              {vistaEjecuciones === "modelo" ? (
                <div className="an-tabla-caja">
                  <table className="an-tabla" aria-labelledby="an-ejecuciones-titulo">
                    <thead>
                      <tr>
                        <th scope="col">Modelo</th>
                        <th scope="col" className="an-numero">Tareas completadas</th>
                        <th scope="col" className="an-numero">Tokens totales</th>
                        <th scope="col" className="an-numero">Duración media</th>
                        <th scope="col" className="an-numero">Coste acumulado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byModel.length === 0 && (
                        <tr>
                          <td colSpan={5} className="an-tabla-vacia">
                            Sin modelos registrados en este periodo.
                          </td>
                        </tr>
                      )}
                      {data.byModel.map((m) => {
                        const parsed = parsearModelo(m.model, nombreModelo(m.model));
                        return (
                          <tr key={m.model}>
                            <th scope="row" data-etiqueta="Modelo" className="an-celda-modelo">
                              <span className="an-modelo-nombre">{parsed.nombre}</span>
                              <span className="an-proveedor-chip">{parsed.proveedor}</span>
                            </th>
                            <td data-etiqueta="Tareas completadas" className="an-numero">
                              {m.tareas > 0 ? `${m.tareas} ${m.tareas === 1 ? "tarea" : "tareas"}` : "Solo chat / directa"}
                            </td>
                            <td data-etiqueta="Tokens totales" className="an-numero">
                              {compact(m.tokens)}
                            </td>
                            <td data-etiqueta="Duración media" className="an-numero">
                              {formatDuracion(m.duracionMediaSeg)}
                            </td>
                            <td data-etiqueta="Coste acumulado" className="an-numero">
                              {usd(m.cost)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div className="an-tabla-caja">
                    <table className="an-tabla" aria-labelledby="an-ejecuciones-titulo">
                      <thead>
                        <tr>
                          <th scope="col">Tarea</th>
                          <th scope="col">Fecha</th>
                          <th scope="col">Modelo</th>
                          <th scope="col" className="an-numero">Tokens</th>
                          <th scope="col" className="an-numero">Duración</th>
                          <th scope="col" className="an-numero">Coste</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasTabla.length === 0 && (
                          <tr>
                            <td colSpan={6} className="an-tabla-vacia">
                              Sin tareas en este periodo.
                            </td>
                          </tr>
                        )}
                        {filasTabla.map((t) => {
                          const seg = duracionSeg(t);
                          const duracionTexto = t.status === "running" ? "en curso" : formatDuracion(seg);
                          const parsed = parsearModelo(t.model, nombreModelo(t.model));
                          const tituloTarea = t.title || t.prompt?.slice(0, 50) || "Tarea sin título";
                          return (
                            <tr key={t.id}>
                              <th scope="row" data-etiqueta="Tarea">
                                <div className="an-celda-tarea">
                                  <span className="an-tarea-titulo" title={t.title || t.prompt}>
                                    {tituloTarea}
                                  </span>
                                  <span className={`an-badge-status is-${t.status}`}>
                                    {t.status}
                                  </span>
                                </div>
                              </th>
                              <td data-etiqueta="Fecha" style={{ whiteSpace: "nowrap" }}>
                                {cuando(t.started_at ?? t.created_at)}
                              </td>
                              <td data-etiqueta="Modelo" className="an-celda-modelo">
                                <span className="an-modelo-nombre">{parsed.nombre}</span>
                                <span className="an-proveedor-chip">{parsed.proveedor}</span>
                                <span className="an-chip" style={{ marginLeft: "6px" }}>{nombreAgente(agenteDeTarea(t))}</span>
                              </td>
                              <td data-etiqueta="Tokens" className="an-numero" title="Tokens informados por el proveedor">
                                {(() => {
                                  const uso = data.byTask?.find((u) => u.taskId === t.id);
                                  return uso && uso.calls > uso.sinTokens ? (
                                    <>
                                      {compact(uso.tokens)}
                                      <small> {uso.historicos ? "histórico" : uso.sinTokens ? "parcial" : "medidos"}</small>
                                    </>
                                  ) : (
                                    "—"
                                  );
                                })()}
                              </td>
                              <td data-etiqueta="Duración" className="an-numero">
                                {duracionTexto}
                              </td>
                              <td data-etiqueta="Coste" className="an-numero" title="Coste estimado por el sistema">
                                {(() => {
                                  const uso = data.byTask?.find((u) => u.taskId === t.id);
                                  return uso && uso.calls > uso.sinCoste ? (
                                    <>
                                      {usd(uso.cost)}
                                      <small> {uso.historicos ? "histórico" : uso.sinCoste ? "parcial" : "estimado"}</small>
                                    </>
                                  ) : (
                                    "—"
                                  );
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
                </>
              )}
            </section>
          </div>
        )}

        {data && pestana === "telo" && (
          <div id="panel-telo" role="tabpanel" aria-labelledby="tab-telo" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <section className="an-kpis" aria-label="Resumen de consumo interno de Telo">
              <Kpi
                etiqueta="Llamadas internas (Jev)"
                valor={compact(jevTotales.llamadas)}
                pie={`Últimos ${data.days} días`}
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                }
              />
              <Kpi
                etiqueta="Tokens procesados internamente"
                valor={compact(jevTotales.tokens)}
                pie="TypeSafe / Jev (Razonamiento de soporte)"
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                }
              />
              <Kpi
                etiqueta="Tareas y memorias asistidas"
                valor={`${jevTotales.clasificaciones + jevTotales.memorias}`}
                pie={`${jevTotales.clasificaciones} categorizadas · ${jevTotales.memorias} memorias`}
                icono={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                }
              />
            </section>

            <section className="an-panel" aria-labelledby="an-consumo-telo-titulo">
              <div className="an-panel-cabeza">
                <div className="an-panel-texto">
                  <h2 id="an-consumo-telo-titulo" className="an-panel-titulo">Detalle del consumo interno del sistema</h2>
                  <p className="an-panel-sub">
                    Operaciones de soporte automatizado que Telo realiza en segundo plano para organizar proyectos
                  </p>
                </div>
                <span className="an-chip">Consumo de sistema</span>
              </div>

              <div className="an-tabla-caja">
                <table className="an-tabla an-uso-tabla" aria-labelledby="an-consumo-telo-titulo">
                  <thead>
                    <tr>
                      <th scope="col">Función interna</th>
                      <th scope="col">Modelo / Motor</th>
                      <th scope="col" className="an-numero">Llamadas</th>
                      <th scope="col" className="an-numero">Tokens procesados</th>
                      <th scope="col" className="an-numero">Coste a tu API</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.usoJev ?? []).map((r) => (
                      <tr key={r.tipo}>
                        <th scope="row" data-etiqueta="Función interna">
                          <span className="an-uso-nombre">{TIPO_USO_JEV[r.tipo].nombre}</span>
                          <span className="an-uso-detalle">{TIPO_USO_JEV[r.tipo].detalle}</span>
                        </th>
                        <td data-etiqueta="Modelo / Motor">
                          <span className="an-modelo-nombre">Jev (gpt-4o-mini)</span>
                          <span className="an-proveedor-chip">TypeSafe</span>
                        </td>
                        <td data-etiqueta="Llamadas" className="an-numero">{compact(r.calls)}</td>
                        <td data-etiqueta="Tokens procesados" className="an-numero">{compact(r.tokens)}</td>
                        <td data-etiqueta="Coste a tu API" className="an-numero">
                          <span style={{ color: "var(--ok, #10b981)", fontWeight: 500 }}>US$ 0.00 (Incluido)</span>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" data-etiqueta="Función interna">
                        <span className="an-uso-nombre">Lectura por voz</span>
                        <span className="an-uso-detalle">Síntesis local del navegador (Web Speech API); no envía datos al exterior.</span>
                      </th>
                      <td data-etiqueta="Modelo / Motor">
                        <span className="an-modelo-nombre">Voz del navegador</span>
                        <span className="an-proveedor-chip">Local</span>
                      </td>
                      <td data-etiqueta="Llamadas" className="an-numero">0</td>
                      <td data-etiqueta="Tokens procesados" className="an-numero">0</td>
                      <td data-etiqueta="Coste a tu API" className="an-numero">
                        <span style={{ color: "var(--ok, #10b981)", fontWeight: 500 }}>US$ 0.00 (Local)</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="an-nota">
                Las llamadas internas de Jev se procesan de forma independiente a la cuota de tus agentes de programación (Google Gemini, OpenCode, Codex, Groq o NVIDIA). TypeSafe informa los tokens de entrada y salida para transparencia técnica sin generar cargos a tus claves personales de modelo.
              </p>
            </section>
          </div>
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
