import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const raiz = mkdtempSync(join(tmpdir(), "telo-seg-git-"));
process.env.DATA_DIR = join(raiz, "data"); process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
process.env.TELO_CLAVE_CIFRADO = Buffer.alloc(32, 8).toString("base64");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../../src/db");
const { gitOk } = await import("../../src/git");
const { prepararCopia, aprobarTarea, diffDeTarea } = await import("../../src/workspace");
const { guardarCuentaGithubGlobal } = await import("../../src/github-auth");
const origen = join(raiz, "origen.git"), cwd = join(process.env.TELO_PROYECTOS_DIR, "proyecto");
const REMOTO = "https://github.com/dueno/prueba";
const originalSpawn = Bun.spawn;
try {
  await gitOk(["init", "--bare", "-b", "main", origen], { cwd: raiz });
  await gitOk(["init", "-b", "main", cwd], { cwd: raiz });
  const commit = async (contenido: string, mensaje: string) => {
    writeFileSync(join(cwd, "archivo.txt"), contenido);
    await gitOk(["add", "archivo.txt"], { cwd });
    await gitOk(["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "commit", "-m", mensaje], { cwd });
    return (await gitOk(["rev-parse", "HEAD"], { cwd })).trim();
  };
  const base = await commit("base\n", "Base");
  await gitOk(["remote", "add", "origin", origen], { cwd });
  await gitOk(["push", "origin", "main"], { cwd });
  await gitOk(["checkout", "-b", "telo/fuente"], { cwd });
  const fuente = await commit("cambio de la rama\n", "Rama");
  await gitOk(["push", "origin", "telo/fuente"], { cwd });
  await gitOk(["checkout", "main"], { cwd });
  const main = await commit("cambio de main\n", "Main");
  await gitOk(["push", "origin", "main"], { cwd });
  await gitOk(["remote", "set-url", "origin", REMOTO], { cwd });
  const project = randomUUID();
  db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,'Prueba',?)").run(project, cwd);
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,?)").run(project, REMOTO);
  guardarCuentaGithubGlobal({ token: "ghp_token_sintetico_sin_acceso_real", login: "prueba", name: "Prueba", avatar_url: "", scopes: [], actualizado_en: new Date().toISOString() });
  Bun.spawn = ((argv: any, opts: any) => {
    if (Array.isArray(argv) && argv[0] === "git" && argv.includes("fetch")) {
      const local = argv.map((arg: string) => arg === REMOTO || arg === "origin" ? origen : arg);
      if (argv.includes("origin")) local[local.length - 1] = "refs/heads/main:refs/remotes/origin/main";
      return originalSpawn(local, opts);
    }
    return originalSpawn(argv, opts);
  }) as typeof Bun.spawn;
  const tarea = (branch: string, baseBranch: string | null, numero: number | null, sha: string) => {
    const id = randomUUID();
    db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id,source_branch,source_base_branch,source_pr_number,source_commit) VALUES (?,'Corrección','Prueba','prueba','queued',?,?,?,?,?)").run(id, project, branch, baseBranch, numero, sha);
    return id;
  };
  const conflictosId = tarea("telo/fuente", "main", 9, fuente);
  const conflictos = await prepararCopia(conflictosId, cwd, project);
  assert.equal(conflictos.rama, "telo/fuente");
  assert.equal(conflictos.base_commit, main);
  assert.match(readFileSync(join(conflictos.cwd, "archivo.txt"), "utf8"), /<<<<<<< HEAD/);
  assert.match(await gitOk(["diff", "--name-only", "--diff-filter=U"], { cwd: conflictos.cwd }), /archivo.txt/);
  const directaId = tarea("main", null, null, main);
  const directa = await prepararCopia(directaId, cwd, project);
  assert.equal(directa.rama, `telo/${directaId.slice(0, 8)}`);
  assert.equal(directa.base_commit, main);
  assert.equal((await gitOk(["rev-parse", "HEAD"], { cwd: directa.cwd })).trim(), main);
  assert(!readFileSync(join(directa.cwd, "archivo.txt"), "utf8").includes("<<<<<<<"));
  const viejaId = tarea("main", null, null, base);
  for (let intento = 0; intento < 2; intento++) {
    await assert.rejects(prepararCopia(viejaId, cwd, project), (e: any) => e.code === "publicacion_cambiada");
  }
  db.query("INSERT INTO app_settings(key,value) VALUES ('github_app_installation',?)").run(JSON.stringify({ id: 456, login: "Pablo", name: "Pablo C", account_id: 106, account_type: "User", avatar_url: "", repository_selection: "all" }));
  db.query("UPDATE tasks SET status='done' WHERE id=?").run(directaId);
  writeFileSync(join(directa.cwd, "archivo.txt"), "corrección revisable\n");
  const diff = await diffDeTarea(directaId);
  await aprobarTarea(directaId, { accion: "commit", hash: diff.hash!, mensaje: "fix: corrige comprobación" });
  assert.equal((await gitOk(["show", "-s", "--format=%ae"], { cwd: directa.cwd })).trim(), "106+Pablo@users.noreply.github.com");
  assert.equal((await gitOk(["rev-parse", "refs/heads/main"], { cwd: origen })).trim(), main);
  assert.equal((await gitOk(["rev-parse", "refs/heads/telo/fuente"], { cwd: origen })).trim(), fuente);
} finally { Bun.spawn = originalSpawn; db.close(); rmSync(raiz, { recursive: true, force: true }); }
