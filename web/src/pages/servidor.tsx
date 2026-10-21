import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ServicioEstado, type ServidorEstado } from "../api";
import { duracion, formatBytes, porcentaje } from "../components/tarea-formato";
import { errorText, formatUsd } from "../lib/model";
import { LoadingSkeleton } from "../components/loading-skeleton";
import { medirLatencia } from "../lib/latencia";

// Contenido de las pestañas "Estado del servidor" y "Almacenamiento" de Ajustes y Servidor.
// Solo muestra lo que devuelve la API o lo que este navegador mide. Si un dato falta, la tarjeta dice "—".

const ETIQUETA_DISCO: Record<string, string> = {
  datos: "Datos",
  proyectos: "Proyectos",
};

const MAX_MUESTRAS = 60;
const INTERVALO_MS = 30_000;

function resumenUsoCarpeta(carpeta: ServidorEstado["carpetas"][number]): string {
  const prefijo = carpeta.truncado ? "≥ " : "";
  const parcial = carpeta.truncado ? " (parcial)" : "";
  return `${prefijo}${formatBytes(carpeta.bytes)} · ${prefijo}${carpeta.archivos.toLocaleString("es")} archivos${parcial}`;
}

export type MuestrasLatencia = {
  // Última medida desde este navegador (ida y vuelta a /api/health).
  ms: number | null;
  p50: number | null;
  p99: number | null;
  cantidad: number;
  midiendo: boolean;
  medir: () => Promise<void>;
};

// Percentil por rango más cercano sobre una lista ya ordenada.
function percentil(ordenadas: number[], p: number): number {
  const indice = Math.min(ordenadas.length - 1, Math.max(0, Math.ceil(p * ordenadas.length) - 1));
  return ordenadas[indice];
}

