export type InformeTareaChat = {
  estado: "completado" | "fallo" | "desviacion";
  resumen: string;
  causa: string | null;
  cambios: { archivo: string; tipo: string }[];
  pruebas: { comando: string; resultado: string }[];
  pendientes: string[];
  detalles: string;
};

// Acepta el contrato actual y reportes JSON antiguos que ya quedaron guardados en el chat.
export function interpretarRespuestaTarea(texto: string): InformeTareaChat | null {
  const limpio = texto.replace(/<telo-memoria>[\s\S]*?(?:<\/telo-memoria>|$)/gi, "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const valor = JSON.parse(limpio);
    if (!valor || typeof valor !== "object" || typeof valor.resumen !== "string" ||
      !["completado", "fallo", "desviacion"].includes(valor.estado)) return null;
    const lista = (dato: unknown) => Array.isArray(dato) ? dato : [];
    return {
      estado: valor.estado as InformeTareaChat["estado"],
      resumen: valor.resumen,
      causa: typeof valor.desviacion === "string" && valor.desviacion !== valor.resumen
        ? valor.desviacion
        : typeof valor.causa === "string" ? valor.causa : null,
      cambios: lista(valor.cambios).flatMap((c) => c && typeof c === "object" && typeof c.archivo === "string"
        ? [{ archivo: c.archivo, tipo: typeof c.tipo === "string" ? c.tipo : "editar" }]
        : []),
      pruebas: lista(valor.pruebas).flatMap((p) => p && typeof p === "object" && typeof p.comando === "string"
        ? [{ comando: p.comando, resultado: typeof p.resultado === "string" ? p.resultado : "no_aplica" }]
        : []),
      pendientes: lista(valor.pendientes).filter((p): p is string => typeof p === "string"),
      detalles: JSON.stringify(valor, null, 2),
    };
  } catch {
    // Algunos reportes antiguos contienen expresiones de JS. Extrae solo cadenas JSON; nunca las ejecutes.
    const cadena = (clave: string): string | null => {
      const coincidencia = new RegExp(`"${clave}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`).exec(limpio);
      try { return coincidencia ? JSON.parse(coincidencia[1]) : null; } catch { return null; }
    };
    const estado = cadena("estado");
    const resumen = cadena("resumen");
    if (!limpio.startsWith("{") || !resumen || !["completado", "fallo", "desviacion"].includes(estado ?? "")) return null;
    return {
      estado: estado as InformeTareaChat["estado"],
      resumen,
      causa: cadena("desviacion"),
      cambios: [],
      pruebas: [],
      pendientes: [],
      detalles: limpio,
    };
  }
}
