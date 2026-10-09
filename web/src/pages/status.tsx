import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type Task } from "../api";
import { formatWhen, STATUS_LABEL } from "../lib/model";
import { useShell } from "../components/shell-context";

export function StatusPage() {
  const { toggleDrawer } = useShell();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15_000,
  });

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: api.listTasks,
    refetchInterval: 15_000,
  });

  const isOnline = health.data?.ok === true;
  const taskList: Task[] = tasks.data ?? [];
  const queuedCount = taskList.filter((t) => t.status === "queued").length;
  const runningCount = taskList.filter((t) => t.status === "running").length;
  const lastTask = taskList[0] ?? null;

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
            <h1>Estado</h1>
            <p className="page-desc">
              Estado de los servicios locales, base de datos SQLite y worker de tareas.
            </p>
          </div>
        </div>
        <div className="status-pill-head">
          <span className={`status-pill ${isOnline ? "is-online" : "is-offline"}`}>
            <span className="pill-dot" aria-hidden="true" />
            {health.isPending ? "Consultando…" : isOnline ? "En línea" : "Con errores"}
          </span>
        </div>
      </header>

      {health.isError && (
        <p className="error" role="alert">
          Sin conexión con el servidor.
        </p>
      )}

      <div className="status-grid">
        <section className="panel status-card">
          <div className="card-top">
            <h2>Estado del servidor</h2>
            <span className={`badge ${isOnline ? "badge-ok" : "badge-error"}`}>
              {isOnline ? "Activa" : "Desconectada"}
            </span>
          </div>
          <p className="muted-note">
            API {isOnline ? "activa" : "con errores"}.
          </p>
          <div className="status-meta-list">
            <div className="status-meta-row">
              <span className="status-meta-label">Última comprobación</span>
              <span className="status-meta-value">
                {health.data?.time
                  ? new Date(health.data.time).toLocaleTimeString("es")
                  : "Pendiente"}
              </span>
            </div>
            <div className="status-meta-row">
              <span className="status-meta-label">Endpoint de salud</span>
              <span className="status-meta-value code">/api/health</span>
            </div>
          </div>
        </section>

        <section className="panel status-card">
          <div className="card-top">
            <h2>Estado de la base de datos</h2>
            <span className={`badge ${isOnline ? "badge-ok" : "badge-error"}`}>{health.isPending ? "Consultando…" : isOnline ? "Conectada" : "Sin respuesta"}</span>
          </div>
          <p className="muted-note">Motor SQLite local con modo Write-Ahead Logging (WAL).</p>
          <div className="status-meta-list">
            <div className="status-meta-row">
              <span className="status-meta-label">Conexión</span>
              <span className="status-meta-value">bun:sqlite</span>
            </div>
            <div className="status-meta-row">
              <span className="status-meta-label">Claves foráneas</span>
              <span className="status-meta-value">Habilitadas</span>
            </div>
          </div>
        </section>

        <section className="panel status-card status-card-wide">
          <div className="card-top">
            <h2>Última tarea ejecutada</h2>
            <span className={`badge ${runningCount > 0 ? "badge-signal" : "badge-neutral"}`}>
              {runningCount > 0 ? "Ejecutando" : "En espera"}
            </span>
          </div>
          <p className="muted-note">
            {lastTask
              ? `Estado: ${STATUS_LABEL[lastTask.status]} (${formatWhen(lastTask.created_at)})`
              : "Todavía no se ha ejecutado ninguna tarea en el servidor."}
          </p>
          <div className="status-meta-list">
            <div className="status-meta-row">
              <span className="status-meta-label">Tareas activas</span>
              <span className="status-meta-value">
                {runningCount} en ejecución · {queuedCount} en cola
              </span>
            </div>
            {lastTask && (
              <div className="status-meta-row">
                <span className="status-meta-label">Detalle</span>
                <span className="status-meta-value">
                  <Link to="/tareas" className="foot-link">
                    Ver en Tareas →
                  </Link>
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
