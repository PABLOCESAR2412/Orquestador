import { useMemo, useRef, useState, type RefObject } from "react";
import type { ModelInfo } from "../api";
import { effortLabel, formatPrice } from "../lib/model";
import { CostMeter, useDialogo } from "./controls";

type Props = {
  models: ModelInfo[];
  currentId: string | null;
  // Con conEsfuerzo, cada modelo lista sus niveles debajo; elegir uno fija modelo y esfuerzo a la vez.
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

  // Al cambiar de modelo se conserva el esfuerzo si el nuevo también lo admite.
  const conservado = (m: ModelInfo) => (currentEffort && m.variants.includes(currentEffort) ? currentEffort : null);
  const esActual = (m: ModelInfo) => m.id === currentId;

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

  const fila = (m: ModelInfo, esfuerzo: string | null) => (
    <button
      type="button"
      className="picker-item"
      aria-current={esActual(m) || undefined}
      onClick={() => elegir(m, esfuerzo)}
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
      <div className="picker" role="dialog" aria-modal="true" aria-label="Elegir modelo" ref={dialogRef}>
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
              aria-current={currentId === null || undefined}
              onClick={() => elegir(null)}
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
                {items.map((m) =>
                  conEsfuerzo && m.variants.length > 0 ? (
                    <div key={m.id} className="picker-modelo">
                      {fila(m, conservado(m))}
                      <div className="picker-niveles" role="group" aria-label={`Esfuerzo de ${m.name}`}>
                        <button
                          type="button"
                          className="picker-nivel"
                          aria-pressed={esActual(m) && !currentEffort}
                          onClick={() => elegir(m, null)}
                        >
                          Auto
                        </button>
                        {m.variants.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className="picker-nivel"
                            aria-pressed={esActual(m) && currentEffort === v}
                            onClick={() => elegir(m, v)}
                          >
                            {effortLabel(v)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="picker-modelo">
                      {fila(m, null)}
                    </div>
                  ),
                )}
              </section>
            ))}
        </div>
      </div>
    </>
  );
}
