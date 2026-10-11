// Respaldo de Telo: una copia consistente de la base y un archivo de las carpetas de trabajo.
// Se puede correr con el servidor encendido: VACUUM INTO lee una foto coherente de la base (WAL).
//
// Uso: bun run scripts/respaldo.ts
// Variables:
//   DATA_DIR                    carpeta de datos del servidor (en el VM, la de systemd)
//   TELO_RESPALDOS_DIR          dónde guardar las copias (por defecto ~/respaldos)
//   TELO_RESPALDOS_CONSERVAR    cuántas copias de cada tipo guardar (14 por defecto)

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const destino = resolve(process.env.TELO_RESPALDOS_DIR ?? join(homedir(), "respaldos"));
const conservar = Math.max(1, Number(process.env.TELO_RESPALDOS_CONSERVAR) || 14);
const origenDb = join(dataDir, "orquestador.db");

function fallar(mensaje: string): never {
  console.error(`Respaldo fallido: ${mensaje}`);
  process.exit(1);
}

if (!existsSync(origenDb)) fallar(`no existe la base ${origenDb}`);
mkdirSync(destino, { recursive: true });

// Sello UTC ordenable: 2026-10-11T05-00-00
const sello = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const copiaDb = join(destino, `orquestador-${sello}.db`);

const origen = new Database(origenDb, { readonly: true });
try {
  origen.query("VACUUM INTO ?").run(copiaDb);
} finally {
  origen.close();
}

// Una copia solo cuenta si se puede abrir, pasa la prueba de integridad y tiene tablas.
const revision = new Database(copiaDb, { readonly: true });
const integridad = revision.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check;
const tablas = revision.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()?.n ?? 0;
revision.close();
if (integridad !== "ok" || tablas === 0) {
  rmSync(copiaDb, { force: true });
  fallar(`la copia no pasó la revisión (integridad: ${integridad}, tablas: ${tablas})`);
}

// Carpetas de trabajo de chats y tareas: se archivan juntas.
const carpetas = ["chat-workspace", "tasks"].filter((c) => existsSync(join(dataDir, c)));
let archivo: string | null = null;
if (carpetas.length > 0) {
  archivo = join(destino, `espacio-${sello}.tar.gz`);
  const tar = Bun.spawnSync(["tar", "-czf", archivo, "-C", dataDir, ...carpetas]);
  if (tar.exitCode !== 0) {
    rmSync(archivo, { force: true });
    fallar(`no se pudo archivar el espacio de trabajo: ${tar.stderr.toString().slice(0, 200)}`);
  }
}

// Se guardan las N más recientes de cada tipo. El sello ordena bien por nombre.
function podar(prefijo: string, extension: string): number {
  const viejos = readdirSync(destino)
    .filter((n) => n.startsWith(prefijo) && n.endsWith(extension))
    .sort()
    .reverse()
    .slice(conservar);
  for (const n of viejos) rmSync(join(destino, n), { force: true });
  return viejos.length;
}
const retirados = podar("orquestador-", ".db") + podar("espacio-", ".tar.gz");

const kb = (ruta: string) => Math.round(statSync(ruta).size / 1024);
console.log(`Respaldo listo en ${destino}`);
console.log(`  base: ${copiaDb} (${kb(copiaDb)} KB, integridad ok, ${tablas} tablas)`);
if (archivo) console.log(`  espacio de trabajo: ${archivo} (${kb(archivo)} KB)`);
console.log(`  copias antiguas retiradas: ${retirados}`);
