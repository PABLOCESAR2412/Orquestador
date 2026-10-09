import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ModelInfo, type Preferences } from "../api";
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
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
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
            <div className="context-meta">
              <span className="context-label">Sistema / Control</span>
              <span className="context-dot">•</span>
              <span className="context-sub">Instancia local</span>
            </div>
            <h1>Ajustes</h1>
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
              <h2>Modelo por defecto</h2>
              <span className="badge badge-neutral">Preferencia global</span>
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
              <h2>Presupuesto mensual</h2>
              <span className="badge badge-neutral">Control de costos</span>
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
              <h2>Instalar la app</h2>
              <span className="badge badge-neutral">PWA</span>
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
    </main>
  );
}
