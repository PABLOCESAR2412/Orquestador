import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ModelInfo, type Preferences, type ProviderStatus } from "../api";
import { EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { guardarTema, leerTema, type Tema } from "../lib/tema";
import { useShell } from "../components/shell-context";
import "../styles-trabajo.css";

const ALERT_OPTIONS = [50, 60, 70, 80, 90, 100];

export function SettingsPage() {
  const { toggleDrawer } = useShell();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.listModels, staleTime: 5 * 60_000 });
  const install = useInstallPrompt();

  // draft es null mientras no hay cambios; así el formulario siempre muestra lo guardado.
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    // El modelo de respaldo se guarda al elegirlo en su panel: aquí no se envía, para no pisar esa elección.
    const { fallbackModel: _respaldo, ...resto } = draft;
    save.mutate({ ...resto, monthlyBudgetUsd: budget });
  };

  const dirty = draft !== null || budgetText !== (prefs.data?.monthlyBudgetUsd?.toString() ?? "");

  return (
    <main className="page tr-pagina">
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
              <span>Sistema / Control</span>
            </div>
            <h1>Ajustes y Servidor</h1>
            <p className="page-desc">
              Configuración de modelos de IA, presupuesto mensual y comportamiento de la app.
            </p>
          </div>
        </div>
      </header>

      {prefs.isError && (
        <p className="error" role="alert">
          No se pudieron cargar los ajustes.
        </p>
      )}

      {value && (
        <form
          className="settings"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <section className="panel">
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4 4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" />
                  <path d="M16 14a6 6 0 0 1 6 6v2H2v-2a6 6 0 0 1 6-6" />
                </svg>
                <h2>Modelo por defecto</h2>
              </div>
            </div>
            <p className="muted-note">Lo usan los chats nuevos y las tareas que no indican modelo específico.</p>
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
          </section>

          <section className="panel">
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                  <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
                  <path d="M18 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-8h-4z" />
                </svg>
                <h2>Presupuesto mensual</h2>
              </div>
            </div>
            <p className="muted-note">Vacío significa sin límite. Las analíticas muestran cuánto llevas acumulado.</p>
            <div className="field-row">
              <label className="field-label" htmlFor="budget">
                Límite en USD
              </label>
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
          </section>

          <section className="panel">
            <div className="card-top">
              <div className="panel-title-with-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <h2>Instalar la app</h2>
              </div>
            </div>
            <p className="muted-note">Instala Telo como aplicación independiente en tu teléfono o PC.</p>
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

          {(localError || save.isError) && (
            <p className="error" role="alert">
              {localError ?? errorText(save.error)}
            </p>
          )}

          <div className="savebar">
            {saved && !dirty && <span className="muted-note">Cambios guardados.</span>}
            <button type="submit" className="primary" disabled={!dirty || save.isPending}>
              Guardar cambios
            </button>
          </div>
        </form>
      )}

      {/* Fuera del formulario de preferencias: Enter en sus campos no guarda los ajustes. */}
      <div className="settings">
        <ProveedoresPanel />
        <GooglePanel />
        <ModeloRespaldoPanel />
        <TemaPanel />
        <SesionPanel />
      </div>
    </main>
  );
}

// Estado de cada proveedor en el servidor. Nunca muestra ni pide claves ni sus valores.
function ProveedoresPanel() {
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders });

  return (
    <section className="panel" aria-labelledby="ajustes-proveedores">
      <div className="card-top">
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2 id="ajustes-proveedores">Proveedores</h2>
        </div>
      </div>
      <p className="muted-note">
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

// Modelo al que Telo recurre una vez si el principal responde con límite o error del proveedor.
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
  // Mientras guarda, el select muestra la elección nueva.
  const valor = guardar.isPending ? (guardar.variables ?? "") : (guardado ?? "");

  const opciones = todos
    .filter((m) => m.recommended)
    .map((m) => ({ id: m.id, name: m.name }));
  if (valor && !opciones.some((o) => o.id === valor)) {
    opciones.unshift({ id: valor, name: todos.find((m) => m.id === valor)?.name ?? valor });
  }

  return (
    <section className="panel" aria-labelledby="ajustes-respaldo">
      <div className="card-top">
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <polyline points="3 3 3 8 8 8" />
          </svg>
          <h2 id="ajustes-respaldo">Modelo de respaldo</h2>
        </div>
      </div>
      <p className="muted-note">
        Si el modelo principal responde con límite de uso o error del proveedor, Telo reintenta una vez con este.
      </p>
      {prefs.isError && (
        <p className="error" role="alert">
          {errorText(prefs.error)}
        </p>
      )}
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
    </section>
  );
}

const OPCIONES_TEMA: { valor: Tema; texto: string }[] = [
  { valor: "sistema", texto: "Sistema" },
  { valor: "oscuro", texto: "Oscuro" },
  { valor: "claro", texto: "Claro" },
];

// El tema es de este dispositivo: se guarda en el navegador y se aplica al instante.
function TemaPanel() {
  const [tema, setTema] = useState<Tema>(() => leerTema());

  return (
    <section className="panel" aria-labelledby="ajustes-tema">
      <div className="card-top">
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
          </svg>
          <h2 id="ajustes-tema">Tema</h2>
        </div>
      </div>
      <p className="muted-note">Se guarda en este dispositivo. Sistema sigue el modo de tu teléfono o PC.</p>
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

// Cierra la sesión solo en este navegador: la cookie es sin estado en el servidor.
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
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <h2>Sesión</h2>
        </div>
      </div>
      <p className="muted-note">
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

// Conexión con Google para leer el uso de sus modelos. Solo guarda el correo y un permiso que se puede revocar.
function GooglePanel() {
  const qc = useQueryClient();
  // Al volver de Google, el servidor deja un código fijo en la URL. Se lee una vez al montar.
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
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          <h2 id="ajustes-google">Cuenta de Google</h2>
        </div>
      </div>
      <p className="muted-note">
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

// Texto de estado del proveedor. OpenCode no usa clave del proveedor: siempre está disponible.
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
