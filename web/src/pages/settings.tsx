import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Preferences, type ProviderStatus } from "../api";
import { EffortControl } from "../components/controls";
import { ModelPicker } from "../components/model-picker";
import { isIOS, isStandalone, useInstallPrompt } from "../lib/install";
import { errorText } from "../lib/model";
import { useShell } from "../components/shell-context";

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
    mutationFn: (payload: Preferences) => api.savePreferences(payload),
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
    save.mutate({ ...draft, monthlyBudgetUsd: budget });
  };

  const dirty = draft !== null || budgetText !== (prefs.data?.monthlyBudgetUsd?.toString() ?? "");

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
        <ProyectosPanel />
        <ProveedoresPanel />
        <SesionPanel />
      </div>
    </main>
  );
}

// Carpetas del servidor donde pueden trabajar los chats y las tareas.
function ProyectosPanel() {
  const qc = useQueryClient();
  const proyectos = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const [ruta, setRuta] = useState("");
  const [nombre, setNombre] = useState("");

  const crear = useMutation({
    mutationFn: () => api.createProject({ path: ruta.trim(), name: nombre.trim() || undefined }),
    onSuccess: () => {
      setRuta("");
      setNombre("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const quitar = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState("");
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; pinned?: boolean } }) =>
      api.updateProject(id, body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  return (
    <section className="panel">
      <div className="card-top">
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <h2>Proyectos</h2>
        </div>
      </div>
      <p className="muted-note">
        Carpetas del servidor donde los chats y las tareas pueden trabajar. El agente puede modificar archivos dentro de ellas.
      </p>

      {proyectos.isError && <p className="error" role="alert">No se pudieron cargar los proyectos.</p>}
      {proyectos.data?.length === 0 && <p className="muted-note">Todavía no hay proyectos.</p>}
      {proyectos.data && proyectos.data.length > 0 && (
        <ul className="project-list">
          {proyectos.data.map((p) => (
            <li key={p.id} className="project-row">
              {editandoId === p.id ? (
                <form
                  className="conv-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const nuevo = nombreEditado.trim();
                    if (nuevo && nuevo !== p.name) editar.mutate({ id: p.id, body: { name: nuevo } });
                    setEditandoId(null);
                  }}
                >
                  <input
                    className="conv-rename-input"
                    aria-label="Nuevo nombre del proyecto"
                    value={nombreEditado}
                    maxLength={60}
                    onChange={(e) => setNombreEditado(e.target.value)}
                  />
                  <div className="conv-rename-acciones">
                    <button type="submit" className="primary task-mini-btn">Guardar</button>
                    <button type="button" className="ghost task-mini-btn" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="project-info">
                    <span className="project-name">
                      {p.name}
                      {p.pinned_at && <span className="project-anclado"> · anclado</span>}
                    </span>
                    <span className="project-path">{p.repo_path}</span>
                  </div>
                  <div className="project-acciones">
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => {
                        setEditandoId(p.id);
                        setNombreEditado(p.name);
                      }}
                    >
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => editar.mutate({ id: p.id, body: { pinned: !p.pinned_at } })}
                      disabled={editar.isPending}
                    >
                      {p.pinned_at ? "Quitar ancla" : "Anclar"}
                    </button>
                    <button
                      type="button"
                      className="ghost task-mini-btn"
                      onClick={() => quitar.mutate(p.id)}
                      disabled={quitar.isPending}
                    >
                      Quitar
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="project-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ruta.trim()) crear.mutate();
        }}
      >
        <div className="field-row">
          <label className="field-label" htmlFor="proyecto-ruta">
            Carpeta
          </label>
          <input
            id="proyecto-ruta"
            className="text-input"
            placeholder="mi-proyecto"
            value={ruta}
            onChange={(e) => setRuta(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="proyecto-nombre">
            Nombre
          </label>
          <input
            id="proyecto-nombre"
            className="text-input"
            placeholder="Opcional"
            maxLength={60}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <p className="muted-note">La carpeta va dentro de la carpeta de proyectos del servidor.</p>
        {(crear.isError || quitar.isError) && (
          <p className="error" role="alert">
            {errorText(crear.error ?? quitar.error)}
          </p>
        )}
        <div className="savebar">
          <button type="submit" className="primary" disabled={!ruta.trim() || crear.isPending}>
            Agregar proyecto
          </button>
        </div>
      </form>
    </section>
  );
}

// Estado de cada proveedor en el servidor. Nunca muestra ni pide claves.
function ProveedoresPanel() {
  const proveedores = useQuery({ queryKey: ["providers"], queryFn: api.listProviders });

  return (
    <section className="panel">
      <div className="card-top">
        <div className="panel-title-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2>Proveedores</h2>
        </div>
      </div>
      <p className="muted-note">
        Muestra si cada proveedor está listo en el servidor. Las claves se configuran en el servidor, nunca desde la app.
      </p>
      {proveedores.isError && (
        <p className="error" role="alert">
          No se pudo consultar el estado de los proveedores.
        </p>
      )}
      {proveedores.data && (
        <ul className="project-list">
          {proveedores.data.map((p) => (
            <li key={p.id} className="project-row">
              <div className="project-info">
                <span className="project-name">{p.name}</span>
                <span className="project-path">{p.hint}</span>
              </div>
              <span className={`badge ${p.configured && p.implemented ? "badge-ok" : "badge-neutral"}`}>
                {estadoProveedor(p)}
              </span>
            </li>
          ))}
        </ul>
      )}
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

function estadoProveedor(p: ProviderStatus): string {
  if (!p.implemented) return p.configured ? "Clave lista · sin integrar" : "Sin integrar";
  return p.configured ? "Listo" : "Sin configurar";
}
