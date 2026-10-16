import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("la migración conserva el uso anterior, respalda e ignora reintentos", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "telo-migracion-"));
  const iniciar = async () => {
    const script = `const {db}=await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/db/index.ts")).href)});db.close();`;
    const proc = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, DATA_DIR: carpeta }, stdout: "pipe", stderr: "pipe" });
    const [salida, error, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(codigo, `${salida}\n${error}`).toBe(0);
  };
  try {
    await iniciar();
    const anterior = new Database(join(carpeta, "orquestador.db"));
    anterior.exec("DROP INDEX usage_task; ALTER TABLE usage DROP COLUMN tokens_precision; ALTER TABLE usage DROP COLUMN cost_precision; DELETE FROM schema_migrations WHERE name='023_precision_uso';");
    anterior.query("INSERT INTO usage(id,provider,model,input_tokens,output_tokens,cost) VALUES ('antiguo','prueba','prueba',17,4,0.25)").run();
    anterior.close();
    await iniciar();
    const migrada = new Database(join(carpeta, "orquestador.db"));
    expect(migrada.query("SELECT input_tokens,output_tokens,cost,tokens_precision,cost_precision FROM usage WHERE id='antiguo'").get()).toEqual({ input_tokens: 17, output_tokens: 4, cost: 0.25, tokens_precision: "desconocida", cost_precision: "desconocida" });
    // Un servidor anterior puede seguir escribiendo durante una reversión del despliegue.
    migrada.query("INSERT INTO usage(id,provider,model) VALUES ('escritor-anterior','prueba','prueba')").run();
    expect(migrada.query("PRAGMA foreign_key_check").all()).toEqual([]);
    migrada.close();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
    await iniciar();
    expect(readdirSync(join(carpeta, "respaldos-migracion"))).toHaveLength(1);
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});
