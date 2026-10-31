// shortcut: la CLI omite los metadatos del mensaje; reconocer solo la plantilla
// oficial completa de OpenCode. Ampliar esta firma si cambia su formato.
const SECCIONES = ["Objective", "Important Details", "Work State", "Completed", "Active", "Blocked", "Next Move", "Relevant Files"];

export function esResumenCompactacion(texto: string): boolean {
  const limpio = texto.trim();
  if (!/^## Objective\s*\r?\n/.test(limpio)) return false;
  const sinCodigo = limpio.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
  const titulos = [...sinCodigo.matchAll(/^#{2,3}[ \t]+([^\r\n]+?)[ \t]*\r?$/gm)].map((m) => m[1]);
  return SECCIONES.every((seccion, indice) => titulos[indice] === seccion);
}

const registro = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function esCompactacionOpenCode(evento: unknown): boolean {
  const e = registro(evento);
  const p = registro(e.part);
  const info = registro(registro(e.properties).info);
  return e.type === "session.compacted" || e.type === "compaction" || p.type === "compaction"
    || e.summary === true || p.summary === true || info.summary === true
    || p.mode === "compaction" || info.mode === "compaction" || info.agent === "compaction"
    || (e.type === "text" && typeof p.text === "string" && esResumenCompactacion(p.text));
}
