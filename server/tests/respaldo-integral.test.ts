import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const raiz = mkdtempSync(join(tmpdir(), "telo-respaldo-integral-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));
async function ejecutar(datos: string, copias: string, extra: Record<string, string> = {}, preload?: string) {
  const p = Bun.spawn([process.execPath, "--no-env-file", ...(preload ? ["--preload", preload] : []), resolve(import.meta.dir, "../scripts/respaldo.ts")], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATA_DIR: datos, TELO_RESPALDOS_DIR: copias, TELO_RESPALDO_PRUEBA_AISLADA: "1", ...extra },
    stdout: "pipe", stderr: "pipe",
  });
  const [salida, error, codigo] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { salida, error, codigo };
}

test("el conjunto recupera proyectos y sesiones con WAL abierto, sin depender del original", async () => {
  const datos = join(raiz, "datos"), copias = join(raiz, "copias"), restaurado = join(raiz, "restaurado");
  const pid = crypto.randomUUID(), proyecto = join(raiz, "proyectos", pid);
  const perfil = join(datos, "perfiles-opencode", "sesion", "data", "opencode");
  mkdirSync(perfil, { recursive: true }); mkdirSync(proyecto, { recursive: true }); mkdirSync(restaurado);
  writeFileSync(join(proyecto, "codigo.ts"), "export const conservado = true;");
  const principal = new Database(join(datos, "orquestador.db"));
  principal.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,repo_path TEXT)");
  principal.query("INSERT INTO projects VALUES (?,?)").run(pid, proyecto); principal.close();
  const sesion = new Database(join(perfil, "opencode.db"));
  sesion.exec("PRAGMA journal_mode=WAL; CREATE TABLE sesion(mensaje TEXT); INSERT INTO sesion VALUES ('Continuar desde aquí')");
  try {
    const r = await ejecutar(datos, copias);
    expect(r.codigo, r.error).toBe(0);
    const tar = readdirSync(copias).find(n => n.endsWith(".tar.gz"))!;
    if (process.platform !== "win32") {
      for (const nombre of readdirSync(copias).filter(n => /\.(db|gz)$/.test(n))) expect(statSync(join(copias, nombre)).mode & 0o077).toBe(0);
    }
    expect(Bun.spawnSync(["tar", "-xzf", join(copias, tar), "-C", restaurado]).exitCode).toBe(0);
    expect(readFileSync(join(restaurado, "proyectos", pid, "codigo.ts"), "utf8")).toContain("conservado");
    const recuperada = new Database(join(restaurado, "perfiles-opencode", "sesion", "data", "opencode", "opencode.db"), { readonly: true });
    try {
      expect(recuperada.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(recuperada.query("SELECT mensaje FROM sesion").get()).toEqual({ mensaje: "Continuar desde aquí" });
    } finally { recuperada.close(); }
    const inventario = JSON.parse(readFileSync(join(restaurado, "inventario.json"), "utf8"));
    expect(inventario.proyectos[0]).toEqual({ id: pid, origen: proyecto, archivo: `proyectos/${pid}` });
  } finally { sesion.close(); }
});

test("R2 con cero copias locales informa éxito después de retirar sus archivos", async () => {
  const datos = join(raiz, "cero-datos"), copias = join(raiz, "cero-copias"), preload = join(raiz, "r2-falso.ts");
  mkdirSync(datos);
  const db = new Database(join(datos, "orquestador.db")); db.exec("CREATE TABLE prueba(id INTEGER)"); db.close();
  const modulo = resolve(import.meta.dir, "../src/respaldo-r2-s3.ts");
  const sincronizar = resolve(import.meta.dir, "../src/respaldo-r2.ts");
  writeFileSync(preload, `import {mock} from 'bun:test';\nmock.module(${JSON.stringify(modulo)},()=>({leerConfiguracionR2Respaldos:()=>({prefijo:'fixture/',conservar:1,conservarLocal:0}),crearAlmacenR2Respaldos:()=>({almacen:{},cerrar(){}})}));\nmock.module(${JSON.stringify(sincronizar)},()=>({sincronizarRespaldosR2:async()=>({conjuntosCompletos:1,subidos:3,retirados:0})}));`);
  const r = await ejecutar(datos, copias, {}, preload);
  expect(r.codigo, r.error).toBe(0);
  expect(r.salida).toContain("Respaldo verificado");
  expect(readdirSync(copias).filter(n => /\.(db|gz)$/.test(n))).toEqual([]);
});
