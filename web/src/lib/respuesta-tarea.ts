// Compatibilidad con reportes antiguos que se guardaron como JSON en el chat.
export function interpretarRespuestaTarea(texto: string): { resumen: string; causa: string | null; detalles: string } | null {
  const limpio = texto.replace(/<telo-memoria>[\s\S]*?(?:<\/telo-memoria>|$)/gi, "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const valor = JSON.parse(limpio);
    if (!valor || typeof valor !== "object" || typeof valor.resumen !== "string" ||
      !["completado", "fallo", "desviacion"].includes(valor.estado)) return null;
    return {
      resumen: valor.resumen,
      causa: typeof valor.desviacion === "string" && valor.desviacion !== valor.resumen ? valor.desviacion : null,
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
    return { resumen, causa: cadena("desviacion"), detalles: limpio };
  }
}
