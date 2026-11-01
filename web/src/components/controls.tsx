import { useEffect, useRef, type RefObject } from "react";
import type { CostTier } from "../api";
import { effortLabel, tierBars, TIER_LABEL } from "../lib/model";

export function CostMeter({ tier }: { tier: CostTier }) {
  if (tier === "desconocido") return <span className="meter" role="img" aria-label="Precio no disponible">?</span>;
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

// Elementos a los que Tab puede llegar dentro de un diálogo.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogos y hojas: Escape llama a onCerrar y el Tab no sale del diálogo mientras está abierto.
// Quien cierra se encarga de devolver el foco a su disparador.
export function useDialogo(ref: RefObject<HTMLElement | null>, onCerrar: () => void) {
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrarRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const el = ref.current;
      if (!el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = items[0];
      const ultimo = items[items.length - 1];
      const activo = document.activeElement;
      const fuera = !activo || !el.contains(activo);
      if (e.shiftKey && (fuera || activo === primero)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (fuera || activo === ultimo)) {
        e.preventDefault();
        primero.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}
