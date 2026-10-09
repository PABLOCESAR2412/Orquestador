import type { CostTier } from "../api";
import { effortLabel, tierBars, TIER_LABEL } from "../lib/model";

export function CostMeter({ tier }: { tier: CostTier }) {
  const on = tierBars(tier);
  return (
    <span className="meter" role="img" aria-label={`Costo: ${TIER_LABEL[tier]}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < on ? "on" : undefined} />
      ))}
    </span>
  );
}

type EffortProps = {
  variants: string[];
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
};

export function EffortControl({ variants, value, disabled, onChange }: EffortProps) {
  if (variants.length === 0) {
    return (
      <span className="muted-note">
        {disabled ? "Elige un modelo para ajustar el esfuerzo" : "Sin niveles de esfuerzo"}
      </span>
    );
  }

  const options = ["", ...variants];
  return (
    <div className="segmented" role="group" aria-label="Esfuerzo">
      {options.map((option) => (
        <button
          key={option || "auto"}
          type="button"
          aria-pressed={(value ?? "") === option}
          disabled={disabled}
          onClick={() => onChange(option || null)}
        >
          {option ? effortLabel(option) : "Auto"}
        </button>
      ))}
    </div>
  );
}
