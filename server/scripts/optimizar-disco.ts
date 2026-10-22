// Ejecutar como orquestador, con Telo detenido. Sin --aplicar solo enumera candidatos.
import { Database } from "bun:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { dependenciasRetirables, retirarDependencias } from "../src/dependencias-disco";

const aplicar = process.argv.includes("--aplicar");
const desconocidos = process.argv.slice(2).filter(arg => arg !== "--aplicar");
if (desconocidos.length) throw new Error("Uso: bun scripts/optimizar-disco.ts [--aplicar]");
if (aplicar) {
  if (process.platform !== "linux") throw new Error("La limpieza requiere la VM Linux con systemd");
  const estado = Bun.spawnSync(["systemctl", "show", "orquestador.service", "--property=ActiveState", "--value"]);
  if (estado.exitCode !== 0 || estado.stdout.toString().trim() !== "inactive") {
    throw new Error("Detén orquestador.service antes de limpiar; no se retiró ninguna dependencia");
  }
}
const datos = realpathSync(resolve(process.env.DATA_DIR ?? "./data"));
const tareas = join(datos, "tasks");
if (lstatSync(tareas).isSymbolicLink() || realpathSync(tareas) !== tareas) throw new Error("tasks no puede ser un enlace");
const db = new Database(join(datos, "orquestador.db"), { readonly: true });
try {
  const filas = db.query<{ id: string }, []>(
    "SELECT id FROM tasks WHERE status IN ('done','failed','cancelled') AND finished_at IS NOT NULL",
  ).all();
  let total = 0;
  for (const { id } of filas) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) continue;
    const carpeta = join(tareas, id);
    try {
      if (lstatSync(carpeta).isSymbolicLink() || realpathSync(carpeta) !== carpeta) continue;
      const repo = join(carpeta, "repo");
      const rutas = aplicar ? await retirarDependencias(repo) : await dependenciasRetirables(repo);
      for (const ruta of rutas) console.log(`${aplicar ? "Retirado" : "Candidato"}: ${ruta}`);
      total += rutas.length;
    } catch (error) {
      console.error(`Conservada tarea ${id}: ${error instanceof Error ? error.message : "no se pudo revisar"}`);
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") process.exitCode = 1;
    }
  }
  console.log(`${total} carpetas ${aplicar ? "retiradas" : "candidatas; simulación sin borrar dependencias"}. Conservados código, Git, sesiones y entregables.`);
} finally {
  db.close();
}
