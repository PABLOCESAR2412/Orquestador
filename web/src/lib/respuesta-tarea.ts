export type InformeTareaChat = {
  estado: "completado" | "fallo" | "desviacion";
  resumen: string;
  causa: string | null;
  cambios: { archivo: string; tipo: string }[];
  pruebas: { comando: string; resultado: string }[];
  pendientes: string[];
  bloqueante_externo: string | null;
  detalles: string;
};

function detectarBloqueoAntiguo(valor: Record<string, unknown>, pendientes: string[], pruebas: { comando: string; resultado: string }[]): string | null {
  if (valor.estado !== "fallo") return null;
  const evidencia = [String(valor.resumen ?? ""), ...pendientes, ...pruebas.map((prueba) => prueba.comando + " " + prueba.resultado)].join("\n");
  const cloudflarePages = /cloudflare\s+pages|wrangler\s+pages|pages\.dev/i.test(evidencia);
  const faltaToken = /(?:CLOUDFLARE_API_TOKEN[\s\S]{0,100}(?:no\s+(?:está|se encuentra|hay|aparece|está configurado|está disponible)|falta|ausente|missing|not\s+(?:set|available|present))|(?:sin|falta|ausente|missing|not\s+(?:set|available|present))[\s\S]{0,100}CLOUDFLARE_API_TOKEN)/i;
  const faltaWorkspace = /\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b[\s\S]{0,120}(?:\bsin\b|\bno\s+(?:tiene|contiene|incluye|hay)\b|\bfalta(?:n)?\b|\bausente\b|\bmissing\b)[\s\S]{0,120}(?:package\.json|lockfile|fuentes?|dist\/)/i.test(evidencia)
    || /(?:package\.json|lockfile|fuentes?|archivos? esenciales|dist\/)[\s\S]{0,180}(?:\bfalta(?:n)?\b|\bausente\b|\bmissing\b|\bno\s+(?:está|se encuentra|existe|se encontraron|se hallaron))[\s\S]{0,180}\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b/i.test(evidencia)
    || /\bno\s+se\s+(?:encontraron|hallaron)\b[\s\S]{0,280}\b(?:archivos?|fuentes?|package\.json|lockfile|dist\/|src\/)[\s\S]{0,280}\b(?:workspace|espacio de trabajo|carpeta del proyecto)\b/i.test(evidencia);
  const motivos = [];
  if (faltaWorkspace) motivos.push(cloudflarePages
    ? "No se encontraron las fuentes de la app en el workspace. Vincula el proyecto correcto o restaura su código antes de reintentar; la publicación usa la tarjeta de Cloudflare Pages y la credencial de Ajustes → Proveedores."
    : "El workspace no contiene los archivos o fuentes necesarios para completar la tarea. Vincula el proyecto correcto o restaura su código antes de reintentar.");
  if (faltaToken.test(evidencia) && cloudflarePages) motivos.push("La tarjeta Publicar en Cloudflare Pages usa el token guardado en Ajustes → Proveedores; no lo configures en el workspace.");
  return motivos.join(" ") || null;
}

// Acepta el contrato actual y reportes JSON antiguos que ya quedaron guardados en el chat.
export function interpretarRespuestaTarea(texto: string): InformeTareaChat | null {
  const limpio = texto.replace(/<telo-memoria>[\s\S]*?(?:<\/telo-memoria>|$)/gi, "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const valor = JSON.parse(limpio);
    if (!valor || typeof valor !== "object" || typeof valor.resumen !== "string" ||
      !["completado", "fallo", "desviacion"].includes(valor.estado)) return null;
    const lista = (dato: unknown) => Array.isArray(dato) ? dato : [];
    const cambios = lista(valor.cambios).flatMap((c) => c && typeof c === "object" && typeof c.archivo === "string"
      ? [{ archivo: c.archivo, tipo: typeof c.tipo === "string" ? c.tipo : "editar" }]
      : []);
    const pruebas = lista(valor.pruebas).flatMap((p) => p && typeof p === "object" && typeof p.comando === "string"
      ? [{ comando: p.comando, resultado: typeof p.resultado === "string" ? p.resultado : "no_aplica" }]
      : []);
    let pendientes = lista(valor.pendientes).filter((p): p is string => typeof p === "string");
    const evidencia = [valor.resumen, ...pendientes, ...pruebas.map((prueba) => prueba.comando + " " + prueba.resultado)].join("\n");
    if (/cloudflare\s+pages|wrangler\s+pages|pages\.dev/i.test(evidencia)) {
      pendientes = pendientes.filter((pendiente) => !/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)[\s\S]{0,120}(?:entorno|environment|variable|\.env|workspace)|(?:entorno|environment|variable|\.env|workspace)[\s\S]{0,120}CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/i.test(pendiente));
    }
    const bloqueoDetectado = detectarBloqueoAntiguo(valor as Record<string, unknown>, pendientes, pruebas);
    const bloqueanteDeclarado = typeof valor.bloqueante_externo === "string" && valor.bloqueante_externo.trim()
      ? valor.bloqueante_externo.trim()
      : null;
    return {
      estado: valor.estado as InformeTareaChat["estado"],
      resumen: valor.resumen,
      causa: typeof valor.desviacion === "string" && valor.desviacion !== valor.resumen
        ? valor.desviacion
        : typeof valor.causa === "string" ? valor.causa : null,
      cambios,
      pruebas,
      pendientes,
      bloqueante_externo: bloqueoDetectado?.includes("No se encontraron las fuentes de la app")
        ? bloqueoDetectado
        : bloqueanteDeclarado ?? bloqueoDetectado,
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
      bloqueante_externo: null,
      detalles: limpio,
    };
  }
}
