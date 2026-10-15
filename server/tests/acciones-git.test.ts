import { afterAll, afterEach, expect, test, spyOn } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const raiz = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) {
  rmSync(raiz, { recursive: true, force: true });
  process.env.TELO_PRUEBAS_INICIADAS = "1";
}
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../src/db");
const { config } = await import("../src/config");
const { gitOk } = await import("../src/git");
const { aprobarTarea, diffDeTarea, prepararCopia } = await import("../src/workspace");
const { repositoryActions } = await import("../src/routes/repository-actions");
const { guardarSecreto, entornoDeProyecto } = await import("../src/secretos");
const { githubApiPr } = await import("../src/routes/proyecto-config");
const { borrarCuentaGithubGlobal } = await import("../src/github-auth");
const originalFetch = globalThis.fetch;
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
const proyectos: { id: string; cwd: string; taskId?: string }[] = [];
const REMOTO = "https://github.com/dueno/prueba";
const TOKEN = "ghp_" + "credencialficticiaparapruebas123456789";
const TOKEN_PR = "github_pat_" + "credencialficticiaparapruebas123456789";

afterEach(() => {
  globalThis.fetch = originalFetch;
  borrarCuentaGithubGlobal();
});
afterAll(() => {
  if (claveOriginal === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = claveOriginal;
  for (const p of proyectos) {
    db.query("DELETE FROM repository_actions WHERE project_id=?").run(p.id);
    if (p.taskId) {
      db.query("DELETE FROM tasks WHERE id=?").run(p.taskId);
      const carpeta = resolve(config.dataDir, "tasks", p.taskId);
      if (!carpeta.startsWith(resolve(config.dataDir, "tasks") + sep))
        throw new Error("Carpeta fuera de tareas");
      rmSync(carpeta, { recursive: true, force: true });
    }
    db.query("DELETE FROM projects WHERE id=?").run(p.id);
    if (!resolve(p.cwd).startsWith(resolve(config.projectsDir!) + sep))
      throw new Error("Carpeta fuera de proyectos");
    rmSync(p.cwd, { recursive: true, force: true });
  }
});

function pedir(path: string, body: unknown) {
  return repositoryActions.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function proyecto() {
  const id = "acciones-test-" + randomUUID();
  const cwd = join(config.projectsDir!, id);
  mkdirSync(cwd, { recursive: true });
  db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,?,?)").run(id, id, cwd);
  const p: { id: string; cwd: string; taskId?: string } = { id, cwd };
  proyectos.push(p);
  return p;
}
async function tareaConCommit() {
  const p = proyecto();
  await gitOk(["init", "-b", "main"], { cwd: p.cwd });
  writeFileSync(join(p.cwd, "archivo.txt"), "base\n");
  await gitOk(["add", "archivo.txt"], { cwd: p.cwd });
  await gitOk(
    [
      "-c",
      "user.name=Prueba",
      "-c",
      "user.email=prueba@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Base",
    ],
    { cwd: p.cwd },
  );
  await gitOk(["remote", "add", "origin", REMOTO], { cwd: p.cwd });
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query(
    "INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Acciones','Prueba','prueba','done',?)",
  ).run(taskId, p.id);
  const copia = await prepararCopia(taskId, p.cwd, p.id);
  writeFileSync(join(copia.cwd, "archivo.txt"), "cambio aprobado\n");
  const antes = await diffDeTarea(taskId);
  await aprobarTarea(taskId, { accion: "commit", hash: antes.hash!, mensaje: "Cambio aprobado" });
  const diff = await diffDeTarea(taskId);
  db.query(
    "INSERT INTO task_approvals(id,task_id,accion,diff_hash,commit_sha,rama,remoto) VALUES (?,?,'push',?,?,?,?)",
  ).run(randomUUID(), taskId, diff.hash, diff.commit, diff.rama, REMOTO);
  process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
  guardarSecreto(p.id, "GITHUB_TOKEN", TOKEN);
  return { ...p, taskId, clon: copia.cwd, diff };
}

test("PR usa remoto real del clon aunque no exista project_git; REST recibe rama y base aprobadas", async () => {
  const p = await tareaConCommit();
  expect(db.query("SELECT 1 FROM project_git WHERE project_id=?").get(p.id)).toBeNull();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = (await respuesta.json()) as any;
  expect(JSON.parse(accion.payload).remote).toBe(REMOTO);
  let llamadas = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    llamadas++;
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba/pulls");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN_PR}`);
    const body = JSON.parse(String(init?.body));
    expect(body.head).toBe(p.diff.rama);
    expect(body.base).toBe("main");
    return Response.json({ html_url: "https://github.com/dueno/prueba/pull/1", token: TOKEN_PR });
  }) as unknown as typeof fetch;
  const aprobada = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  const texto = await aprobada.text();
  expect(aprobada.status).toBe(200);
  expect(llamadas).toBe(1);
  expect(texto).not.toContain(TOKEN_PR);
  expect(JSON.parse(texto).result).toEqual({ url: "https://github.com/dueno/prueba/pull/1" });
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
  expect(llamadas).toBe(1);
});

