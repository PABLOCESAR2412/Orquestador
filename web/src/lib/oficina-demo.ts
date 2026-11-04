// Modo demostración de la oficina (?demo=N): chats falsos que cambian de estado cada pocos segundos.
// Sirve para calibrar el plano y medir el rendimiento sin depender de datos reales. Solo en desarrollo y localhost.
import { hash, type Entrada } from "./oficina-motor";

export function parametroDemo(busqueda: string, host: string, dev: boolean): number | null {
  if (!dev && host !== "localhost" && host !== "127.0.0.1") return null;
  const n = Number(new URLSearchParams(busqueda).get("demo"));
  return Number.isFinite(n) && n > 0 ? Math.min(60, Math.floor(n)) : null;
}

const TITULOS = ["Revisar API", "Migración 053", "Pruebas de pago", "Refactor chat", "Informe semanal", "Corregir login", "Optimizar consultas", "Documentar rutas", "Script de respaldo", "Auditoría de claves"];
const PASOS = ["Leyendo archivos", "Editando oficina.tsx", "Ejecutando pruebas", "Buscando en el repo", "Revisando el diff", "Escribiendo plan"];

/** Estado de N chats falsos en el instante `tick` (un tick = unos segundos). Es determinista. */
export function entradasDemo(n: number, tick: number): Entrada[] {
  const res: Entrada[] = [];
  for (let i = 0; i < n; i++) {
    const id = `demo-${i}`;
    const fase = (hash(id) + Math.floor(tick / (2 + (i % 3)))) % 9;
    const estado = fase < 3 ? "trabajando" : fase === 3 ? "aprobacion" : "libre";
    const planificando = estado === "trabajando" && fase === 2;
    res.push({
      id, titulo: `${TITULOS[i % TITULOS.length]} ${i + 1}`, estado, planificando, reciente: 1000 - i,
      actividad: estado === "trabajando" ? PASOS[(hash(id) + tick) % PASOS.length] : null,
    });
    if (estado === "trabajando" && !planificando && fase === 0) {
      const hijos = 1 + (i % 3);
      for (let h = 0; h < hijos; h++) res.push({ id: `${id}-h${h}`, titulo: `Subagente ${h + 1}`, padre: id, estado: "trabajando", reciente: 0, actividad: PASOS[(h + tick) % PASOS.length] });
    }
  }
  return res;
}
