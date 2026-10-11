import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ServidorEstado } from "../api";
import { useShell } from "../components/shell-context";
import { cuando, duracion, formatBytes, porcentaje } from "../components/tarea-formato";
import { useEventosVivos } from "../lib/eventos-vivos";
import { errorText, formatUsd } from "../lib/model";
import { medirLatencia, useLatencia, type EstadoLatencia } from "../lib/latencia";
import "../styles-trabajo.css";

const TEXTO_LATENCIA: Record<EstadoLatencia, string> = {
  midiendo: "Midiendo…",
  buena: "Buena",
  lenta: "Lenta",
  sin_conexion: "Sin conexión",
};

const ETIQUETA_DISCO: Record<"datos" | "proyectos", string> = {
  datos: "Datos",
  proyectos: "Proyectos",
};

const MAX_MEDIDAS = 5;

export function ServerPage() {
  const qc = useQueryClient();
  const { toggleDrawer } = useShell();

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

  return (
    <main className="page tr-pagina">
      <header className="page-head">
        <div className="page-title-row">
          <button type="button" className="ghost menu-btn" aria-label="Abrir menú" onClick={toggleDrawer}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
          <div>
            <h1>Servidor</h1>
            <p className="page-desc">
              Proceso, disco, costos y herramientas del servidor. Se actualiza cada 30 segundos y cuando cambian las tareas.
            </p>
          </div>
        </div>
        <div className="status-pill-head">
          <span className={`status-pill ${enLinea ? "is-online" : "is-offline"}`}>
            <span className="pill-dot" aria-hidden="true" />
            {latencia.estado === "midiendo" ? "Consultando…" : enLinea ? "En línea" : "Sin conexión"}
          </span>
        </div>
      </header>

      {servidor.isPending && <p className="muted-note">Consultando el servidor…</p>}

      {servidor.isError && (
        <section className="panel" aria-live="polite">
          <p className="error" role="alert">
            {errorText(servidor.error)}
          </p>
          <div>
            <button type="button" className="ghost" onClick={() => void servidor.refetch()}>
              Reintentar
            </button>
          </div>
        </section>
      )}

      {datos && (
        <p className="muted-note">Última consulta: {cuando(datos.generado)}</p>
      )}

      <div className="status-grid">
        {datos && (
          <section className="panel status-card" aria-labelledby="servidor-proceso">
            <div className="card-top">
              <h2 id="servidor-proceso">Proceso</h2>
            </div>
            <div className="status-meta-list">
              <Fila etiqueta="Activo desde" valor={cuando(datos.proceso.arrancado)} />
              <Fila etiqueta="Tiempo activo" valor={duracion(datos.proceso.segundosActivo)} />
              <Fila etiqueta="Versión de Bun" valor={datos.proceso.bun} />
              <Fila etiqueta="Memoria" valor={`${datos.proceso.rssMb.toLocaleString("es")} MB`} />
              <Fila etiqueta="Plataforma" valor={datos.proceso.plataforma} />
            </div>
          </section>
        )}

        <section className="panel status-card" aria-labelledby="servidor-latencia">
          <div className="card-top">
            <h2 id="servidor-latencia">Latencia</h2>
            <span className={`badge ${latencia.estado === "buena" ? "badge-ok" : "badge-neutral"}`}>
              {TEXTO_LATENCIA[latencia.estado]}
            </span>
          </div>
          <p className="muted-note">
            La mide este navegador con una consulta a /api/health cada 30 segundos.
          </p>
          <div className="status-meta-list">
            <Fila
              etiqueta="Última medición"
              valor={latencia.ms === null ? "Sin respuesta" : `${latencia.ms} ms`}
            />
          </div>
          <div className="tr-acciones-fila">
            <button type="button" className="ghost" onClick={() => void medirAhora()} disabled={midiendo}>
              {midiendo ? "Midiendo…" : "Medir ahora"}
            </button>
          </div>
          {medidas.length > 0 && (
            <div>
              <span className="muted-note">Medidas con el botón en esta sesión</span>
              <ol className="medidas-lista">
                {medidas.map((m, i) => (
                  <li key={`${m.hora}-${i}`}>
                    <span className="medida-hora">{m.hora}</span>
                    <span>{m.ms === null ? "Sin respuesta" : `${m.ms} ms`}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {datos && (
          <section className="panel status-card status-card-wide" aria-labelledby="servidor-discos">
            <div className="card-top">
              <h2 id="servidor-discos">Discos</h2>
            </div>
            <div className="discos-lista">
              {datos.disco.map((d) => {
                const pct = porcentaje(d.usadoBytes, d.totalBytes);
                const nombre = ETIQUETA_DISCO[d.etiqueta] ?? d.etiqueta;
                return (
                  <div key={d.etiqueta} className="disco">
                    <div className="disco-cabecera">
                      <span className="disco-nombre">{nombre}</span>
                      <span className="disco-porcentaje">{pct} % usado</span>
                    </div>
                    <div
                      className="barra"
                      role="progressbar"
                      aria-label={`Uso del disco ${nombre}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-valuetext={`${pct} % usado`}
                    >
                      <span className={`barra-relleno${pct >= 90 ? " is-alerta" : ""}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted-note">
                      {formatBytes(d.usadoBytes)} de {formatBytes(d.totalBytes)} · {formatBytes(d.libreBytes)} libres
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {datos && (
          <section className="panel status-card" aria-labelledby="servidor-carpetas">
            <div className="card-top">
              <h2 id="servidor-carpetas">Carpetas</h2>
            </div>
            <ul className="lista-simple">
              {datos.carpetas.map((c) => (
                <li key={c.nombre} className="lista-simple-fila">
                  <span className="lista-simple-nombre">{c.nombre}</span>
                  <span className="muted-note">
                    {formatBytes(c.bytes)} · {c.archivos.toLocaleString("es")} {c.archivos === 1 ? "archivo" : "archivos"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {datos && (
          <section className="panel status-card" aria-labelledby="servidor-herramientas">
            <div className="card-top">
              <h2 id="servidor-herramientas">Herramientas instaladas</h2>
            </div>
            <div className="status-meta-list">
              {datos.herramientas.map((h) => (
                <Fila
                  key={h.nombre}
                  etiqueta={h.nombre}
                  valor={h.disponible ? (h.version ?? "Versión no disponible") : "No encontrado"}
                />
              ))}
            </div>
          </section>
        )}

        {datos && (
          <section className="panel status-card" aria-labelledby="servidor-costos">
            <div className="card-top">
              <h2 id="servidor-costos">Costos</h2>
            </div>
            <div className="status-meta-list">
              <Fila etiqueta="Este mes" valor={formatUsd(datos.costos.mesUsd)} />
              <Fila etiqueta="Últimos 30 días" valor={formatUsd(datos.costos.ultimos30dUsd)} />
              <Fila etiqueta="Llamadas (30 días)" valor={datos.costos.llamadas30d.toLocaleString("es")} />
              <Fila etiqueta="Tokens (30 días)" valor={datos.costos.tokens30d.toLocaleString("es")} />
            </div>
          </section>
        )}

        {datos && (
          <section className="panel status-card" aria-labelledby="servidor-tareas">
            <div className="card-top">
              <h2 id="servidor-tareas">Tareas</h2>
            </div>
            <div className="status-meta-list">
              <Fila etiqueta="Últimos 30 días" valor={datos.tareas.ultimos30d.toLocaleString("es")} />
              <Fila etiqueta="En cola" valor={datos.tareas.en_cola.toLocaleString("es")} />
              <Fila etiqueta="En curso" valor={datos.tareas.en_curso.toLocaleString("es")} />
            </div>
          </section>
        )}

        <AgenteCard
          estado={runner.data}
          cargando={runner.isPending}
          error={runner.isError ? runner.error : null}
          onReintentar={() => void runner.refetch()}
        />
      </div>
    </main>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="status-meta-row">
      <span className="status-meta-label">{etiqueta}</span>
      <span className="status-meta-value tr-valor">{valor}</span>
    </div>
  );
}

// Estado del agente: CLI de OpenCode y aislamiento (bubblewrap).
function AgenteCard({
  estado,
  cargando,
  error,
  onReintentar,
}: {
  estado: { opencode: boolean; bwrap: boolean; aislamiento: boolean } | undefined;
  cargando: boolean;
  // Error de la consulta cuando no hay datos previos (null si no hay error).
  error: unknown;
  onReintentar: () => void;
}) {
  const listo = !!estado?.opencode && (estado.bwrap || !estado.aislamiento);
  const fallo = !estado && error != null;
  const mensaje = !estado
    ? fallo
      ? errorText(error)
      : "Consultando el agente…"
    : !estado.bwrap && estado.aislamiento
      ? "Falta bubblewrap en el servidor: ningún chat ni tarea puede correr."
      : !estado.opencode
        ? "No se encontró el comando de OpenCode en el servidor."
        : "Listo para correr chats y tareas.";

  return (
    <section className="panel status-card" aria-labelledby="servidor-agente">
      <div className="card-top">
        <h2 id="servidor-agente">Agente</h2>
        <span className={`badge ${listo ? "badge-ok" : "badge-error"}`}>
          {cargando ? "Consultando…" : fallo ? "Sin datos" : listo ? "Listo" : "Incompleto"}
        </span>
      </div>
      <p className={fallo ? "error" : "muted-note"} role={fallo ? "alert" : undefined}>
        {mensaje}
      </p>
      {fallo && (
        <div>
          <button type="button" className="ghost" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      )}
      <div className="status-meta-list">
        <Fila etiqueta="CLI de OpenCode" valor={estado ? (estado.opencode ? "Disponible" : "No encontrado") : "Pendiente"} />
        <Fila
          etiqueta="Aislamiento (bubblewrap)"
          valor={estado ? (!estado.aislamiento ? "Desactivado" : estado.bwrap ? "Disponible" : "Falta") : "Pendiente"}
        />
      </div>
    </section>
  );
}
