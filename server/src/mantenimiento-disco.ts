import { existsSync, lstatSync, realpathSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { conTarea } from "./workspace";
import { conversacionEnCurso, proyectoOcupado } from "./ocupacion";
import { dependenciasRetirables, retirarDependencias } from "./dependencias-disco";
import { enMantenimiento, registrarTrabajo } from "./despliegue";

export type PoliticaDisco = { automatica: boolean; umbral: number; intervaloHoras: number; antiguedadDias: number };
export type ResultadoDisco = { fecha: string; modo: "analizar" | "limpiar"; carpetas: number; ocupadas: number; errores: number; libreAntes: number | null; libreDespues: number | null };
const PREDETERMINADA: PoliticaDisco = { automatica: false, umbral: 85, intervaloHoras: 24, antiguedadDias: 7 };
let enCurso = false;
function leer<T>(clave: string, defecto: T): T {
  try { return JSON.parse(db.query<{ value: string }, [string]>("SELECT value FROM app_settings WHERE key=?").get(clave)?.value ?? "null") ?? defecto; }
  catch { return defecto; }
}
function guardar(clave: string, valor: unknown) {
  db.query("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(clave, JSON.stringify(valor));
}
export function validarPoliticaDisco(valor: unknown): valor is PoliticaDisco {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const p = valor as PoliticaDisco;
  return Object.keys(p).length === 4 && typeof p.automatica === "boolean"
    && Number.isInteger(p.umbral) && p.umbral >= 75 && p.umbral <= 95
    && Number.isInteger(p.intervaloHoras) && p.intervaloHoras >= 6 && p.intervaloHoras <= 168
    && Number.isInteger(p.antiguedadDias) && p.antiguedadDias >= 1 && p.antiguedadDias <= 90;
}
export function estadoMantenimiento() {
  const politica = leer<PoliticaDisco>("disco:politica", PREDETERMINADA);
  return { politica: validarPoliticaDisco(politica) ? politica : PREDETERMINADA, ultimo: leer<ResultadoDisco | null>("disco:ultimo", null), enCurso };
}
export function guardarPoliticaDisco(p: PoliticaDisco) {
  if (!validarPoliticaDisco(p)) throw new Error("Política de limpieza inválida");
  guardar("disco:politica", p);
}
function capacidad() {
  try { const s = statfsSync(config.dataDir); return { libre: Number(s.bavail) * Number(s.bsize), uso: (1 - Number(s.bavail) / Number(s.blocks)) * 100 }; }
  catch { return { libre: null, uso: 0 }; }
}
export function correspondeLimpieza(p: PoliticaDisco, ultima: string | null, uso: number, ahora = Date.now()): boolean {
  const fecha = ultima ? Date.parse(ultima) : NaN;
  const transcurrido = Number.isFinite(fecha) ? ahora - fecha : Infinity;
  // Evita reintentar cada minuto cuando el disco sigue alto y ya no quedan candidatos.
  return p.automatica && transcurrido >= 3600_000 && (uso >= p.umbral || transcurrido >= p.intervaloHoras * 3600_000);
}
export async function mantenerDisco(modo: "analizar" | "limpiar"): Promise<ResultadoDisco | null> {
  if (enCurso || enMantenimiento()) return null;
  enCurso = true;
  const finalizar = registrarTrabajo();
  const r: ResultadoDisco = { fecha: new Date().toISOString(), modo, carpetas: 0, ocupadas: 0, errores: 0, libreAntes: capacidad().libre, libreDespues: null };
  try {
    const p = estadoMantenimiento().politica;
    const tareas = resolve(config.dataDir, "tasks");
    if (!existsSync(tareas)) return r;
    if (lstatSync(tareas).isSymbolicLink() || realpathSync(tareas) !== tareas) throw new Error("Directorio de tareas inválido");
    const filas = db.query<{ id: string }, [string]>("SELECT id FROM tasks WHERE status IN ('done','failed','cancelled') AND finished_at < datetime('now', ?) ORDER BY finished_at").all(`-${p.antiguedadDias} days`);
    for (const { id } of filas) {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) continue;
      await conTarea(id, async () => {
        const disponible = () => {
          const t = db.query<{ status: string; finished_at: string | null; conversation_id: string | null; project_id: string | null }, [string, string]>("SELECT status,finished_at,conversation_id,project_id FROM tasks WHERE id=? AND finished_at < datetime('now', ?)").get(id, `-${p.antiguedadDias} days`);
          return !!t && ["done", "failed", "cancelled"].includes(t.status)
            && !(t.conversation_id && conversacionEnCurso(t.conversation_id)) && !(t.project_id && proyectoOcupado(t.project_id));
        };
        if (!disponible()) { r.ocupadas++; return; }
        const carpeta = join(tareas, id);
        if (!existsSync(carpeta)) return;
        try {
          if (lstatSync(carpeta).isSymbolicLink() || realpathSync(carpeta) !== carpeta) { r.errores++; return; }
          const repo = join(carpeta, "repo");
          const rutas = modo === "limpiar" ? await retirarDependencias(repo, disponible) : await dependenciasRetirables(repo);
          r.carpetas += rutas.length;
        } catch { r.errores++; }
      });
      // Cede el bucle entre tareas para mantener la API disponible.
      await Bun.sleep(0);
    }
    return r;
  } finally {
    r.libreDespues = capacidad().libre;
    try {
      guardar("disco:ultimo", r);
      if (modo === "limpiar") guardar("disco:ultimaLimpieza", r.fecha);
    } finally { enCurso = false; finalizar(); }
  }
}
let reloj: ReturnType<typeof setInterval> | null = null;
export function iniciarMantenimientoDisco() {
  if (reloj) return;
  reloj = setInterval(() => {
    try {
      const p = estadoMantenimiento().politica;
      if (correspondeLimpieza(p, leer<string | null>("disco:ultimaLimpieza", null), capacidad().uso)) {
        void mantenerDisco("limpiar").catch(() => console.error("No se pudo completar el mantenimiento de disco"));
      }
    } catch { console.error("No se pudo consultar la política de mantenimiento de disco"); }
  }, 60_000);
  reloj.unref();
}
