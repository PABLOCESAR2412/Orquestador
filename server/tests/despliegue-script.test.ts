import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : Bun.which("bash");
const raiz = mkdtempSync(join(tmpdir(), "telo-despliegue-script-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));
const probar = process.platform === "win32" || !bash || !existsSync(bash) ? test.skip : test;
async function ejecutar(modo: "ok" | "ocupado" | "arranque-falla") {
  const carpeta = join(raiz, crypto.randomUUID());
  for (const dir of [".git", "server", "web", "bin"]) mkdirSync(join(carpeta, dir), { recursive: true });
  writeFileSync(join(carpeta, "head"), "anterior\n");
  copyFileSync(resolve(import.meta.dir, "../../deploy/actualizar.sh"), join(carpeta, "actualizar.sh"));
  const programas: Record<string, string> = {
    git: `case "$1" in
diff|fetch) exit 0;;
branch) echo main;;
rev-parse) if [ "$2" = origin/main ]; then echo nueva; else cat head; fi;;
merge) echo merge >> eventos; echo nueva > head;;
reset) echo rollback >> eventos; echo anterior > head;;
*) exit 1;; esac`,
    bun: `if [ "$1" = -e ]; then exec "$TELO_BUN_REAL" "$@"; fi
if [ "$1" = run ] && [[ "$2" == */verificar-ci.ts ]]; then cat >/dev/null; echo "CI aprobado"; exit 0; fi
echo "build:$PWD" >> "$TELO_REPO/eventos"`,
    curl: `case "$*" in
  *check-runs*) echo '{"check_runs":[{"name":"servidor","status":"completed","conclusion":"success"},{"name":"interfaz","status":"completed","conclusion":"success"}]}' ;;
  *) if [ "$TELO_MODO" = ocupado ]; then echo '{"ok":true,"despliegue":{"mantenimiento":true,"activas":1}}'; else echo '{"ok":true,"despliegue":{"mantenimiento":true,"activas":0}}'; fi ;;
esac`,
    sudo: `echo "$*" >> eventos
if [ "$TELO_MODO" = arranque-falla ] && [ "$3" = start ] && [ "$(cat head)" = nueva ]; then exit 1; fi`,
    pgrep: "exit 1",
    sleep: "exit 0",
  };
  // Git Bash no distribuye flock; en Linux se usa el candado real del sistema.
  if (process.platform === "win32") programas.flock = "exit 0";
  for (const [nombre, cuerpo] of Object.entries(programas)) writeFileSync(join(carpeta, "bin", nombre), `#!/usr/bin/env bash\n${cuerpo}\n`, { mode: 0o755 });
  const p = Bun.spawn([bash!, "-c", 'export PATH="$PWD/bin:$PATH"; bash -n actualizar.sh && bash actualizar.sh'], {
    cwd: carpeta, env: { ...process.env, TELO_REPO: carpeta.replaceAll("\\", "/"), TELO_BUN_REAL: process.execPath.replaceAll("\\", "/"), TELO_MODO: modo, TELO_GITHUB_CI_TOKEN: "github_pat_token_sintetico_solo_pruebas" }, stdout: "pipe", stderr: "pipe",
  });
  const [codigo, salida, error] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { codigo, salida, error, carpeta, eventos: existsSync(join(carpeta, "eventos")) ? readFileSync(join(carpeta, "eventos"), "utf8") : "" };
}
function comprobarSalida(r: Awaited<ReturnType<typeof ejecutar>>, codigo: number) {
  if (r.codigo !== codigo) throw new Error(`despliegue salió con ${r.codigo}; stdout:\n${r.salida}\nstderr:\n${r.error}`);
}
probar("actualiza solo tras drenar y parar el servicio; la marca se retira al terminar", async () => {
  const r = await ejecutar("ok");
  comprobarSalida(r, 0);
  expect(r.eventos.indexOf("systemctl stop")).toBeLessThan(r.eventos.indexOf("merge"));
  expect(r.eventos.indexOf("merge")).toBeLessThan(r.eventos.indexOf("build:"));
  expect(r.eventos).toContain("systemctl start");
  expect(readFileSync(join(r.carpeta, ".git", "telo-arranque"), "utf8").trim()).toBe("nueva");
  expect(existsSync(join(r.carpeta, ".git", "telo-mantenimiento"))).toBe(false);
});
probar("un trabajo activo pospone sin cambiar código ni detener el servicio", async () => {
  const r = await ejecutar("ocupado");
  comprobarSalida(r, 0);
  expect(r.eventos).toBe("");
  expect(readFileSync(join(r.carpeta, "head"), "utf8").trim()).toBe("anterior");
});
probar("un fallo de arranque restaura código y recompila la versión anterior", async () => {
  const r = await ejecutar("arranque-falla");
  comprobarSalida(r, 1);
  expect(r.eventos).toContain("rollback");
  expect(r.eventos.split("build:").length - 1).toBe(6);
  expect(readFileSync(join(r.carpeta, "head"), "utf8").trim()).toBe("anterior");
  expect(readFileSync(join(r.carpeta, ".git", "telo-fallida"), "utf8").trim()).toBe("nueva");
});
