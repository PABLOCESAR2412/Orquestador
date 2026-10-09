import { useEffect, useMemo, useState } from "react";
import type { ModelInfo } from "../api";
import { formatPrice } from "../lib/model";
import { CostMeter } from "./controls";

type Props = {
  models: ModelInfo[];
  currentId: string | null;
  onSelect: (model: ModelInfo | null) => void;
  onClose: () => void;
};

const MAX_RESULTS = 120;

export function ModelPicker({ models, currentId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const q = query.trim().toLowerCase();

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="picker" role="dialog" aria-label="Elegir modelo">
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
              onClick={() => onSelect(null)}
            >
              <span className="picker-main">
                <span className="picker-name">Predeterminado</span>
                <span className="picker-id">Lo que elija el servidor</span>
              </span>
            </button>
          )}

          {groups.length === 0 && <p className="muted-note pad">Ningún modelo coincide.</p>}

          {groups.map(([group, items]) => (
            <section key={group}>
              <h2 className="group-title">{group}</h2>
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="picker-item"
                  aria-current={m.id === currentId || undefined}
                  onClick={() => onSelect(m)}
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
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