test("push muestra remoto fijado en clon y no el nuevo remoto de configuración", async () => {
  const p = await tareaConCommit();
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,?)").run(
    p.id,
    "https://github.com/dueno/otro",
  );
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    throw new Error("No debe llamar la red");
  }) as unknown as typeof fetch;
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = (await respuesta.json()) as any;
  expect(JSON.parse(accion.payload).remote).toBe(REMOTO);
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: false })).status).toBe(200);
  expect(llamadas).toBe(0);
});

test("si diff cambia después de solicitar PR, rechaza aprobar antes de llamar GitHub", async () => {
  const p = await tareaConCommit();
  const accion = (await (
    await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId })
  ).json()) as any;
  writeFileSync(join(p.clon, "archivo.txt"), "cambio posterior sin aprobar\n");
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    throw new Error("No debe llamar GitHub");
  }) as unknown as typeof fetch;
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
  expect(llamadas).toBe(0);
});

test("IDs de conversación y tarea exigen strings antes de consultar SQLite", async () => {
  const p = proyecto();
  for (const campo of ["conversationId", "taskId"]) {
    for (const valor of [{}, [], 123, true, null, ""]) {
      const respuesta = await pedir(`/projects/${p.id}/acciones`, {
        action: "init",
        [campo]: valor,
      });
      expect(respuesta.status).toBe(400);
      expect(((await respuesta.json()) as any).error).toBe("invalid_body");
    }
  }
  expect(db.query("SELECT 1 FROM repository_actions WHERE project_id=?").get(p.id)).toBeNull();
});

test("init rechaza .git archivo que apunta a otro repositorio y conserva su contenido", async () => {
  const otro = proyecto();
  await gitOk(["init", "-b", "main"], { cwd: otro.cwd });
  const configAntes = readFileSync(join(otro.cwd, ".git", "config"), "utf8");
  const p = proyecto();
  const gitdir = `gitdir: ${join(otro.cwd, ".git")}\n`;
  writeFileSync(join(p.cwd, ".git"), gitdir);
  const accion = (await (await pedir(`/projects/${p.id}/acciones`, { action: "init" })).json()) as any;
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
  expect(readFileSync(join(p.cwd, ".git"), "utf8")).toBe(gitdir);
  expect(readFileSync(join(otro.cwd, ".git", "config"), "utf8")).toBe(configAntes);
});


