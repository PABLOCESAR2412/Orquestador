import { TIPOS_CAMBIO, type TipoCambio } from "./plan";

function leerReporte(reporte: string | null): { tipo: TipoCambio | null; resumen: string | null } {
  if (!reporte) return { tipo: null, resumen: null };
  try {
    const datos = JSON.parse(reporte) as { tipo_cambio?: unknown; resumen?: unknown };
    return {
      tipo: typeof datos.tipo_cambio === "string" && TIPOS_CAMBIO.includes(datos.tipo_cambio as TipoCambio)
        ? datos.tipo_cambio as TipoCambio
        : null,
      resumen: typeof datos.resumen === "string" && datos.resumen.trim() ? datos.resumen.trim() : null,
    };
  } catch {
    return { tipo: null, resumen: null };
  }
}

function tipoPorArchivos(archivos: string[]): TipoCambio | null {
  const rutas = archivos.map((archivo) => archivo.replace(/\\/g, "/").toLowerCase());
  if (rutas.length && rutas.every((ruta) => /(^|\/)(docs?|documentation)(\/|$)|(^|\/)(readme|changelog|license)(\.[^/]*)?$/.test(ruta))) return "docs";
  if (rutas.length && rutas.every((ruta) => /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.[^/]+$/.test(ruta))) return "test";
  if (rutas.length && rutas.every((ruta) => /(^|\/)\.github\/workflows\//.test(ruta))) return "ci";
  return null;
}

function inferirTipo(resumen: string, archivos: string[]): TipoCambio {
  const porArchivos = tipoPorArchivos(archivos);
  if (porArchivos) return porArchivos;
  const texto = resumen.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/\b(corrige|corregir|corrigio|arregla|arreglar|arreglo|resuelve|resolver|bug|error|fallo|regresion|fix)\b/.test(texto)) return "fix";
  if (/\b(agrega|agregar|anade|anadir|incorpora|incorporar|implementa|implementar|habilita|habilitar|nueva funcion|nuevo comportamiento|feat)\b/.test(texto)) return "feat";
  if (/\b(refactor|reorganiza|reorganizar|simplifica|simplificar|limpia|limpieza)\b/.test(texto)) return "refactor";
  if (/\b(performance|rendimiento|optimiza|optimizar|perf)\b/.test(texto)) return "perf";
  if (/\b(documenta|documentar|documentacion|docs)\b/.test(texto)) return "docs";
  if (/\b(prueba|pruebas|test|tests|spec)\b/.test(texto)) return "test";
  if (/\b(build|compilacion|dependencias|paquete)\b/.test(texto)) return "build";
  if (/\b(ci|pipeline|integracion continua)\b/.test(texto)) return "ci";
  if (/\b(estilo|formato|lint|style)\b/.test(texto)) return "style";
  if (/\b(revert|revertir|revierte)\b/.test(texto)) return "revert";
  return "chore";
}

function scopeDe(archivos: string[]): string | null {
  const raices = [...new Set(archivos.map((archivo) => {
    const partes = archivo.replace(/\\/g, "/").split("/").filter(Boolean);
    if (partes.length < 2) return undefined;
    return ["apps", "packages", "services"].includes(partes[0] ?? "") ? partes[1] : partes[0];
  }).filter((parte): parte is string => Boolean(parte)))];
  return raices.length === 1 && !["docs", "documentation", "test", "tests"].includes(raices[0]!.toLowerCase()) && /^[a-z0-9._-]{1,24}$/i.test(raices[0]!)
    ? raices[0]!.toLowerCase()
    : null;
}

function asunto(resumen: string | null, archivos: string[], scope: string | null, tipo: TipoCambio): string {
  const linea = resumen?.split(/\r?\n/).map((parte) => parte.trim()).find(Boolean)?.replace(/\s+/g, " ") ?? "";
  const primera = linea.split(/(?<=[.!?])\s+/u, 1)[0]?.replace(/[.!?]+$/, "").trim() ?? "";
  if (primera && !/^(?:la )?(?:tarea|solicitud|peticion) (?:se )?(?:completo|realizo|atendio|termino)\b/i.test(primera)) {
    const sujeto = primera
      .replace(/^(?:resultado|resumen)\s*[:\-]\s*/i, "")
      .replace(/^(?:feat|fix|docs|test|refactor|perf|build|ci|style|revert|chore)(?:\([^)]+\))?:\s*/i, "")
      .replace(/^(?:se\s+)?corrigi[oó]\s+/i, "corrige ")
      .replace(/^(?:se\s+)?arregl[oó]\s+/i, "corrige ")
      .replace(/^(?:se\s+)?resolvi[oó]\s+/i, "resuelve ")
      .replace(/^(?:se\s+)?(?:añadi[oó]|agreg[oó]|incorpor[oó])\s+/i, "añade ")
      .replace(/^(?:se\s+)?implement[oó]\s+/i, "implementa ")
      .replace(/^(?:se\s+)?actualiz[oó]\s+/i, "actualiza ")
      .replace(/^(?:se\s+)?(?:refactoriz[oó]|reorganiz[oó])\s+/i, "refactoriza ");
    return sujeto.charAt(0).toLocaleLowerCase("es") + sujeto.slice(1);
  }
  if (tipo === "docs") return "actualiza la documentación";
  if (tipo === "test") return "actualiza las pruebas";
  if (tipo === "ci") return "actualiza la automatización CI";
  if (archivos.length === 1) {
    const base = archivos[0]!.replace(/\\/g, "/").split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    return `actualiza ${base}`;
  }
  return scope ? `actualiza cambios revisados en ${scope}` : "actualiza cambios revisados";
}

// El asunto describe el resultado verificado y el diff; la petición original solo expresa intención.
export function mensajeCommitConvencional(reporte: string | null, archivos: string[]): string {
  const datos = leerReporte(reporte);
  const tipo = tipoPorArchivos(archivos) ?? datos.tipo ?? inferirTipo(datos.resumen ?? "", archivos);
  const scope = scopeDe(archivos);
  let mensaje = `${tipo}${scope ? `(${scope})` : ""}: ${asunto(datos.resumen, archivos, scope, tipo)}`;
  if ([...mensaje].length > 100) mensaje = [...mensaje].slice(0, 100).join("").replace(/\s+\S*$/, "").trim();
  return mensaje;
}
