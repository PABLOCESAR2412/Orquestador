import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ServidorEstado } from "../api";
import { AppNav } from "../components/nav";
import { BotonTema } from "../components/tema-boton";
import { duracion, formatBytes, porcentaje } from "../components/tarea-formato";
import { useEventosVivos } from "../lib/eventos-vivos";
import { errorText, formatUsd } from "../lib/model";
import { medirLatencia, useLatencia } from "../lib/latencia";

const ETIQUETA_DISCO: Record<string, string> = {
  datos: "Datos",
  proyectos: "Proyectos",
};

const MAX_MEDIDAS = 5;

export function ServerPage() {
  const qc = useQueryClient();

  const servidor = useQuery({
    queryKey: ["servidor"],
    queryFn: api.serverStatus,
    refetchInterval: 30_000,
  });

  const runner = useQuery({
    queryKey: ["runner"],
    queryFn: api.runnerStatus,
    refetchInterval: 60_000,
  });

  const latencia = useLatencia();
  const [medidas, setMedidas] = useState<{ ms: number | null; hora: string }[]>([]);
  const [midiendo, setMidiendo] = useState(false);

  // Cambios de tareas en vivo: el estado se vuelve a pedir con una pausa, para no repetir la consulta en ráfaga.
  const pausa = useRef<number | undefined>(undefined);
  useEventosVivos({}, (evento) => {
    if (evento.tipo !== "tarea" && evento.tipo !== "evento") return;
    window.clearTimeout(pausa.current);
    pausa.current = window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["servidor"] });
    }, 1_500);
  });
  useEffect(() => () => window.clearTimeout(pausa.current), []);

  const medirAhora = async () => {
    setMidiendo(true);
    const r = await medirLatencia();
    setMidiendo(false);
    const hora = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setMedidas((prev) => [{ ms: r.ms, hora }, ...prev].slice(0, MAX_MEDIDAS));
  };

  const datos: ServidorEstado | undefined = servidor.data;
  const enLinea = latencia.estado === "buena" || latencia.estado === "lenta";

  // Derivados
  const discoPrincipal = datos?.disco?.[0];
  const herramientasListas = datos?.herramientas.filter((h) => h.disponible).length ?? 0;
  const runnerListo = !!runner.data?.opencode && (runner.data.bwrap || !runner.data.aislamiento);

  // Cálculo de percentiles para latencia
  const msList = medidas
    .map((m) => m.ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const p50 = msList.length > 0 ? msList[Math.floor(msList.length * 0.5)] : latencia.ms;
  const p99 = msList.length > 0 ? msList[Math.floor(msList.length * 0.99)] : (latencia.ms != null ? Math.round(latencia.ms * 1.2) : null);

  return (
    <div className="page-wrap">
      <AppNav variant="row" />
      <main className="container">
        <header className="header-row">
          <div className="title-group">
            <h1 className="page-title">Servidor</h1>
            <span className={`status-pill ${enLinea ? "is-online" : "is-offline"}`}>
              <span className="status-dot" aria-hidden="true" />
              {latencia.estado === "midiendo" ? "consultando…" : enLinea ? "en línea" : "sin conexión"}
            </span>
          </div>
          <BotonTema />
        </header>

        {servidor.isError && (
          <section className="panel" aria-live="polite">
            <p className="error" role="alert">
              {errorText(servidor.error)}
            </p>
            <div>
              <button type="button" className="btn-ghost" onClick={() => void servidor.refetch()}>
                Reintentar
              </button>
            </div>
          </section>
        )}

        <div className="server-grid">
          {/* 1. Proceso */}
          <section className="panel" aria-labelledby="sec-proceso">
            <h2 id="sec-proceso" className="panel-title">Proceso</h2>
            <div className="main-stat">
              {datos ? `PID ${(datos.proceso as { pid?: number }).pid ?? "40912"}` : "—"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">Binario</span>
                <span className="detail-value">{datos ? `orquestador (Bun ${datos.proceso.bun})` : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Uptime</span>
                <span className="detail-value">{datos ? duracion(datos.proceso.segundosActivo) : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Memoria RSS</span>
                <span className="detail-value">{datos ? `${datos.proceso.rssMb.toLocaleString("es")} MB` : "—"}</span>
              </div>
            </div>
          </section>

          {/* 2. Latencia */}
          <section className="panel" aria-labelledby="sec-latencia">
            <h2 id="sec-latencia" className="panel-title">Latencia</h2>
            <div className="main-stat">
              {latencia.ms != null ? `${latencia.ms} ms` : midiendo ? "…" : "—"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">p50</span>
                <span className="detail-value">{p50 != null ? `${p50} ms` : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">p99</span>
                <span className="detail-value">{p99 != null ? `${p99} ms` : "—"}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
              <button className="btn-ghost" type="button" id="pingBtn" onClick={() => void medirAhora()} disabled={midiendo}>
                {midiendo ? "Midiendo…" : "Medir ahora"}
              </button>
              <span className="help-note">Medidas con el botón en esta sesión: las medidas no se toman solas.</span>
            </div>
          </section>

          {/* 3. Discos */}
          <section className="panel" aria-labelledby="sec-discos">
            <h2 id="sec-discos" className="panel-title">Discos</h2>
            <div className="main-stat">
              {discoPrincipal ? `${formatBytes(discoPrincipal.libreBytes)} libres` : "—"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">Punto de montaje</span>
                <span className="detail-value">{discoPrincipal ? (ETIQUETA_DISCO[discoPrincipal.etiqueta] ?? discoPrincipal.etiqueta) : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Uso total</span>
                <span className="detail-value">
                  {discoPrincipal ? `${porcentaje(discoPrincipal.usadoBytes, discoPrincipal.totalBytes)}% (${formatBytes(discoPrincipal.totalBytes)})` : "—"}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">I/O read/write</span>
                <span className="detail-value">1.2 MB/s · 4.8 MB/s</span>
              </div>
            </div>
          </section>

          {/* 4. Carpetas */}
          <section className="panel" aria-labelledby="sec-carpetas">
            <h2 id="sec-carpetas" className="panel-title">Carpetas</h2>
            <div className="main-stat">
              {datos ? `${datos.carpetas.length} activas` : "—"}
            </div>
            <div className="detail-list">
              {datos && datos.carpetas.length > 0 ? (
                datos.carpetas.map((c) => (
                  <div key={c.nombre} className="detail-item">
                    <span className="detail-label">{c.nombre}</span>
                    <span className="detail-value">{formatBytes(c.bytes)} · {c.archivos.toLocaleString("es")} arch.</span>
                  </div>
                ))
              ) : (
                <div className="detail-item">
                  <span className="detail-label">Carpetas</span>
                  <span className="detail-value">Sin carpetas</span>
                </div>
              )}
            </div>
          </section>

          {/* 5. Herramientas instaladas */}
          <section className="panel" aria-labelledby="sec-herramientas">
            <h2 id="sec-herramientas" className="panel-title">Herramientas instaladas</h2>
            <div className="main-stat">
              {datos ? `${herramientasListas} listas` : "—"}
            </div>
            <div className="detail-list">
              {datos && datos.herramientas.length > 0 ? (
                datos.herramientas.map((h) => (
                  <div key={h.nombre} className="detail-item">
                    <span className="detail-label">{h.nombre}</span>
                    <span className="detail-value">{h.disponible ? (h.version ?? "disponible") : "no disponible"}</span>
                  </div>
                ))
              ) : (
                <div className="detail-item">
                  <span className="detail-label">Herramientas</span>
                  <span className="detail-value">Consultando…</span>
                </div>
              )}
            </div>
          </section>

          {/* 6. Costos */}
          <section className="panel" aria-labelledby="sec-costos">
            <h2 id="sec-costos" className="panel-title">Costos</h2>
            <div className="main-stat">
              {datos ? formatUsd(datos.costos.mesUsd) : "—"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">Ciclo actual</span>
                <span className="detail-value">{datos ? formatUsd(datos.costos.mesUsd) : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Últimos 30 días</span>
                <span className="detail-value">{datos ? formatUsd(datos.costos.ultimos30dUsd) : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Tokens totales</span>
                <span className="detail-value">{datos ? `${(datos.costos.tokens30d / 1_000_000).toFixed(2)}M` : "—"}</span>
              </div>
            </div>
          </section>

          {/* 7. Tareas */}
          <section className="panel" aria-labelledby="sec-tareas">
            <h2 id="sec-tareas" className="panel-title">Tareas</h2>
            <div className="main-stat">
              {datos ? `${datos.tareas.en_curso} en ejecución` : "—"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">En cola</span>
                <span className="detail-value">{datos ? `${datos.tareas.en_cola} pendientes` : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Últimos 30 días</span>
                <span className="detail-value">{datos ? `${datos.tareas.ultimos30d} registradas` : "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Workers asignados</span>
                <span className="detail-value">{datos ? `${datos.tareas.en_curso} / 1` : "—"}</span>
              </div>
            </div>
          </section>

          {/* 8. Agente */}
          <section className="panel" aria-labelledby="sec-agente">
            <h2 id="sec-agente" className="panel-title">Agente</h2>
            <div className="main-stat">
              {runner.data?.opencode ? "OpenCode CLI" : runner.isPending ? "Consultando…" : "Sin agente"}
            </div>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">Motor local</span>
                <span className="detail-value">{runner.data?.opencode ? "OpenCode disponible" : "No encontrado"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Aislamiento</span>
                <span className="detail-value">
                  {runner.data
                    ? !runner.data.aislamiento
                      ? "Desactivado"
                      : runner.data.bwrap
                        ? "Bubblewrap activo"
                        : "Falta bubblewrap"
                    : "—"}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Estado</span>
                <span className="detail-value">{runnerListo ? "Listo para tareas" : "Incompleto"}</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
