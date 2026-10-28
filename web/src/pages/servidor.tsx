import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, reintentarConsultaTransitoria, type ServicioEstado, type ServidorEstado } from "../api";
import { duracion, formatBytes, porcentaje } from "../components/tarea-formato";
import { errorText, formatUsd } from "../lib/model";
import { LoadingSkeleton } from "../components/loading-skeleton";
import { medirLatencia } from "../lib/latencia";
import { DiscoPanel } from "../components/settings/panel-disco";

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
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000, retry: reintentarConsultaTransitoria });
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

function errorArchivoDrive(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText(error);
  const mensajes: Record<string, string> = {
    drive_auth_required: "Vuelve a conectar Google Drive y comprueba que la clave de cifrado del servidor siga configurada.",
    drive_permission_or_quota: "Google Drive rechazó la operación. Revisa el permiso concedido a Telo y el espacio disponible.",
    drive_upload_expired: "La carga temporal de Google Drive venció. Puedes volver a archivar; la carpeta local sigue intacta.",
    drive_api_error: "Google Drive no completó la operación. La tarea local se conserva; puedes reintentar.",
    integrity_check_failed: "La copia remota no pasó la verificación. Los archivos locales se conservaron.",
    archive_creation_failed: "No se pudo preparar el archivo en el servidor. La tarea local se conserva.",
    disk_or_filesystem_error: "El servidor no pudo leer o actualizar los archivos. Revisa el espacio e inténtalo de nuevo.",
    task_not_archivable: "La tarea ya no cumple las condiciones para archivarse o cambió durante la operación.",
    task_restore_conflict: "La tarea ya existe localmente o cambió su estado. No se sobrescribieron archivos.",
    archive_interrupted: "El servidor se reinició durante la operación. Puedes volver a intentarla.",
    archive_cleanup_incomplete: "La copia está guardada, pero quedó una limpieza pendiente. Termínala desde Ajustes > Almacenamiento antes de continuar la tarea.",
    archive_format_unsupported: "El archivo guardado tiene un formato que esta versión de Telo no reconoce.",
    google_drive_job_in_progress: "Espera a que termine la operación actual de Google Drive.",
  };
  return mensajes[error.code] ?? errorText(error);
}

function estadoTareaArchivo(estado: string): string {
  return estado === "done" ? "Completada" : estado === "failed" ? "Fallida" : estado === "cancelled" ? "Cancelada" : estado;
}

function tituloTrabajoDrive(action: "archive" | "restore"): string {
  return action === "archive" ? "Archivando en Google Drive" : "Restaurando en el servidor";
}

const DRIVE_ITEMS_POR_PAGINA = 15;
const DRIVE_LOTE_MAXIMO = 5;

function PaginadorDrive({ total, pagina, alCambiar, etiqueta }: {
  total: number;
  pagina: number;
  alCambiar: (pagina: number) => void;
  etiqueta: string;
}) {
  if (total === 0) return null;
  const paginas = Math.ceil(total / DRIVE_ITEMS_POR_PAGINA);
  const desde = pagina * DRIVE_ITEMS_POR_PAGINA + 1;
  const hasta = Math.min(total, desde + DRIVE_ITEMS_POR_PAGINA - 1);
  return (
    <nav className="aj-drive-paginador" aria-label={`Páginas de ${etiqueta}`}>
      <span>Mostrando {desde}–{hasta} de {total}</span>
      {paginas > 1 && (
        <div className="aj-drive-paginador-controles">
          <button type="button" className="aj-btn" disabled={pagina === 0} onClick={() => alCambiar(pagina - 1)}>Anterior</button>
          <span aria-live="polite">Página {pagina + 1} de {paginas}</span>
          <button type="button" className="aj-btn" disabled={pagina >= paginas - 1} onClick={() => alCambiar(pagina + 1)}>Siguiente</button>
        </div>
      )}
    </nav>
  );
}