test("una autorización ejecuta commit antes de push y usa la cuenta del servidor como respaldo", async () => {
  const p=await tareaConCommit();
  const {guardarCuentaGithubGlobal,borrarCuentaGithubGlobal}=await import("../src/github-auth");
  db.query("DELETE FROM project_secrets WHERE project_id=? AND name='GITHUB_TOKEN'").run(p.id);
  guardarCuentaGithubGlobal({token:TOKEN,login:"prueba",name:"Prueba",avatar_url:"",scopes:[],actualizado_en:new Date().toISOString()});
  writeFileSync(join(p.clon,"archivo.txt"),"commit y push juntos\n");
  const accion=await (await pedir(`/projects/${p.id}/acciones`,{action:"push",taskId:p.taskId})).json() as any;
  const anterior=(await diffDeTarea(p.taskId)).commit;
  const original=Bun.spawn;
  let subidas=0;
  const espia=spyOn(Bun,"spawn").mockImplementation(((cmd:any,opts:any)=>{
    if(Array.isArray(cmd) && cmd.includes("push")) {
      subidas++;
      const commit=db.query<{commit_sha:string},[string]>("SELECT commit_sha FROM task_approvals WHERE task_id=? AND accion='commit' ORDER BY rowid DESC LIMIT 1").get(p.taskId)!;
      expect(commit.commit_sha).not.toBe(anterior);
      expect(cmd).toContain(`${commit.commit_sha}:refs/heads/${JSON.parse(accion.payload).rama}`);
      expect(opts.env.TELO_GIT_TOKEN).toBe(TOKEN);
      expect(cmd.join(" ")).not.toContain(TOKEN);
      return original([process.execPath,"-e","process.exit(0)"],{stdout:"pipe",stderr:"pipe"});
    }
    return original(cmd,opts);
  }) as typeof Bun.spawn);
  try {
    const respuesta=await pedir(`/acciones/${accion.id}/decidir`,{approve:true});
    expect(respuesta.status).toBe(200);
    expect(subidas).toBe(1);
    const diff=await diffDeTarea(p.taskId);
    expect(diff.aprobaciones.push?.sha).toBe(diff.commit);
    expect(diff.aprobaciones.push?.rama).toBe(diff.rama);
    expect((await pedir(`/acciones/${accion.id}/decidir`,{approve:true})).status).toBe(409);
    expect(subidas).toBe(1);
  } finally { espia.mockRestore(); borrarCuentaGithubGlobal(); }
});

test("merge y push_main ya no se aceptan, y una acción antigua de merge pendiente no se ejecuta", async () => {
  const p = await tareaConCommit();
  expect((await pedir(`/projects/${p.id}/acciones`, { action: "merge", taskId: p.taskId })).status).toBe(400);
  expect((await pedir(`/projects/${p.id}/acciones`, { action: "push_main", taskId: p.taskId })).status).toBe(400);
  const antigua = randomUUID();
  db.query("INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload) VALUES (?,?,?,?,?,?)").run(
    antigua,
    p.id,
    null,
    p.taskId,
    "merge",
    JSON.stringify({ hash: null, commit: null, rama: null, base: "main" }),
  );
  const respuesta = await pedir(`/acciones/${antigua}/decidir`, { approve: true });
  expect(respuesta.status).toBe(409);
  expect(((await respuesta.json()) as { detail: string }).detail).toContain("ya no está disponible");
  expect(
    db.query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?").get(antigua)?.state,
  ).toBe("failed");
});

test("crear un pull request usa solo GITHUB_PR_TOKEN, sin respaldo a GITHUB_TOKEN", async () => {
  const p = proyecto();
  guardarSecreto(p.id, "GITHUB_TOKEN", TOKEN);
  await expect(githubApiPr(p.id, "/repos/dueno/prueba/pulls", { title: "x" })).rejects.toThrow("permiso de Pull requests");

  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  let autorizacion = "";
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    autorizacion = (init.headers as Record<string, string>).Authorization;
    return new Response(JSON.stringify({ html_url: "https://github.com/dueno/prueba/pull/1" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const pr = (await githubApiPr(p.id, "/repos/dueno/prueba/pulls", { title: "x" })) as { html_url: string };
  expect(autorizacion).toBe(`Bearer ${TOKEN_PR}`);
  expect(pr.html_url).toContain("/pull/1");

  // Ninguno de los dos tokens de GitHub llega al entorno del agente.
  expect(entornoDeProyecto(p.id)).not.toHaveProperty("GITHUB_PR_TOKEN");
  expect(entornoDeProyecto(p.id)).not.toHaveProperty("GITHUB_TOKEN");
});
