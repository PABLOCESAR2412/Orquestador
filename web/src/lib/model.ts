import { ApiError, type CostTier, type ModelInfo } from "../api";

export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Mínimo",
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export const effortLabel = (value: string) => EFFORT_LABELS[value] ?? value;

export const TIER_LABEL: Record<CostTier, string> = {
  gratis: "Gratis",
  economico: "Económico",
  medio: "Medio",
  alto: "Alto",
  premium: "Premium",
};

// Barras encendidas del medidor de costo (de 0 a 5).
const TIER_BARS: Record<CostTier, number> = {
  gratis: 0,
  economico: 1,
  medio: 2,
  alto: 4,
  premium: 5,
};

export const tierBars = (tier: CostTier) => TIER_BARS[tier];

export function formatPrice(m: ModelInfo): string {
  if (m.free) return "Sin costo";
  return `$${m.inputUsd} / $${m.outputUsd} por M`;
}

const shorten = (text: string) => text.replace(/^Error:\s*/, "").slice(0, 160);

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "insufficient_funds":
        return "Saldo insuficiente en el proveedor. Usa un modelo gratuito o recarga saldo.";
      case "runner_failed":
        return err.detail
          ? `El modelo no respondió: ${shorten(err.detail)}`
          : "El modelo no respondió. Intenta de nuevo.";
      case "invalid_content":
        return "El mensaje está vacío o supera los 10 000 caracteres.";
      case "conversation_not_found":
        return "Este chat ya no existe.";
      case "model_not_found":
        return "Ese modelo ya no está disponible.";
      case "effort_not_supported":
        return "Ese modelo no admite ese nivel de esfuerzo.";
      case "effort_requires_model":
        return "Elige un modelo antes de ajustar el esfuerzo.";
      case "models_unavailable":
        return "No se pudo cargar la lista de modelos.";
    }
  }
  return "Algo salió mal. Intenta de nuevo.";
}
