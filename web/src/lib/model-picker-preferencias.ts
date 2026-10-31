const STORAGE_KEY = "telo_model_picker_v1";

export type PreferenciasSelectorModelos = {
  fijados: string[];
};

export const preferenciasSelectorVacias = (): PreferenciasSelectorModelos => ({ fijados: [] });

export function leerPreferenciasSelector(): PreferenciasSelectorModelos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return preferenciasSelectorVacias();
    const parsed = JSON.parse(raw) as Partial<PreferenciasSelectorModelos>;
    return {
      fijados: Array.isArray(parsed.fijados) ? parsed.fijados.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return preferenciasSelectorVacias();
  }
}

export function guardarPreferenciasSelector(preferencias: PreferenciasSelectorModelos): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferencias));
  } catch {
    // El selector sigue funcionando aunque el navegador no permita almacenamiento local.
  }
}

export function normalizarIdAnalisis(id: string): string {
  const nombre = (id.toLowerCase().split("/").at(-1) ?? id.toLowerCase()).split(":", 1)[0];
  return nombre
    .replace(/(?:[-.](?:free|latest|preview|thinking|reasoning|high|medium|low))+$/i, "")
    .replace(/[^a-z0-9]/g, "");
}