function PanelArchivoGoogleDrive() {
  const cliente = useQueryClient();
  const [errorAccion, setErrorAccion] = useState<unknown>(null);
  const [paginaCandidatos, setPaginaCandidatos] = useState(0);
  const [paginaArchivos, setPaginaArchivos] = useState(0);
  const [lote, setLote] = useState<{ total: number; completadas: number; titulo: string | null; detenerSolicitado: boolean } | null>(null);
  const detenerLote = useRef(false);
  const archivos = useQuery({
    queryKey: ["google-drive-archives"],
    queryFn: api.googleDriveArchives,
    retry: reintentarConsultaTransitoria,
    refetchInterval: (query) => query.state.data?.trabajos.some((j) => j.state === "queued" || j.state === "running") ? 2_000 : 15_000,
  });
  const accion = useMutation<{ id: string; task_id: string; action: "archive" | "restore"; state: "queued" }, unknown, { id: string; tipo: "archive" | "restore" }>({
    mutationFn: ({ id, tipo }: { id: string; tipo: "archive" | "restore" }) =>
      tipo === "archive" ? api.archivarTareaDrive(id) : api.restaurarTareaDrive(id),
    onMutate: () => setErrorAccion(null),
    onError: setErrorAccion,
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ["google-drive-archives"] }),
    onSettled: () => void cliente.invalidateQueries({ queryKey: ["google-drive-archives"] }),
  });
  const dato = archivos.data;
  const totalCandidatos = dato?.candidatos.length ?? 0;
  const totalArchivos = dato?.archivos.length ?? 0;
  const paginasCandidatos = Math.max(1, Math.ceil(totalCandidatos / DRIVE_ITEMS_POR_PAGINA));
  const paginasArchivos = Math.max(1, Math.ceil(totalArchivos / DRIVE_ITEMS_POR_PAGINA));
  useEffect(() => setPaginaCandidatos((pagina) => Math.min(pagina, paginasCandidatos - 1)), [paginasCandidatos]);
  useEffect(() => setPaginaArchivos((pagina) => Math.min(pagina, paginasArchivos - 1)), [paginasArchivos]);
  const candidatosPagina = dato?.candidatos.slice(paginaCandidatos * DRIVE_ITEMS_POR_PAGINA, (paginaCandidatos + 1) * DRIVE_ITEMS_POR_PAGINA) ?? [];
  const archivosPagina = dato?.archivos.slice(paginaArchivos * DRIVE_ITEMS_POR_PAGINA, (paginaArchivos + 1) * DRIVE_ITEMS_POR_PAGINA) ?? [];
  const ocupado = Boolean(lote) || accion.isPending || Boolean(dato?.trabajos.some((j) => j.state === "queued" || j.state === "running"));
  const listo = Boolean(dato?.configurado && dato.conectado && dato.cifrado_disponible);
  const recientes = dato?.trabajos.slice(0, 5) ?? [];

  async function archivarLoteActual() {
    const tareas = candidatosPagina.slice(0, DRIVE_LOTE_MAXIMO);
    if (!listo || ocupado || tareas.length === 0) return;
    const confirmado = window.confirm(`Se archivarán hasta ${tareas.length} tareas de esta página, una por una. Cada carpeta local se libera solo después de verificar la copia cifrada en Google Drive. ¿Continuar?`);
    if (!confirmado) return;

    detenerLote.current = false;
    setErrorAccion(null);
    setLote({ total: tareas.length, completadas: 0, titulo: null, detenerSolicitado: false });
    try {
      for (let indice = 0; indice < tareas.length; indice++) {
        if (detenerLote.current) break;
        const tarea = tareas[indice];
        setLote((estado) => estado ? { ...estado, titulo: tarea.title || "Tarea sin título" } : estado);
        const encolado = await api.archivarTareaDrive(tarea.id);
        while (true) {
          const estadoActual = await api.googleDriveArchives();
          cliente.setQueryData(["google-drive-archives"], estadoActual);
          const trabajo = estadoActual.trabajos.find((item) => item.id === encolado.id);
          if (trabajo?.state === "failed") throw new ApiError(500, trabajo.error ?? "drive_api_error");
          if (trabajo?.state === "done") break;
          await new Promise<void>((resolver) => window.setTimeout(resolver, 2_000));
        }
        setLote((estado) => estado ? { ...estado, completadas: indice + 1, titulo: null } : estado);
      }
    } catch (error) {
      setErrorAccion(error);
    } finally {
      detenerLote.current = false;
      await archivos.refetch();
      setLote(null);
    }
  }

  function solicitarDetencionLote() {
    detenerLote.current = true;
    setLote((estado) => estado ? { ...estado, detenerSolicitado: true } : estado);
  }

  return (
    <section className="aj-tarjeta aj-drive" aria-labelledby="aj-drive-titulo">
      <div className="aj-seccion-cabecera">
        <div>
          <h3 id="aj-drive-titulo" className="aj-tarjeta-titulo-simple">Archivo externo · Google Drive</h3>
          <p className="aj-nota">Guarda tareas terminadas con cifrado y libera su carpeta local. El historial permanece en Telo; restaura una tarea antes de continuarla.</p>
        </div>
        <button type="button" className="aj-btn" onClick={() => void archivos.refetch()} disabled={archivos.isFetching}>
          {archivos.isFetching ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {archivos.isPending && <LoadingSkeleton tipo="lineas" cantidad={2} />}
      {archivos.isError && <ErrorConReintento error={archivos.error} onReintentar={() => void archivos.refetch()} />}
      {errorAccion != null ? <p className="aj-error" role="alert">{errorArchivoDrive(errorAccion)}</p> : null}
      {dato && (
        <>
          <div className="aj-drive-conexion" role="status">
            <span className={dato.conectado ? "aj-drive-led is-ok" : "aj-drive-led"} aria-hidden="true" />
            <span>
              {!dato.configurado
                ? "Falta configurar OAuth de Google Drive en el servidor."
                : dato.conectado
                  ? `Conectado${dato.cuenta ? ` como ${dato.cuenta}` : ""}.`
                  : "Google Drive todavía no está conectado."}
            </span>
            {dato.configurado && !dato.conectado && (
              <a className="aj-btn aj-btn-primario" href="/api/google-drive/oauth/start">Conectar Google Drive</a>
            )}
            {dato.conectado && !dato.cifrado_disponible && <span className="aj-error">Falta la clave maestra de cifrado.</span>}
          </div>
          {!dato.conectado && dato.callback_uri && (
            <p className="aj-nota">URI de retorno que debes registrar en el cliente OAuth de Google Cloud: <code>{dato.callback_uri}</code></p>
          )}
          {!dato.configurado && !dato.callback_uri && (
            <p className="aj-nota">Configura la URL pública como origen HTTPS, sin la ruta <code>/chat</code>, y registra en Google la URI de retorno que muestra este panel cuando la configuración esté completa.</p>
          )}
          <p className="aj-nota">Solo se ofrecen tareas completadas, fallidas o canceladas sin acciones de Git pendientes. Los perfiles OpenCode compartidos por chats no se mueven.</p>

          {lote ? (
            <div className="aj-drive-progreso" role="status" aria-live="polite">
              <span className="aj-drive-spinner" aria-hidden="true" />
              <span>
                Lote: {lote.completadas} de {lote.total} tareas completadas{lote.titulo ? ` · ${lote.titulo}` : ""}.
                {lote.detenerSolicitado && " Se detendrá al terminar la tarea actual."}
              </span>
              {!lote.detenerSolicitado && <button type="button" className="aj-btn" onClick={solicitarDetencionLote}>Detener lote</button>}
            </div>
          ) : ocupado && dato.trabajos.find((j) => j.state === "queued" || j.state === "running") && (
            <div className="aj-drive-progreso" role="status" aria-live="polite">
              <span className="aj-drive-spinner" aria-hidden="true" />
              {tituloTrabajoDrive(dato.trabajos.find((j) => j.state === "queued" || j.state === "running")!.action)}…
            </div>
          )}

          <div className="aj-drive-listas">
            <div>
              <h4>Tareas disponibles para archivar</h4>
              {dato.candidatos.length > 0 && (
                <div className="aj-drive-lote">
                  <div>
                    <strong>Archivado gradual</strong>
                    <p className="aj-nota">Archiva hasta {Math.min(DRIVE_LOTE_MAXIMO, candidatosPagina.length)} tareas visibles, una por una. Si una falla, el lote se detiene para revisarla.</p>
                  </div>
                  <button type="button" className="aj-btn aj-btn-primario" disabled={!listo || ocupado} onClick={() => void archivarLoteActual()}>
                    Archivar lote de hasta {Math.min(DRIVE_LOTE_MAXIMO, candidatosPagina.length)}
                  </button>
                </div>
              )}
              {dato.candidatos.length === 0
                ? <p className="aj-nota">No hay tareas terminadas pendientes de archivar.</p>
                : <ul className="aj-drive-lista">
                    {candidatosPagina.map((task) => (
                      <li key={task.id} className="aj-drive-fila">
                        <div className="aj-drive-info">
                          <strong>{task.title || "Tarea sin título"}</strong>
                          <span>{estadoTareaArchivo(task.status)}{task.finished_at ? ` · ${fechaCorta(task.finished_at)}` : ""}</span>
                        </div>
                        <button type="button" className="aj-btn aj-btn-primario" disabled={!listo || ocupado} onClick={() => accion.mutate({ id: task.id, tipo: "archive" })}>
                          Archivar
                        </button>
                      </li>
                    ))}
                  </ul>}
              <PaginadorDrive total={dato.candidatos.length} pagina={paginaCandidatos} alCambiar={setPaginaCandidatos} etiqueta="tareas disponibles para archivar" />
            </div>

            <div>
              <h4>Copias archivadas</h4>
              {dato.archivos.length === 0
                ? <p className="aj-nota">Todavía no hay copias en Drive.</p>
                : <ul className="aj-drive-lista">
                    {archivosPagina.map((archive) => (
                      <li key={archive.task_id} className="aj-drive-fila">
                        <div className="aj-drive-info">
                          <strong>{archive.task_title || archive.archive_name}</strong>
                          <span>{archive.limpieza_pendiente
                            ? "Quedó una limpieza local pendiente · verifica la copia para terminarla"
                            : archive.local_disponible
                              ? `La carpeta local sigue disponible · ${formatBytes(archive.source_bytes)} por liberar`
                            : `Archivada ${fechaCorta(archive.archived_at)} · copia cifrada ${formatBytes(archive.encrypted_bytes)}`}</span>
                        </div>
                        {archive.local_disponible || archive.limpieza_pendiente
                          ? <button type="button" className="aj-btn aj-btn-primario" disabled={!listo || ocupado} onClick={() => accion.mutate({ id: archive.task_id, tipo: "archive" })}>Verificar y liberar</button>
                          : <button type="button" className="aj-btn" disabled={!listo || ocupado} onClick={() => accion.mutate({ id: archive.task_id, tipo: "restore" })}>Restaurar</button>}
                      </li>
                    ))}
                  </ul>}
              <PaginadorDrive total={dato.archivos.length} pagina={paginaArchivos} alCambiar={setPaginaArchivos} etiqueta="copias archivadas" />
            </div>
          </div>

          {recientes.length > 0 && (
            <details className="aj-drive-historial">
              <summary>Operaciones recientes</summary>
              <ul className="aj-drive-lista">
                {recientes.map((job) => (
                  <li key={job.id} className="aj-drive-historial-fila">
                    <span>{job.action === "archive" ? "Archivo" : "Restauración"} · {job.task_id.slice(0, 8)}</span>
                    <span>{job.state === "queued" ? "En cola" : job.state === "running" ? "En curso" : job.state === "done" ? "Lista" : "Falló"}</span>
                    {job.state === "failed" && <span className="aj-error">{errorArchivoDrive(new ApiError(500, job.error ?? "drive_api_error"))}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// Discos y carpetas reales del servidor.
export function AlmacenamientoServidor() {
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000, retry: reintentarConsultaTransitoria });
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

      <DiscoPanel />
      <PanelArchivoGoogleDrive />
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
