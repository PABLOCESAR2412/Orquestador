// Respaldo de Telo: una copia consistente de la base y un archivo de las carpetas de trabajo.
// Se puede correr con el servidor encendido: VACUUM INTO lee una foto coherente de la base (WAL).
// Cuando R2 está configurado, sube y valida los conjuntos recientes antes de podar el disco local.
//
// Uso: bun run scripts/respaldo.ts
// Variables:
//   DATA_DIR                    carpeta de datos del servidor (en el VM, la de systemd)
//   TELO_RESPALDOS_DIR          dónde guardar las copias (por defecto ~/respaldos)
//   TELO_RESPALDOS_CONSERVAR    copias locales cuando R2 no está configurado (14 por defecto)
//   TELO_R2_*                   credenciales y retención del bucket privado de Cloudflare R2

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sincronizarRespaldosR2, type ConjuntoRespaldo } from "../src/respaldo-r2";
import { crearAlmacenR2Respaldos, leerConfiguracionR2Respaldos } from "../src/respaldo-r2-s3";
import { dependenciasRetirables } from "../src/dependencias-disco";

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const destino = resolve(process.env.TELO_RESPALDOS_DIR ?? join(homedir(), "respaldos"));
const conservarLocal = Math.max(1, Number(process.env.TELO_RESPALDOS_CONSERVAR) || 14);
const origenDb = join(dataDir, "orquestador.db");
const PATRON_DB = /^orquestador-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.db$/;
const PATRON_ESPACIO = /^espacio-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.tar\.gz$/;

function conjuntosLocales(): ConjuntoRespaldo[] {
  const porSello = new Map<string, ConjuntoRespaldo>();
  for (const nombre of readdirSync(destino)) {
    const sello = nombre.match(PATRON_DB)?.[1] ?? nombre.match(PATRON_ESPACIO)?.[1];
    if (!sello) continue;
    const ruta = join(destino, nombre);
    const conjunto = porSello.get(sello) ?? { sello, archivos: [] };
    conjunto.archivos.push({ nombre, ruta, bytes: statSync(ruta).size });
    porSello.set(sello, conjunto);
  }
  return [...porSello.values()]
    .filter((conjunto) => conjunto.archivos.some((archivo) => PATRON_DB.test(archivo.nombre)))
    .sort((a, b) => a.sello.localeCompare(b.sello));
}

function podarLocales(conservar: number): number {
  if (conservar === 0) {
    const antiguos = readdirSync(destino).filter((nombre) => PATRON_DB.test(nombre) || PATRON_ESPACIO.test(nombre));
    for (const nombre of antiguos) rmSync(join(destino, nombre), { force: true });
    return antiguos.length;
  }
  let retirados = 0;
  for (const [prefijo, extension] of [["orquestador-", ".db"], ["espacio-", ".tar.gz"]]) {
    const antiguos = readdirSync(destino)
      .filter((nombre) => nombre.startsWith(prefijo) && nombre.endsWith(extension))
      .sort()
      .reverse()
      .slice(conservar);
    for (const nombre of antiguos) {
      rmSync(join(destino, nombre), { force: true });
      retirados++;
    }
  }
  return retirados;
}

