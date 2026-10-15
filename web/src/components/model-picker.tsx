import { useMemo, useRef, useState, type RefObject } from "react";
import type { ModelInfo } from "../api";
import { formatPrice } from "../lib/model";
import { CostMeter, EffortControl, useDialogo } from "./controls";
import "../styles-picker.css";

type Props = {
  models: ModelInfo[];
  currentId: string | null;
  // Con conEsfuerzo, modelo y esfuerzo se aplican juntos al confirmar.
  conEsfuerzo?: boolean;
  currentEffort?: string | null;
  // El esfuerzo solo llega cuando conEsfuerzo está activo. null significa "Auto".
  onSelect: (model: ModelInfo | null, effort?: string | null) => void;
  onClose: () => void;
  // Chip o botón que abrió el selector: recibe el foco al cerrar.
  disparador?: RefObject<HTMLElement | null>;
  cargando?: boolean;
  error?: string | null;
  onReintentar?: () => void;
};

const MAX_RESULTS = 120;

export function ModelPicker({
  models,
  currentId,
  conEsfuerzo = false,
  currentEffort = null,
  onSelect,
  onClose,
  disparador,
  cargando = false,
  error = null,
  onReintentar,
}: Props) {
  const [query, setQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [draftId, setDraftId] = useState(currentId);
  const [draftEffort, setDraftEffort] = useState(currentEffort);
  const draftModel = models.find((m) => m.id === draftId) ?? null;
  const esfuerzoValido =
    draftEffort && draftModel?.variants.includes(draftEffort) ? draftEffort : null;
  const q = query.trim().toLowerCase();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Si no hay disparador, vuelve el elemento que tenía el foco al abrir.
  const [previo] = useState(() => document.activeElement as HTMLElement | null);

  const devolverFoco = () => (disparador?.current ?? previo)?.focus();
  const cerrar = () => {
    devolverFoco();
    onClose();
  };
  useDialogo(dialogRef, cerrar);

  const elegir = (m: ModelInfo | null, esfuerzo: string | null = null) => {
    devolverFoco();
    onSelect(m, conEsfuerzo ? esfuerzo : undefined);
  };

  const seleccionar = (m: ModelInfo | null) => {
    if (!conEsfuerzo) return elegir(m);
    setDraftId(m?.id ?? null);
    // Al cambiar de modelo solo se conserva un esfuerzo compatible.
    setDraftEffort((v) => (v && m?.variants.includes(v) ? v : null));
  };
  const seleccionadoId = conEsfuerzo ? draftId : currentId;

  const groups = useMemo(() => {
    const matches = models.filter((m) => {
      if (onlyFree && !m.free) return false;
      if (q) return `${m.name} ${m.id} ${m.group}`.toLowerCase().includes(q);
      return m.recommended;
    });

    const byGroup = new Map<string, ModelInfo[]>();
    for (const m of q ? matches.slice(0, MAX_RESULTS) : matches) {
      const bucket = byGroup.get(m.group) ?? [];
      bucket.push(m);
      byGroup.set(m.group, bucket);
    }
    return [...byGroup.entries()];
  }, [models, q, onlyFree]);

  const fila = (m: ModelInfo) => (
    <button
      type="button"
      className="picker-item"
      aria-current={m.id === seleccionadoId || undefined}
      aria-pressed={conEsfuerzo ? m.id === draftId : undefined}
      onClick={() => seleccionar(m)}
    >
      <span className="picker-main">
        <span className="picker-name">{m.name}</span>
        <span className="picker-id">{m.id}</span>
      </span>
      <span className="picker-meta">
        <CostMeter tier={m.costTier} />
        <span className="picker-price" title="Precio de entrada / salida por millón de tokens">
          {formatPrice(m)}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="scrim" onClick={cerrar} />
      <div
        className={`picker${conEsfuerzo ? " picker-con-esfuerzo" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Elegir modelo"
        ref={dialogRef}
      >
        <div className="picker-head">
          <input
            className="picker-search"
            autoFocus
            placeholder="Buscar modelo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar modelo"
          />
          <button
            type="button"
            className={`pill${onlyFree ? " on" : ""}`}
            aria-pressed={onlyFree}
            onClick={() => setOnlyFree((v) => !v)}
          >
            Solo gratis
          </button>
        </div>

        <div className="picker-list">
          {!q && (
            <button
              type="button"
              className="picker-item"
              aria-current={seleccionadoId === null || undefined}
              aria-pressed={conEsfuerzo ? draftId === null : undefined}
              onClick={() => seleccionar(null)}
            >
              <span className="picker-main">
                <span className="picker-name">Predeterminado</span>
                <span className="picker-id">Lo que elija el servidor</span>
              </span>
            </button>
          )}

          {cargando && <p className="muted-note pad">Cargando modelos…</p>}

          {!cargando && error && (
            <div className="picker-estado">
              <p className="error" role="alert">
                {error}
              </p>
              {onReintentar && (
                <button type="button" className="ghost" onClick={onReintentar}>
                  Reintentar
                </button>
              )}
            </div>
          )}

          {!cargando && !error && groups.length === 0 && (
            <p className="muted-note pad">Ningún modelo coincide.</p>
          )}

          {!cargando &&
            !error &&
            groups.map(([group, items]) => (
              <section key={group}>
                <h3 className="group-title">{group}</h3>
                {items.map((m) => (
                  <div key={m.id} className="picker-modelo">
                    {fila(m)}
                  </div>
                ))}
              </section>
            ))}
        </div>
        {conEsfuerzo && (
          <div className="picker-configuracion">
            <div className="picker-eleccion">
              <strong title={draftModel?.name}>
                {draftModel?.name ?? (draftId ? "Modelo no disponible" : "Predeterminado")}
              </strong>
              <span>Esfuerzo</span>
            </div>
            <EffortControl
              variants={draftModel?.variants ?? []}
              value={esfuerzoValido}
              disabled={!draftModel}
              onChange={setDraftEffort}
            />
            <div className="picker-confirmacion">
              <button type="button" className="ghost" onClick={cerrar}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={draftId !== null && !draftModel}
                onClick={() => elegir(draftModel, esfuerzoValido)}
              >
                Usar modelo
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