// Mide al abrir la página, cada 30 s mientras la pestaña está visible y cuando se pide.
// p50 y p99 salen solo de las medidas de esta página: no hay historial en el servidor.
export function useMuestrasLatencia(): MuestrasLatencia {
  const [muestras, setMuestras] = useState<number[]>([]);
  const [midiendo, setMidiendo] = useState(true);

  const medir = useCallback(async () => {
    setMidiendo(true);
    const { ms } = await medirLatencia();
    if (ms !== null) setMuestras((previas) => [...previas, ms].slice(-MAX_MUESTRAS));
    setMidiendo(false);
  }, []);

  useEffect(() => {
    void medir();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void medir();
    }, INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [medir]);

  const ordenadas = [...muestras].sort((a, b) => a - b);
  return {
    ms: muestras.length > 0 ? muestras[muestras.length - 1] : null,
    p50: ordenadas.length > 0 ? percentil(ordenadas, 0.5) : null,
    p99: ordenadas.length > 0 ? percentil(ordenadas, 0.99) : null,
    cantidad: muestras.length,
    midiendo,
    medir,
  };
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ErrorConReintento({ error, onReintentar }: { error: unknown; onReintentar: () => void }) {
  return (
    <div className="aj-error-bloque" role="alert">
      <p className="aj-error">{errorText(error)}</p>
      <button type="button" className="aj-btn" onClick={onReintentar}>
        Reintentar
      </button>
    </div>
  );
}

function TarjetaServidor({
  id,
  titulo,
  principal,
  children,
  pie,
}: {
  id: string;
  titulo: string;
  principal: string;
  children?: ReactNode;
  pie?: ReactNode;
}) {
  return (
    <section className="aj-tarjeta" aria-labelledby={id}>
      <h3 id={id} className="aj-tarjeta-titulo-simple">
        {titulo}
      </h3>
      <p className="aj-principal">{principal}</p>
      {children && <dl className="aj-filas">{children}</dl>}
      {pie}
    </section>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div className="aj-fila">
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

// Tarjetas de estado: proceso, latencia, discos, carpetas, herramientas, costos, tareas y agente.
// Registros del servicio: se piden solo cuando el panel está abierto, y se vuelven a pedir con el botón.
function RegistrosServicio() {
  const registros = useQuery({ queryKey: ["servidor-logs"], queryFn: () => api.serverLogs(100) });
  return (
    <section id="aj-registros" className="aj-tarjeta" aria-labelledby="aj-registros-titulo">
      <div className="aj-seccion-cabecera">
        <h3 id="aj-registros-titulo" className="aj-tarjeta-titulo-simple">
          Registros del servicio
        </h3>
        <button
          type="button"
          className="aj-btn"
          disabled={registros.isFetching}
          onClick={() => void registros.refetch()}
        >
          {registros.isFetching ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
      {registros.isPending && !registros.data && <LoadingSkeleton tipo="contenido" cantidad={3} />}
      {registros.isError && (
        <p className="aj-error" role="alert">
          {errorText(registros.error)}
        </p>
      )}
      {registros.data && (
        <>
          <pre className="aj-registros-texto" tabIndex={0} aria-label="Últimas líneas del registro del servicio">
            {registros.data.texto.trim() || "Todavía no hay líneas en el registro."}
          </pre>
          <p className="aj-nota">Últimas {registros.data.lineas} líneas. Los valores secretos aparecen como ***.</p>
        </>
      )}
    </section>
  );
}

// Texto corto del estado de la unidad: "Activo", "Detenido" o el motivo de no tenerlo.
function textoServicio(datos: ServicioEstado | undefined, error: boolean): string {
  if (error) return "Sin datos";
  if (!datos) return "—";
  if (!datos.disponible) return "Sin systemd";
  if (datos.activo === "active") return "Activo";
  return datos.activo ? `Detenido (${datos.activo})` : "Desconocido";
}

export function EstadoServidor({ latencia }: { latencia: MuestrasLatencia }) {
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000 });
  const runner = useQuery({ queryKey: ["runner"], queryFn: api.runnerStatus, refetchInterval: 60_000 });
  const servicio = useQuery({ queryKey: ["servidor-servicio"], queryFn: api.serverService, refetchInterval: 30_000 });
  const [verRegistros, setVerRegistros] = useState(false);

  const datos: ServidorEstado | undefined = servidor.data;
  const discoDatos = datos?.disco.find((d) => d.etiqueta === "datos");
  const discoProyectos = datos?.disco.find((d) => d.etiqueta === "proyectos");
  const herramientasListas = datos?.herramientas.filter((h) => h.disponible).length ?? 0;
  const runnerListo = !!runner.data?.opencode && (runner.data.bwrap || !runner.data.aislamiento);

  return (
    <section className="aj-seccion" aria-labelledby="aj-estado-titulo">
      <div className="aj-seccion-cabecera">
        <h2 id="aj-estado-titulo" className="aj-titulo-seccion">
          Estado del servidor
        </h2>
        <button
          type="button"
          className="aj-btn"
          aria-expanded={verRegistros}
          aria-controls="aj-registros"
          onClick={() => setVerRegistros((abierto) => !abierto)}
        >
          {verRegistros ? "Ocultar logs" : "Ver logs"}
        </button>
      </div>

      {servidor.isError && <ErrorConReintento error={servidor.error} onReintentar={() => void servidor.refetch()} />}
      {verRegistros && <RegistrosServicio />}

      <div className="aj-rejilla-servidor">
        <TarjetaServidor
          id="aj-servicio"
          titulo="Servicio"
          principal={textoServicio(servicio.data, servicio.isError)}
        >
          <Fila etiqueta="Estado interno" valor={servicio.data?.subestado ?? "—"} />
          <Fila etiqueta="Desde" valor={servicio.data?.desde ?? "—"} />
          <Fila etiqueta="PID" valor={servicio.data?.pid ?? "—"} />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-proceso"
          titulo="Proceso"
          principal={datos ? duracion(datos.proceso.segundosActivo) : "—"}
        >
          <Fila etiqueta="Arranque" valor={datos ? fechaCorta(datos.proceso.arrancado) : "—"} />
          <Fila etiqueta="Commit del servidor" valor={datos?.proceso.commit ?? "No disponible"} />
          <Fila etiqueta="Runtime" valor={datos ? `Bun ${datos.proceso.bun}` : "—"} />
          <Fila etiqueta="Plataforma" valor={datos?.proceso.plataforma ?? "—"} />
          <Fila
            etiqueta="Memoria RSS"
            valor={datos ? `${datos.proceso.rssMb.toLocaleString("es", { maximumFractionDigits: 1 })} MB` : "—"}
          />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-latencia"
          titulo="Latencia"
          principal={latencia.ms != null ? `${latencia.ms} ms` : latencia.midiendo ? "…" : "—"}
          pie={
            <div className="aj-pie-tarjeta">
              <button
                id="pingBtn"
                type="button"
                className="aj-btn"
                onClick={() => void latencia.medir()}
                disabled={latencia.midiendo}
              >
                {latencia.midiendo ? "Midiendo…" : "Medir ahora"}
              </button>
              <p className="aj-nota">
                Ida y vuelta desde este navegador a /api/health. Se mide al abrir la página, cada 30 s y al pulsar el botón.
              </p>
            </div>
          }
        >
          <Fila etiqueta="p50" valor={latencia.p50 != null ? `${latencia.p50} ms` : "—"} />
          <Fila etiqueta="p99" valor={latencia.p99 != null ? `${latencia.p99} ms` : "—"} />
          <Fila etiqueta="Medidas" valor={`${latencia.cantidad} en esta página`} />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-discos"
          titulo="Discos"
          principal={discoDatos ? `${formatBytes(discoDatos.libreBytes)} libres` : "—"}
        >
          <Fila
            etiqueta="Datos"
            valor={discoDatos ? `${porcentaje(discoDatos.usadoBytes, discoDatos.totalBytes)} % usado` : "—"}
          />
          <Fila
            etiqueta="Proyectos"
            valor={
              discoProyectos && discoProyectos.totalBytes > 0
                ? `${formatBytes(discoProyectos.libreBytes)} libres`
                : datos
                  ? "Sin datos"
                  : "—"
            }
          />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-carpetas"
          titulo="Carpetas"
          principal={datos ? `${datos.carpetas.length} carpetas` : "—"}
        >
          {datos && datos.carpetas.length === 0 && <Fila etiqueta="Carpetas" valor="Sin carpetas" />}
          {datos?.carpetas.map((c) => (
            <Fila
              key={c.nombre}
              etiqueta={c.nombre}
              valor={resumenUsoCarpeta(c)}
            />
          ))}
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-herramientas"
          titulo="Herramientas instaladas"
          principal={datos ? `${herramientasListas} listas` : "—"}
        >
          {datos && datos.herramientas.length === 0 && <Fila etiqueta="Herramientas" valor="Sin datos" />}
          {!datos && <Fila etiqueta="Herramientas" valor="Consultando…" />}
          {datos?.herramientas.map((h) => (
            <Fila
              key={h.nombre}
              etiqueta={h.nombre}
              valor={h.disponible ? (h.version ?? "disponible") : "no disponible"}
            />
          ))}
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-costos"
          titulo="Costos"
          principal={datos ? formatUsd(datos.costos.mesUsd) : "—"}
          pie={<p className="aj-nota">Mes en curso, en UTC.</p>}
        >
          <Fila etiqueta="Últimos 30 días" valor={datos ? formatUsd(datos.costos.ultimos30dUsd) : "—"} />
          <Fila etiqueta="Llamadas (30 días)" valor={datos ? datos.costos.llamadas30d.toLocaleString("es") : "—"} />
          <Fila
            etiqueta="Tokens (30 días)"
            valor={datos ? `${(datos.costos.tokens30d / 1_000_000).toFixed(2)} M` : "—"}
          />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-tareas"
          titulo="Tareas"
          principal={datos ? `${datos.tareas.en_curso} en ejecución` : "—"}
        >
          <Fila etiqueta="En cola" valor={datos ? `${datos.tareas.en_cola} pendientes` : "—"} />
          <Fila etiqueta="Últimos 30 días" valor={datos ? `${datos.tareas.ultimos30d} registradas` : "—"} />
          <Fila etiqueta="Workers asignados" valor={datos ? `${datos.tareas.en_curso} / 1` : "—"} />
        </TarjetaServidor>

        <TarjetaServidor
          id="aj-agente"
          titulo="Agente"
          principal={runner.data?.opencode ? "OpenCode CLI" : runner.isPending ? "Consultando…" : "Sin agente"}
        >
          <Fila
            etiqueta="Motor local"
            valor={runner.data ? (runner.data.opencode ? "OpenCode disponible" : "No encontrado") : "—"}
          />
          <Fila
            etiqueta="Aislamiento"
            valor={
              runner.data
                ? !runner.data.aislamiento
                  ? "Desactivado"
                  : runner.data.bwrap
                    ? "Bubblewrap activo"
                    : "Falta bubblewrap"
                : "—"
            }
          />
          <Fila etiqueta="Estado" valor={runner.data ? (runnerListo ? "Listo para tareas" : "Incompleto") : "—"} />
        </TarjetaServidor>
      </div>
    </section>
  );
}

function TarjetaDisco({
  etiqueta,
  disco,
  cargando,
}: {
  etiqueta: "datos" | "proyectos";
  disco: ServidorEstado["disco"][number] | undefined;
  cargando: boolean;
}) {
  const medido = disco !== undefined && disco.totalBytes > 0;
  const uso = medido ? porcentaje(disco.usadoBytes, disco.totalBytes) : 0;
  const id = `aj-disco-${etiqueta}`;

  return (
    <section className="aj-tarjeta" aria-labelledby={id}>
      <h3 id={id} className="aj-tarjeta-titulo-simple">
        {ETIQUETA_DISCO[etiqueta]}
      </h3>
      <p className="aj-principal">{medido ? `${uso} % usado` : cargando ? "…" : "—"}</p>
      <div className="aj-barra" role="img" aria-label={medido ? `${uso} % usado` : "Sin datos de uso"}>
        <div className="aj-barra-relleno" style={{ width: `${uso}%` }} />
      </div>
      <dl className="aj-filas">
        <Fila
          etiqueta="Usado"
          valor={medido ? `${formatBytes(disco.usadoBytes)} de ${formatBytes(disco.totalBytes)}` : "Sin datos"}
        />
        <Fila etiqueta="Libre" valor={medido ? formatBytes(disco.libreBytes) : "Sin datos"} />
      </dl>
      {!medido && !cargando && (
        <p className="aj-nota">El servidor no pudo medir este disco o no tiene la carpeta configurada.</p>
      )}
    </section>
  );
}

// Discos y carpetas reales del servidor.
export function AlmacenamientoServidor() {
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000 });
  const datos = servidor.data;
  const carpetas = datos?.carpetas ?? [];
  const mayor = Math.max(0, ...carpetas.map((c) => c.bytes));

  return (
    <section className="aj-seccion" aria-labelledby="aj-almacenamiento-titulo">
      <div className="aj-seccion-cabecera">
        <h2 id="aj-almacenamiento-titulo" className="aj-titulo-seccion">
          Almacenamiento
        </h2>
      </div>

      {servidor.isError && <ErrorConReintento error={servidor.error} onReintentar={() => void servidor.refetch()} />}

      <div className="aj-rejilla-servidor">
        <TarjetaDisco etiqueta="datos" disco={datos?.disco.find((d) => d.etiqueta === "datos")} cargando={servidor.isPending} />
        <TarjetaDisco
          etiqueta="proyectos"
          disco={datos?.disco.find((d) => d.etiqueta === "proyectos")}
          cargando={servidor.isPending}
        />
      </div>

      <section className="aj-tarjeta" aria-labelledby="aj-carpetas-titulo">
        <h3 id="aj-carpetas-titulo" className="aj-tarjeta-titulo-simple">
          Carpetas
        </h3>
        {servidor.isPending && !servidor.data && <LoadingSkeleton tipo="lineas" cantidad={3} />}
        {datos && carpetas.length === 0 && <p className="aj-nota">Sin carpetas.</p>}
        {carpetas.some((c) => c.truncado) && (
          <p className="aj-nota">El conteo alcanzó el límite de lectura; los valores parciales son mínimos y el uso real puede ser mayor.</p>
        )}
        {carpetas.length > 0 && (
          <ul className="aj-carpetas">
            {carpetas.map((c) => (
              <li key={c.nombre} className="aj-carpeta">
                <div className="aj-carpeta-cabecera">
                  <span className="aj-mono">{c.nombre}</span>
                  <span>{resumenUsoCarpeta(c)}</span>
                </div>
                <div className="aj-barra" aria-hidden="true">
                  <div className="aj-barra-relleno" style={{ width: `${porcentaje(c.bytes, mayor)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
