import { Database } from "bun:sqlite";
import { constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, closeSync, readSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

function esSqlite(ruta: string): boolean {
  const fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const cabecera = Buffer.alloc(16);
    return readSync(fd, cabecera, 0, 16, 0) === 16 && cabecera.toString("ascii") === "SQLite format 3\0";
  } finally { closeSync(fd); }
}

// Los archivos normales se enlazan para evitar duplicar GB en el disco. Las bases
// se fotografían mediante SQLite: nunca se archiva una DB viva junto a un WAL ajeno.
async function copiarArbol(origen: string, destino: string, omitirCache: boolean): Promise<void> {
  mkdirSync(destino, { recursive: true, mode: 0o700 });
  const entradas = readdirSync(origen, { withFileTypes: true });
  const bases = new Set<string>();
  for (const e of entradas) if (e.isFile() && esSqlite(join(origen, e.name))) bases.add(e.name);
  let revisadas = 0;
  for (const e of entradas) {
    // Mantiene vivo el latido de mantenimiento también en árboles grandes.
    if (++revisadas % 128 === 0) await Bun.sleep(0);
    if (omitirCache && ["cache", ".cache"].includes(e.name)) continue;
    if ([...bases].some(base => [base + "-wal", base + "-shm", base + "-journal"].includes(e.name))) continue;
    const fuente = join(origen, e.name), copia = join(destino, e.name);
    if (e.isSymbolicLink()) {
      // Se conserva el enlace como enlace: nunca se recorre ni se copia su destino.
      let directorio = false;
      try { directorio = statSync(fuente).isDirectory(); } catch { /* También se conservan enlaces rotos. */ }
      symlinkSync(readlinkSync(fuente), copia, process.platform === "win32" && directorio ? "junction" : undefined);
    } else if (e.isDirectory()) await copiarArbol(fuente, copia, omitirCache);
    else if (bases.has(e.name)) {
      const db = new Database(fuente, { readonly: true });
      try { db.query("VACUUM INTO ?").run(copia); } finally { db.close(); }
      const revision = new Database(copia, { readonly: true });
      try {
        if (revision.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("Una base de sesión no pasó la revisión de integridad");
      } finally { revision.close(); }
    } else if (e.isFile()) {
      try { linkSync(fuente, copia); }
      catch { copyFileSync(fuente, copia, constants.COPYFILE_EXCL); }
    } else throw new Error("El respaldo encontró un archivo especial que no puede conservar de forma segura");
  }
}

export async function prepararEspacioRespaldo(datos: string, proyectos: string | null, temporal: string, copiaDb: string): Promise<string[]> {
  const carpetas: string[] = [];
  const inventario: { version: number; fecha: string; perfiles: string[]; proyectos: { id: string; origen: string; archivo: string }[] } = { version: 1, fecha: new Date().toISOString(), perfiles: [], proyectos: [] };
  for (const nombre of ["perfiles-opencode", "perfiles-subagente"]) {
    const origen = join(datos, nombre);
    if (!existsSync(origen)) continue;
    if (!lstatSync(origen).isDirectory() || lstatSync(origen).isSymbolicLink() || realpathSync(origen) !== resolve(origen)) throw new Error("Raíz de perfiles no válida");
    await copiarArbol(origen, join(temporal, nombre), true);
    carpetas.push(nombre); inventario.perfiles.push(nombre);
  }
  const db = new Database(copiaDb, { readonly: true });
  try {
    if (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'").get()) {
      const filas = db.query<{ id: string; repo_path: string | null }, []>("SELECT id,repo_path FROM projects").all();
      for (const p of filas) {
        if (!p.repo_path) continue;
        if (!/^[a-f\d-]{36}$/i.test(p.id)) throw new Error("No se puede resolver el inventario de proyectos");
        // El timer no hereda el entorno del servicio web: sin raíz explícita solo
        // se copian carpetas reales registradas en la foto de la base, nunca rutas recibidas por CLI.
        const ruta = resolve(p.repo_path);
        if (lstatSync(ruta).isSymbolicLink() || !lstatSync(ruta).isDirectory() || realpathSync(ruta) !== ruta) throw new Error("Carpeta registrada de proyecto no válida");
        const raiz = realpathSync(proyectos ?? dirname(ruta)), origen = realpathSync(ruta);
        if (resolve(temporal).startsWith(origen + sep)) throw new Error("El destino del respaldo no puede estar dentro de un proyecto respaldado");
        const relativa = relative(raiz, origen);
        if (!relativa || relativa.startsWith(".." + sep) || resolve(raiz, relativa) !== origen || !origen.startsWith(raiz + sep)) throw new Error("Proyecto fuera de la raíz permitida");
        const archivo = `proyectos/${p.id}`;
        await copiarArbol(origen, join(temporal, archivo), false);
        inventario.proyectos.push({ id: p.id, origen, archivo });
      }
      if (inventario.proyectos.length) carpetas.push("proyectos");
    }
  } finally { db.close(); }
  mkdirSync(temporal, { recursive: true, mode: 0o700 });
  writeFileSync(join(temporal, "inventario.json"), JSON.stringify(inventario, null, 2), { mode: 0o600 });
  return [...carpetas, "inventario.json"];
}
