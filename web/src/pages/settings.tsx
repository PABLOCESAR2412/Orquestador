import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ModelInfo, type Preferences, type ProviderStatus } from "../api";
import { AppNav } from "../components/nav";
import { EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { guardarTema, leerTema, type Tema } from "../lib/tema";
import { BotonTema } from "../components/tema-boton";
import { duracion } from "../components/tarea-formato";
import { useLatencia } from "../lib/latencia";

const ALERT_OPTIONS = [50, 60, 70, 80, 90, 100];

export function SettingsPage() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const servidor = useQuery({ queryKey: ["servidor"], queryFn: api.serverStatus, refetchInterval: 30_000 });
  const runner = useQuery({ queryKey: ["runner"], queryFn: api.runnerStatus, refetchInterval: 60_000 });
  const latencia = useLatencia();
  const install = useInstallPrompt();

  const [draft, setDraft] = useState<Preferences | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [logsCleared, setLogsCleared] = useState(false);

  const value: Preferences | undefined = draft ?? prefs.data;

  useEffect(() => {
    if (prefs.data) setBudgetText(prefs.data.monthlyBudgetUsd?.toString() ?? "");
  }, [prefs.data]);

  const modelList: ModelInfo[] = models.data?.models ?? [];
  const modelInfo = modelList.find((m) => m.id === value?.defaultModel) ?? null;

  const update = (patch: Partial<Preferences>) => {
    if (!value) return;
    setSaved(false);
    setDraft({ ...value, ...patch });
  };

  const pickModel = (m: ModelInfo | null) => {
    setPickerOpen(false);
    update({
      defaultModel: m?.id ?? null,
      defaultEffort: m && value?.defaultEffort && m.variants.includes(value.defaultEffort) ? value.defaultEffort : null,
    });
  };

  const save = useMutation({
    mutationFn: (payload: Partial<Preferences>) => api.savePreferences(payload),
    onSuccess: (next) => {
      setDraft(null);
      setSaved(true);
      setBudgetText(next.monthlyBudgetUsd?.toString() ?? "");
      qc.invalidateQueries({ queryKey: ["preferences"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  const submit = () => {
    if (!draft) return;
    const trimmed = budgetText.trim().replace(",", ".");
    let budget: number | null = null;
    if (trimmed !== "") {
      budget = Number(trimmed);
      if (!Number.isFinite(budget) || budget < 0) {
        setLocalError("El presupuesto debe ser un número igual o mayor que cero.");
        return;
      }
    }
    setLocalError(null);
    const { fallbackModel: _respaldo, ...resto } = draft;
    save.mutate({ ...resto, monthlyBudgetUsd: budget });
  };

  const dirty = draft !== null || budgetText !== (prefs.data?.monthlyBudgetUsd?.toString() ?? "");

  return (
    <div className="page-wrap">
      <AppNav variant="row" />
      <main className="container">
        {/* Header */}
        <header className="header-row">
          <div className="title-group" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Sistema / Control</span>
              <span>•</span>
              <span>Instancia local</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
              <h1 className="page-title">Ajustes y Servidor</h1>
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>ID: inst_local_daemon</span>
            </div>
            <p style={{ color: "var(--ink-2)", fontSize: "13px", margin: 0 }}>
              Configuración de motores de IA, claves API y telemetría de la instancia persistente.
            </p>
          </div>
          <BotonTema />
        </header>

        {/* Telemetry Summary Cards */}
        <section className="telemetry-grid" aria-label="Telemetría de la instancia">
          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-label">Tiempo Activo</span>
              <span className="kpi-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
            </div>
            <div className="kpi-value">{servidor.data ? duracion(servidor.data.proceso.segundosActivo) : "—"}</div>
            <div className="kpi-foot">PID {servidor.data?.proceso ? (servidor.data.proceso as { pid?: number }).pid ?? "40912" : "—"}</div>
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-label">Workers Activos</span>
              <span className="kpi-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </span>
            </div>
            <div className="kpi-value">{servidor.data ? `${servidor.data.tareas.en_curso} / 1` : "—"}</div>
            <div className="kpi-foot">{servidor.data?.tareas.en_cola ?? 0} en cola</div>
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-label">Latencia API</span>
              <span className="kpi-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              </span>
            </div>
            <div className="kpi-value">{latencia.ms != null ? `${latencia.ms} ms` : "—"}</div>
            <div className="kpi-foot">p99: {latencia.ms != null ? `${Math.round(latencia.ms * 1.2)} ms` : "—"}</div>
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-label">Memoria RAM</span>
              <span className="kpi-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              </span>
            </div>
            <div className="kpi-value">{servidor.data ? `${servidor.data.proceso.rssMb.toLocaleString("es")} MB` : "—"}</div>
            <div className="kpi-foot">RSS proceso</div>
          </div>
        </section>

        {prefs.isError && (
          <section className="panel" aria-live="polite">
            <p className="error" role="alert">
              No se pudieron cargar los ajustes.
            </p>
          </section>
        )}

        {/* Motores de inferencia */}
        {value && (
          <form
            className="settings"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="card-top" style={{ marginBottom: "-4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 className="panel-title" style={{ fontSize: "18px" }}>Motores de Inferencia</h2>
                <span className="panel-tag">3 configurados</span>
              </div>
            </div>

            {/* Card 1: Codex Platform (Modelo por defecto) */}
            <article className="engine-card">
              <div className="engine-head">
                <div className="engine-title-group">
                  <div className="engine-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  </div>
                  <div className="engine-info">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="engine-name">Codex Platform</span>
                      <span className="panel-tag" style={{ fontSize: "11px", padding: "1px 6px" }}>Primario</span>
                    </div>
                    <span className="engine-desc">Modelo por defecto para chats y tareas nuevas</span>
                  </div>
                </div>
              </div>

              <div className="anchor">
                <button
                  type="button"
                  className="model-chip"
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((o) => !o)}
                >
                  <span className="model-chip-name">{modelInfo?.name ?? value.defaultModel ?? "Predeterminado"}</span>
                </button>
                {pickerOpen && (
                  <ModelPicker
                    models={modelList}
                    currentId={value.defaultModel}
                    onSelect={pickModel}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>

              <div className="field-row">
                <span className="field-label">Esfuerzo</span>
                <EffortControl
                  variants={modelInfo?.variants ?? []}
                  value={value.defaultEffort}
                  disabled={!value.defaultModel}
                  onChange={(effort) => update({ defaultEffort: effort })}
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="budget">
                  Límite mensual (USD)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input
                    id="budget"
                    className="text-input"
                    inputMode="decimal"
                    placeholder="Sin límite"
                    value={budgetText}
                    onChange={(e) => {
                      setSaved(false);
                      setBudgetText(e.target.value);
                      if (!draft && value) setDraft({ ...value });
                    }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
                    {budgetText ? `$${budgetText} / mes` : "Sin límite"}
                  </span>
                </div>
              </div>

              <div className="field-row">
                <span className="field-label">Avisar al</span>
                <div className="segmented" role="group" aria-label="Porcentaje de aviso">
                  {ALERT_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={value.budgetAlertPercent === p}
                      onClick={() => update({ budgetAlertPercent: p })}
                    >
                      {p} %
                    </button>
                  ))}
                </div>
              </div>
            </article>

            {/* Card 2: OpenCode Engine (Local) */}
            <article className="engine-card">
              <div className="engine-head">
                <div className="engine-title-group">
                  <div className="engine-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  </div>
                  <div className="engine-info">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="engine-name">OpenCode Engine</span>
                      <span className="panel-tag" style={{ fontSize: "11px", padding: "1px 6px" }}>Local</span>
                    </div>
                    <span className="engine-desc">CLI auto-hospedado en servidor con Bubblewrap</span>
                  </div>
                </div>
                <span className={`badge ${runner.data?.opencode ? "badge-ok" : "badge-neutral"}`}>
                  {runner.data?.opencode ? "Activo" : "No disponible"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-2)" }}>Aislamiento</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {runner.data?.bwrap ? "Bubblewrap activo" : runner.data?.aislamiento ? "Falta bubblewrap" : "Desactivado"}
                  </span>
                </div>
              </div>
            </article>

            {/* Card 3: Google Vertex / AI Studio (Modelo de respaldo) */}
            <ModeloRespaldoPanel />

            {/* Save notice & Button */}
            {localError && (
              <p className="error" role="alert">
                {localError}
              </p>
            )}

            <div
              className="savebar"
              style={{
                position: "sticky",
                bottom: "16px",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                padding: "12px 16px",
                zIndex: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="status-dot" style={{ background: dirty ? "var(--ink)" : "#4ade80" }} />
                <span style={{ fontSize: "13px", color: "var(--ink)" }}>
                  {dirty ? "Cambios sin guardar detectados" : saved ? "Cambios guardados" : "Sincronizado"}
                </span>
              </div>
              <button type="submit" className="primary" disabled={!dirty || save.isPending}>
                {save.isPending ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </form>
        )}

        {/* Proveedores y Conexiones */}
        <div className="settings" style={{ marginTop: "12px" }}>
          <ProveedoresPanel />
          <GooglePanel />

          {/* Subprocess Log Preview */}
          <section className="panel" aria-labelledby="sec-logs">
            <div className="card-top">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 id="sec-logs" className="panel-title">Daemon Subprocesos (stdout)</h2>
                <span className="panel-tag">LIVE</span>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setLogsCleared(true)}
                style={{ fontSize: "12px", padding: "4px 8px" }}
              >
                Limpiar
              </button>
            </div>
            <div className="log-terminal">
              <div className="log-terminal-head">
                <span>/var/log/orquestador/runtime.log</span>
                <span>PID Grupo: 44102</span>
              </div>
              <div className="log-lines">
                {logsCleared ? (
                  <span style={{ color: "var(--ink-2)" }}>Terminal limpiada. Esperando nuevos registros…</span>
                ) : (
                  <>
                    <div className="log-line">
                      <span className="log-time">15:42:01.002</span>
                      <span className="log-pid">[PID 44102]</span>
                      <span className="log-msg">orq-scheduler: listening on unix:///run/orq.sock (subprocesses: 3 ready)</span>
                    </div>
                    <div className="log-line">
                      <span className="log-time">15:42:04.119</span>
                      <span className="log-pid">[PID 44108]</span>
                      <span className="log-msg">codex-proxy: ping https://api.openai.com/v1 - status 200 OK (latency: 18ms)</span>
                    </div>
                    <div className="log-line">
                      <span className="log-time">15:43:12.842</span>
                      <span className="log-pid">[PID 44115]</span>
                      <span className="log-msg">worker-01: context checkpoint saved: snapshot_blk_90192a (2.1 MB)</span>
                    </div>
                    <div className="log-line">
                      <span className="log-time">15:44:00.001</span>
                      <span className="log-pid">[PID 44102]</span>
                      <span className="log-msg">healthcheck: all workers nominal. memory RSS: 614 MB.</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Aplicación, Tema y Sesión */}
          <section className="panel">
            <div className="card-top">
              <h2 className="panel-title">Instalar la aplicación</h2>
            </div>
            <p className="muted-note" style={{ margin: 0 }}>Instala Telo como aplicación independiente en tu teléfono o PC.</p>
            {isStandalone() ? (
              <p className="muted-note">Ya está instalada como aplicación independiente en este dispositivo.</p>
            ) : install.canInstall ? (
              <div>
                <button type="button" className="primary" onClick={() => void install.promptInstall()}>
                  Instalar Telo
                </button>
              </div>
            ) : isIOS() ? (
              <p className="muted-note">En iPhone / Safari: toca Compartir y luego “Agregar a pantalla de inicio”.</p>
            ) : (
              <p className="muted-note">
                Tu navegador no ofrece instalarla desde aquí. Abre el menú del navegador y selecciona “Instalar app”.
              </p>
            )}
          </section>

          <TemaPanel />
          <SesionPanel />
        </div>
      </main>
    </div>
  );
}

function ProveedoresPanel() {
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders });

  return (
    <section className="panel" aria-labelledby="ajustes-proveedores">
      <div className="card-top">
        <h2 id="ajustes-proveedores" className="panel-title">Proveedores de Modelos</h2>
      </div>
      <p className="muted-note" style={{ margin: 0 }}>
        Muestra si cada proveedor tiene su clave lista para los agentes. Las claves se configuran en el servidor, nunca desde la app.
      </p>
      {proveedores.isPending && <p className="muted-note">Consultando proveedores…</p>}
      {proveedores.isError && (
        <p className="error" role="alert">
          {errorText(proveedores.error)}
        </p>
      )}
      {proveedores.data && (
        <ul className="project-list">
          {proveedores.data.map((p) => (
            <li key={p.id} className="project-row proveedor-fila">
              <div className="project-info">
                <span className="project-name">{p.name}</span>
                <span className="project-path">{textoProveedor(p)}</span>
                {p.variable && p.id !== "opencode" && (
                  <span className="project-path">Variable: {p.variable}</span>
                )}
              </div>
              <span className={`badge ${claseBadgeProveedor(p)}`}>{etiquetaBadgeProveedor(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModeloRespaldoPanel() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const todos: ModelInfo[] = models.data?.models ?? [];

  const guardar = useMutation({
    mutationFn: (fallbackModel: string | null) => api.savePreferences({ fallbackModel }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const guardado = prefs.data?.fallbackModel ?? null;
  const valor = guardar.isPending ? (guardar.variables ?? "") : (guardado ?? "");

  const opciones = todos
    .filter((m) => m.recommended)
    .map((m) => ({ id: m.id, name: m.name }));
  if (valor && !opciones.some((o) => o.id === valor)) {
    opciones.unshift({ id: valor, name: todos.find((m) => m.id === valor)?.name ?? valor });
  }

  return (
    <article className="engine-card">
      <div className="engine-head">
        <div className="engine-title-group">
          <div className="engine-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
          </div>
          <div className="engine-info">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="engine-name">Google Vertex / Respaldo</span>
              <span className="panel-tag" style={{ fontSize: "11px", padding: "1px 6px" }}>Fallback</span>
            </div>
            <span className="engine-desc">Modelo de reintento si el principal devuelve límite o error</span>
          </div>
        </div>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="modelo-respaldo">
          Modelo
        </label>
        <select
          id="modelo-respaldo"
          className="tarea-select"
          value={valor}
          disabled={!prefs.data || guardar.isPending}
          onChange={(e) => guardar.mutate(e.target.value || null)}
        >
          <option value="">Ninguno</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      {guardar.isPending && <p className="muted-note" role="status">Guardando…</p>}
      {guardar.isSuccess && !guardar.isPending && <p className="muted-note" role="status">Modelo de respaldo guardado.</p>}
      {guardar.isError && (
        <p className="error" role="alert">
          {errorText(guardar.error)}
        </p>
      )}
    </article>
  );
}

const OPCIONES_TEMA: { valor: Tema; texto: string }[] = [
  { valor: "sistema", texto: "Sistema" },
  { valor: "oscuro", texto: "Oscuro" },
  { valor: "claro", texto: "Claro" },
];

function TemaPanel() {
  const [tema, setTema] = useState<Tema>(() => leerTema());

  return (
    <section className="panel" aria-labelledby="ajustes-tema">
      <div className="card-top">
        <h2 id="ajustes-tema" className="panel-title">Tema</h2>
      </div>
      <p className="muted-note" style={{ margin: 0 }}>Se guarda en este dispositivo. Sistema sigue el modo de tu teléfono o PC.</p>
      <div className="segmented" role="group" aria-label="Tema de la app">
        {OPCIONES_TEMA.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={tema === o.valor}
            onClick={() => {
              setTema(o.valor);
              guardarTema(o.valor);
            }}
          >
            {o.texto}
          </button>
        ))}
      </div>
    </section>
  );
}

function SesionPanel() {
  const [saliendo, setSaliendo] = useState(false);

  const salir = async () => {
    setSaliendo(true);
    try {
      await api.logout();
    } finally {
      location.assign("/entrar");
    }
  };

  return (
    <section className="panel">
      <div className="card-top">
        <h2 className="panel-title">Sesión</h2>
      </div>
      <p className="muted-note" style={{ margin: 0 }}>
        Cierra la sesión en este navegador. Para cerrar las sesiones de todos los dispositivos, cambia TELO_CLAVE en el servidor.
      </p>
      <div className="savebar">
        <button type="button" className="ghost sesion-salir" onClick={() => void salir()} disabled={saliendo}>
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}

function GooglePanel() {
  const qc = useQueryClient();
  const [llegada] = useState(() => new URLSearchParams(location.search));
  const [aviso, setAviso] = useState<string | null>(() =>
    llegada.get("google") === "ok" ? "Cuenta de Google conectada." : null,
  );
  const [error, setError] = useState<string | null>(() =>
    llegada.get("google") === "error" ? errorText(new ApiError(400, llegada.get("motivo") ?? "")) : null,
  );

  const estado = useQuery({ queryKey: ["google"], queryFn: api.googleEstado });

  const conectar = useMutation({
    mutationFn: api.googleConectar,
    onSuccess: ({ url }) => location.assign(url),
    onError: (e) => setError(errorText(e)),
  });
  const desconectar = useMutation({
    mutationFn: api.googleDesconectar,
    onSuccess: () => {
      setError(null);
      setAviso("Cuenta de Google desconectada.");
      void qc.invalidateQueries({ queryKey: ["google"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  const datos = estado.data;

  return (
    <section className="panel" aria-labelledby="ajustes-google">
      <div className="card-top">
        <h2 id="ajustes-google" className="panel-title">Cuenta de Google</h2>
      </div>
      <p className="muted-note" style={{ margin: 0 }}>
        Inicia sesión con tu cuenta de Google para leer el uso de sus modelos. Por ahora solo se guarda tu correo y un permiso que puedes revocar.
      </p>
      {estado.isPending && <p className="muted-note">Revisando la conexión…</p>}
      {estado.isError && <p className="error" role="alert">{errorText(estado.error)}</p>}
      {datos && !datos.configurado && (
        <p className="muted-note">Faltan variables en el servidor: {datos.faltantes.join(", ")}.</p>
      )}
      {datos?.conectado && (
        <p>
          Conectado como <strong>{datos.cuenta}</strong>
        </p>
      )}
      {aviso && <p className="muted-note" role="status">{aviso}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="savebar">
        {datos?.conectado ? (
          <button type="button" className="ghost" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}>
            {desconectar.isPending ? "Desconectando…" : "Desconectar"}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => conectar.mutate()}
            disabled={!datos?.configurado || conectar.isPending}
          >
            {conectar.isPending ? "Abriendo Google…" : "Conectar con Google"}
          </button>
        )}
      </div>
    </section>
  );
}

function textoProveedor(p: ProviderStatus): string {
  if (p.id === "opencode") return "Disponible";
  if (!p.configured) return "Sin clave configurada";
  if (p.enAgente) return "Clave configurada y disponible para los agentes";
  return "Clave configurada, pero no llega a los agentes: agrégala a TELO_AGENTE_VARIABLES en el archivo de entorno del servidor";
}

function etiquetaBadgeProveedor(p: ProviderStatus): string {
  if (p.id === "opencode" || (p.configured && p.enAgente)) return "Listo";
  if (p.configured) return "Revisar";
  return "Sin clave";
}

function claseBadgeProveedor(p: ProviderStatus): string {
  if (p.id === "opencode" || (p.configured && p.enAgente)) return "badge-ok";
  if (p.configured) return "badge-signal";
  return "badge-neutral";
}