async function main(): Promise<void> {
  if (!existsSync(origenDb)) throw new Error(`no existe la base ${origenDb}`);
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
  let integridad: string | undefined;
  let tablas = 0;
  try {
    integridad = revision.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()?.integrity_check;
    tablas = revision.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()?.n ?? 0;
  } finally {
    revision.close();
  }
  if (integridad !== "ok" || tablas === 0) {
    rmSync(copiaDb, { force: true });
    throw new Error(`la copia no pasó la revisión (integridad: ${integridad}, tablas: ${tablas})`);
  }

  // Carpetas de trabajo de chats y tareas: se archivan juntas.
  const carpetas = ["chat-workspace", "tasks", "entregables", "chat-attachments"].filter((carpeta) => existsSync(join(dataDir, carpeta)));
  let archivo: string | null = null;
  if (carpetas.length > 0) {
    archivo = join(destino, `espacio-${sello}.tar.gz`);
    const exclusiones: string[] = [];
    if (carpetas.includes("tasks")) {
      for (const entrada of readdirSync(join(dataDir, "tasks"), { withFileTypes: true })) {
        if (!entrada.isDirectory() || entrada.isSymbolicLink() || !/^[a-f0-9-]{36}$/i.test(entrada.name)) continue;
        try {
          for (const ruta of await dependenciasRetirables(join(dataDir, "tasks", entrada.name, "repo"))) {
            const relativa = ruta.slice(dataDir.length + 1).replaceAll("\\", "/");
            // Los patrones tar no deben interpretar metacaracteres de nombres del agente.
            if (/^[a-zA-Z0-9_./@-]+$/.test(relativa)) exclusiones.push(`--exclude=${relativa}`);
          }
        } catch {
          // Si Git o sus metadatos no se pueden validar, el respaldo conserva todo.
        }
      }
    }
    const tar = Bun.spawnSync(["tar", ...exclusiones, "-czf", archivo, "-C", dataDir, ...carpetas]);
    if (tar.exitCode !== 0) {
      rmSync(archivo, { force: true });
      rmSync(copiaDb, { force: true });
      throw new Error(`no se pudo archivar el espacio de trabajo: ${tar.stderr.toString().slice(0, 200)}`);
    }
  }

  // Se valida la configuración después de crear la copia local: un error de R2 nunca deja al día sin respaldo.
  const configuracionR2 = leerConfiguracionR2Respaldos(process.env);
  const kb = (ruta: string) => Math.round(statSync(ruta).size / 1024);
  if (configuracionR2) {
    const candidatos = conjuntosLocales().slice(-configuracionR2.conservar);
    const { almacen, cerrar } = crearAlmacenR2Respaldos(configuracionR2);
    let resultado: Awaited<ReturnType<typeof sincronizarRespaldosR2>>;
    try {
      resultado = await sincronizarRespaldosR2(almacen, {
        prefijo: configuracionR2.prefijo,
        conjuntos: candidatos,
        conservar: configuracionR2.conservar,
      });
    } finally {
      cerrar();
    }

    // En la primera ejecución conserva las copias del VPS hasta confirmar suficientes conjuntos completos en R2.
    let archivosLocalesRetirados = 0;
    if (resultado.conjuntosCompletos >= Math.min(2, configuracionR2.conservar)) {
      archivosLocalesRetirados = podarLocales(configuracionR2.conservarLocal);
    }

    console.log(`Respaldo verificado en Cloudflare R2 (${resultado.conjuntosCompletos} conjuntos conservados).`);
    console.log(`  base local creada y validada: ${kb(copiaDb)} KB, integridad ok, ${tablas} tablas`);
    if (archivo) console.log(`  espacio de trabajo local creado: ${kb(archivo)} KB`);
    console.log(`  objetos subidos y comprobados: ${resultado.subidos}; conjuntos remotos retirados: ${resultado.retirados}`);
    console.log(`  archivos locales retirados tras verificar R2: ${archivosLocalesRetirados}; copias locales conservadas: ${configuracionR2.conservarLocal}`);
    return;
  }

  const retirados = podarLocales(conservarLocal);
  console.log(`Respaldo listo en ${destino}`);
  console.log(`  base: ${copiaDb} (${kb(copiaDb)} KB, integridad ok, ${tablas} tablas)`);
  if (archivo) console.log(`  espacio de trabajo: ${archivo} (${kb(archivo)} KB)`);
  console.log(`  copias antiguas retiradas: ${retirados}`);
}

main().catch((error: unknown) => {
  let mensaje = error instanceof Error ? error.message : "error desconocido";
  for (const nombre of ["TELO_R2_ACCESS_KEY_ID", "TELO_R2_SECRET_ACCESS_KEY"]) {
    const secreto = process.env[nombre];
    if (secreto) mensaje = mensaje.replaceAll(secreto, "[oculto]");
  }
  console.error(`Respaldo fallido: ${mensaje.slice(0, 500)}`);
  process.exitCode = 1;
});
