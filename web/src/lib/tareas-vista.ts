import type { Task } from "../api";

// Ayudas de vista para Tareas y Analíticas. Todo sale de datos de la API; nada es de ejemplo.

// Fecha del servidor: SQLite guarda UTC sin zona ("2026-10-09 04:50:16"). Un ISO con zona se respeta.
export function fechaUtc(valor: string): Date {
  const conZona = /[Tt].*(Z|[+-]\d\d:?\d\d)$/.test(valor);
  return new Date(conZona ? valor : `${valor.replace(" ", "T")}Z`);
}

// Proveedor real del modelo elegido en la tarea. El runner de OpenCode no determina
// quién sirve la inferencia: por ejemplo, google/gemini-* usa la API oficial de Google.
export const AGENTES = [
  { id: "opencode", nombre: "OpenCode" },
  { id: "google", nombre: "Google" },
  { id: "openai", nombre: "OpenAI" },
  { id: "anthropic", nombre: "Anthropic" },
  { id: "groq", nombre: "Groq" },
  { id: "nvidia", nombre: "NVIDIA" },
  { id: "openrouter", nombre: "OpenRouter" },
] as const;

export type AgenteId = (typeof AGENTES)[number]["id"];

export function agenteDeTarea(tarea: Task): AgenteId {
  const proveedor = tarea.model?.split("/")[0];
  return AGENTES.some((a) => a.id === proveedor) ? (proveedor as AgenteId) : "opencode";
}

export function nombreAgente(id: AgenteId): string {
  return AGENTES.find((a) => a.id === id)?.nombre ?? id;
}

// Segundos entre inicio y fin de una tarea terminada. Null si no tiene los dos momentos.
export function duracionSeg(t: Task): number | null {
  if (!t.started_at || !t.finished_at) return null;
  const ms = fechaUtc(t.finished_at).getTime() - fechaUtc(t.started_at).getTime();
  return ms >= 0 ? ms / 1000 : null;
}

// "hace 12 min", "hace 3 h", "hace 2 d". Vacío si no hay fecha.
export function haceTexto(valor: string | null | undefined): string {
  if (!valor) return "";
  const min = Math.floor((Date.now() - fechaUtc(valor).getTime()) / 60_000);
  if (Number.isNaN(min)) return "";
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}
