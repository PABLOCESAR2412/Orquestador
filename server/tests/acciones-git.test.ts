import { afterAll, afterEach, expect, test, spyOn } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { aprobarTarea, detectarConflictosPullRequest, diffDeTarea, limpiarCopiaCancelada, prepararCopia, reintegrarSobrePunta } = await import("../src/workspace");
const { repositoryActions } = await import("../src/routes/repository-actions");
const { guardarSecreto, entornoDeProyecto } = await import("../src/secretos");
const { fuenteAutenticacionGithub, githubApiPr } = await import("../src/routes/proyecto-config");
const { borrarCuentaGithubGlobal, guardarCuentaGithubGlobal, tokenGithubGlobal } = await import("../src/github-auth");
const { opcionesDeCredenciales } = await import("../src/git-credenciales");
const originalFetch = globalThis.fetch;
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
process.env.TELO_CLAVE_CIFRADO = Buffer.alloc(32, 7).toString("base64");
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

test("PR usa remoto real del clon aunque no exista project_git; REST recibe rama y base aprobadas", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  expect(db.query("SELECT 1 FROM project_git WHERE project_id=?").get(p.id)).toBeNull();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = (await respuesta.json()) as any;
  expect(JSON.parse(accion.payload).remote).toBe(REMOTO);
  const llamadas: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    llamadas.push(`${init?.method} ${String(url)}`);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN_PR}`);
    if (String(url) === "https://api.github.com/repos/dueno/prueba") {
      expect(init?.method).toBe("GET");
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    }
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba/pulls");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.head).toBe(p.diff.rama);
    expect(body.base).toBe("main");
    return Response.json({ html_url: "https://github.com/dueno/prueba/pull/1", token: TOKEN_PR });
  }) as unknown as typeof fetch;
  const aprobada = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  const texto = await aprobada.text();
  expect(aprobada.status).toBe(200);
  expect(llamadas).toEqual([
    "GET https://api.github.com/repos/dueno/prueba",
    "POST https://api.github.com/repos/dueno/prueba/pulls",
  ]);
  expect(texto).not.toContain(TOKEN_PR);
  expect(JSON.parse(texto).result).toEqual({ url: "https://github.com/dueno/prueba/pull/1" });
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(200);
  expect(llamadas).toHaveLength(2);

  const repetida = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(repetida.status).toBe(200);
  expect(await repetida.json()).toMatchObject({ id: accion.id, state: "approved", result: { url: "https://github.com/dueno/prueba/pull/1" } });
  expect(llamadas).toHaveLength(2);
});

test("el commit automático toma un asunto convencional de la tarea", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  db.query("UPDATE tasks SET title=?,prompt=? WHERE id=?").run(
    "Corrige el scroll al cargar diagramas",
    "Arregla el salto de scroll al cargar diagramas",
    p.taskId,
  );
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "commit", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = await respuesta.json() as { payload: string };
  expect(JSON.parse(accion.payload).message).toBe("fix: corrige el scroll al cargar diagramas");
});

test("fusionar PR por número desde el chat no crea otra tarea ni otra rama", async () => {
  const p = proyecto();
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,?)").run(p.id, REMOTO);
  process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  globalThis.fetch = (async () => Response.json({ head: { sha: "4".repeat(40) } })) as unknown as typeof fetch;
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Git',?)").run(conversationId, p.id);
  const { chat, numeroPullRequestParaFusionar } = await import("../src/routes/chat");
  try {
    expect(numeroPullRequestParaFusionar("Fusiona el PR #4")).toBe(4);
    expect(numeroPullRequestParaFusionar("haz merge del pull request número 5")).toBe(5);
    expect(numeroPullRequestParaFusionar("Fusiona https://github.com/dueno/prueba/pull/6")).toBe(6);
    expect(numeroPullRequestParaFusionar("¿Puedes fusionar el PR #4? ")).toBe(4);
    expect(numeroPullRequestParaFusionar("merge PR #7")).toBe(7);
    expect(numeroPullRequestParaFusionar("crea un PR #4")).toBeNull();
    expect(numeroPullRequestParaFusionar("¿Cómo puedo fusionar el PR #4? ")).toBeNull();
    expect(numeroPullRequestParaFusionar("fusiona el PR más reciente")).toBeNull();

    const respuesta = await chat.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fusiona el PR #4" }),
    });
    expect(respuesta.status).toBe(202);
    const cuerpo = await respuesta.json() as any;
    expect(cuerpo.action).toMatchObject({ action: "merge", task_id: null });
    expect(JSON.parse(cuerpo.action.payload)).toMatchObject({ pr_number: 4, remote: REMOTO });
    expect(db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM tasks WHERE conversation_id=?").get(conversationId)?.total).toBe(0);

    const repetida = await chat.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fusiona el PR #4" }),
    });
    expect(repetida.status).toBe(202);
    const segundaRespuesta = await repetida.json() as any;
    expect(segundaRespuesta.action.id).toBe(cuerpo.action.id);
    expect(JSON.parse(segundaRespuesta.action.payload).messageId).toBe(segundaRespuesta.messages[0].id);
    expect(db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM repository_actions WHERE conversation_id=? AND action='merge'").get(conversationId)?.total).toBe(1);
    expect(db.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM tasks WHERE conversation_id=?").get(conversationId)?.total).toBe(0);
  } finally {
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

test("no prepara un PR hasta que el commit y el push vigentes estén aprobados", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  db.query("DELETE FROM task_approvals WHERE task_id=? AND accion='commit'").run(p.taskId);
  const sinCommit = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(sinCommit.status).toBe(409);
  expect(await sinCommit.json()).toMatchObject({ error: "pr_commit_requerido" });
  expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='pr'").get(p.taskId)).toBeNull();

  await aprobarTarea(p.taskId, { accion: "commit", hash: p.diff.hash!, mensaje: "Commit de prueba" });
  db.query("DELETE FROM task_approvals WHERE task_id=? AND accion='push'").run(p.taskId);
  const sinPush = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(sinPush.status).toBe(409);
  expect(await sinPush.json()).toMatchObject({ error: "pr_push_requerido" });
  expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='pr'").get(p.taskId)).toBeNull();
});

test("PR sin commits nuevos muestra cómo corregir rama y base", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const creada = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  const accion = await creada.json() as any;
  globalThis.fetch = (async (url: any) => {
    if (String(url) === "https://api.github.com/repos/dueno/prueba") {
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    }
    return Response.json(
      { message: "Validation Failed", errors: [{ message: "No commits between main and telo/0e680496; not all refs are readable" }] },
      { status: 422 },
    );
  }) as unknown as typeof fetch;

  const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  const resultado = await respuesta.json() as { detail: string };
  expect(respuesta.status).toBe(409);
  expect(resultado.detail).toContain("GitHub no ve commits nuevos");
  expect(resultado.detail).toContain("Comprueba que el commit se haya subido");
  expect(resultado.detail).toContain("prepara una nueva autorización de PR");
  expect(resultado.detail).not.toContain("Validation Failed");
});

test("push muestra remoto fijado en clon y no el nuevo remoto de configuración", { timeout: 60000 }, async () => {
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
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: false })).status).toBe(200);
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
  expect(llamadas).toBe(0);
});

test("si diff cambia después de solicitar PR, rechaza aprobar antes de llamar GitHub", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
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


test("una autorización registra la cuenta del servidor y comprueba acceso antes del push", { timeout: 60000 }, async () => {
  const p=await tareaConCommit();
  const {guardarCuentaGithubGlobal,borrarCuentaGithubGlobal}=await import("../src/github-auth");
  db.query("DELETE FROM project_secrets WHERE project_id=? AND name='GITHUB_TOKEN'").run(p.id);
  guardarCuentaGithubGlobal({token:TOKEN,login:"prueba",name:"Prueba",avatar_url:"",scopes:[],actualizado_en:new Date().toISOString()});
  globalThis.fetch = (async (url: any, init: RequestInit) => {
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
  }) as typeof fetch;
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
    const respuestaTexto=await respuesta.clone().text();
    if (respuesta.status !== 200) throw new Error(`La aprobación del push falló (${respuesta.status}): ${respuestaTexto}`);
    expect(respuesta.status).toBe(200);
    expect(subidas).toBe(1);
    const diff=await diffDeTarea(p.taskId);
    expect(diff.aprobaciones.push?.sha).toBe(diff.commit);
    expect(diff.aprobaciones.push?.rama).toBe(diff.rama);
    expect((await pedir(`/acciones/${accion.id}/decidir`,{approve:true})).status).toBe(200);
    expect(subidas).toBe(1);
  } finally { espia.mockRestore(); borrarCuentaGithubGlobal(); }
});

test("no prepara autorizaciones de commit o push sin cambios respecto a la base", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  await gitOk(["reset", "--hard", p.diff.base_commit!], { cwd: p.clon });
  for (const action of ["commit", "push"]) {
    const respuesta = await pedir(`/projects/${p.id}/acciones`, { action, taskId: p.taskId });
    expect(respuesta.status).toBe(409);
    expect((await respuesta.json() as any).error).toBe("sin_cambios");
  }
  expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=?").get(p.taskId)).toBeNull();
});

test("no prepara un push cuando falta el remoto guardado", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  rmSync(join(config.dataDir, "tasks", p.taskId, "remoto.txt"));
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId });
  expect(respuesta.status).toBe(409);
  expect((await respuesta.json() as any).error).toBe("sin_remoto");
  expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=?").get(p.taskId)).toBeNull();
});

test("cada petición conserva su mensaje aunque se reutilice la tarea del chat", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Git',?)").run(conversationId, p.id);
  db.query("UPDATE tasks SET conversation_id=? WHERE id=?").run(conversationId, p.taskId);
  try {
    const mensajes = [randomUUID(), randomUUID()];
    const acciones: string[] = [];
    for (const id of mensajes) {
      db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','commit y push')").run(id, conversationId);
      const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId, conversationId });
      expect(respuesta.status).toBe(201);
      const accion = await respuesta.json() as any;
      expect(JSON.parse(accion.payload).messageId).toBe(id);
      acciones.push(accion.id);
    }
    expect(acciones[0]).not.toBe(acciones[1]);
    const historial = await (await repositoryActions.request(`/conversations/${conversationId}/acciones`)).json() as any[];
    expect(historial.map(a => a.message_id)).toEqual(mensajes);
    expect(historial.map(a => a.state)).toEqual(["superseded", "pending"]);
    expect((await pedir(`/acciones/${acciones[0]}/decidir`, { approve: true })).status).toBe(409);
    const invalida = await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId, conversationId, messageId: randomUUID() });
    expect(invalida.status).toBe(400);
  } finally {
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

test("el chat prepara commit y push juntos y vincula la tarjeta al nuevo mensaje", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  const { chat } = await import("../src/routes/chat");
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Git',?)").run(conversationId, p.id);
  db.query("UPDATE tasks SET conversation_id=? WHERE id=?").run(conversationId, p.taskId);
  try {
    const respuesta = await chat.request(`/conversations/${conversationId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "prepara de nuevo el git commit y push" }),
    });
    expect(respuesta.status).toBe(202);
    const cuerpo = await respuesta.json() as any;
    expect(cuerpo.action.action).toBe("push");
    expect(JSON.parse(cuerpo.action.payload).messageId).toBe(cuerpo.messages[0].id);
    expect(db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id=?").get(p.taskId)?.status).toBe("done");
    const soloCommit = await chat.request(`/conversations/${conversationId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "git commit sin push" }),
    });
    expect(soloCommit.status).toBe(202);
    const sinPush = await soloCommit.json() as any;
    expect(sinPush.action.action).toBe("commit");
    await gitOk(["reset", "--hard", p.diff.base_commit!], { cwd: p.clon });
    const fallida = await chat.request(`/conversations/${conversationId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "git push" }),
    });
    expect(fallida.status).toBe(202);
    const sinCambios = await fallida.json() as any;
    expect(sinCambios.messages[1].content).toContain("No hay cambios nuevos");
    expect(db.query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?").get(sinPush.action.id)?.state).toBe("superseded");
    expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(conversationId)?.n).toBe(4);
  } finally {
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

test("una tarjeta sin turno conocido no se reasigna al último mensaje del chat", async () => {
  const p = proyecto(), conversationId = randomUUID(), messageId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Legacy',?)").run(conversationId, p.id);
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Otro turno')").run(messageId, conversationId);
  try {
    const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "init", conversationId, messageId: null });
    expect(respuesta.status).toBe(201);
    const accion = await respuesta.json() as any;
    expect(JSON.parse(accion.payload).messageId).toBeNull();
    const listado = await (await repositoryActions.request(`/conversations/${conversationId}/acciones`)).json() as any[];
    expect(listado.find((item) => item.id === accion.id)?.message_id).toBeNull();
  } finally { db.query("DELETE FROM conversations WHERE id=?").run(conversationId); }
});

test("push_main ya no se acepta, y merge se puede preparar y autorizar directamente", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  expect((await pedir(`/projects/${p.id}/acciones`, { action: "push_main", taskId: p.taskId })).status).toBe(400);

  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const res = await pedir(`/projects/${p.id}/acciones`, {
    action: "merge",
    taskId: p.taskId,
    pr_number: 1,
    pr_url: "https://github.com/dueno/prueba/pull/1",
  });
  expect(res.status).toBe(201);
  const accion = (await res.json()) as any;
  expect(accion.action).toBe("merge");

  let urlLlamada = "";
  let metodoLlamada = "";
  globalThis.fetch = (async (url: any, init: any) => {
    urlLlamada = String(url);
    metodoLlamada = init?.method ?? "GET";
    if (String(url) === "https://api.github.com/repos/dueno/prueba") {
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    }
    if (String(url).endsWith("/pulls/1")) return Response.json({ head: { sha: p.diff.commit }, state: "open", draft: false, mergeable: true, mergeable_state: "clean" });
    return Response.json({ merged: true, message: "Pull Request successfully merged" });
  }) as typeof fetch;

  const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  expect(respuesta.status).toBe(200);
  expect(metodoLlamada).toBe("PUT");
  expect(urlLlamada).toContain("/repos/dueno/prueba/pulls/1/merge");
  expect(
    db.query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?").get(accion.id)?.state,
  ).toBe("approved");
});

test("un merge queda ligado al commit aprobado: otra punta del PR exige revisión nueva", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const shaAprobado = "1".repeat(64);
  db.query("INSERT INTO task_approvals (id,task_id,accion,diff_hash,commit_sha,rama) VALUES (?,?, 'push', 'hash', ?, 'telo/prueba')").run(
    randomUUID(),
    p.taskId,
    shaAprobado,
  );
  const res = await pedir(`/projects/${p.id}/acciones`, {
    action: "merge",
    taskId: p.taskId,
    pr_number: 2,
    pr_url: "https://github.com/dueno/prueba/pull/2",
  });
  expect(res.status).toBe(201);
  const accion = (await res.json()) as any;

  let metodoPuesta = "";
  globalThis.fetch = (async (url: any, init: any) => {
    const destino = String(url);
    if (destino === "https://api.github.com/repos/dueno/prueba")
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    if (destino.endsWith("/pulls/2"))
      return Response.json({
        html_url: "https://github.com/dueno/prueba/pull/2",
        mergeable: true,
        mergeable_state: "clean",
        head: { ref: "telo/prueba", sha: "2".repeat(64), repo: { full_name: "dueno/prueba" } },
        base: { ref: "main", repo: { full_name: "dueno/prueba" } },
      });
    if (destino.endsWith("/pulls/2/merge")) {
      metodoPuesta = init?.method ?? "";
      return Response.json({ merged: true });
    }
    throw new Error(`Solicitud inesperada: ${destino}`);
  }) as typeof fetch;

  const resultado = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  expect(resultado.status).toBe(409);
  expect((await resultado.json()) as any).toMatchObject({ error: "pr_cambiado" });
  const fila = db.query<{ state: string; result: string }, [string]>("SELECT state,result FROM repository_actions WHERE id=?").get(accion.id)!;
  expect(fila.state).toBe("failed");
  expect(JSON.parse(fila.result)).toMatchObject({ codigo: "pr_cambiado" });
  // Nunca llamó al PUT de merge: la punta del PR no era el commit revisado.
  expect(metodoPuesta).toBe("");
});

test("la punta del PR coincide: el PUT de merge declara el SHA revisado", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const shaAprobado = "3".repeat(64);
  db.query("INSERT INTO task_approvals (id,task_id,accion,diff_hash,commit_sha,rama) VALUES (?,?, 'push', 'hash', ?, 'telo/prueba')").run(
    randomUUID(),
    p.taskId,
    shaAprobado,
  );
  const res = await pedir(`/projects/${p.id}/acciones`, {
    action: "merge",
    taskId: p.taskId,
    pr_number: 3,
    pr_url: "https://github.com/dueno/prueba/pull/3",
  });
  expect(res.status).toBe(201);
  const accion = (await res.json()) as any;

  let putCuerpo = "";
  globalThis.fetch = (async (url: any, init: any) => {
    const destino = String(url);
    if (destino === "https://api.github.com/repos/dueno/prueba")
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    if (destino.endsWith("/pulls/3"))
      return Response.json({
        html_url: "https://github.com/dueno/prueba/pull/3",
        mergeable: true,
        mergeable_state: "clean",
        head: { ref: "telo/prueba", sha: shaAprobado, repo: { full_name: "dueno/prueba" } },
        base: { ref: "main", repo: { full_name: "dueno/prueba" } },
      });
    if (destino.endsWith("/pulls/3/merge")) {
      putCuerpo = String(init?.body ?? "");
      return Response.json({ merged: true, message: "Pull Request successfully merged" });
    }
    throw new Error(`Solicitud inesperada: ${destino}`);
  }) as typeof fetch;

  const resultado = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  expect(resultado.status).toBe(200);
  expect(JSON.parse(putCuerpo)).toMatchObject({ sha: shaAprobado, merge_method: "squash" });
  expect(
    db.query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?").get(accion.id)?.state,
  ).toBe("approved");
});

test("un merge con conflictos lista archivos y crea tarea sobre la rama del PR", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Resolver PR',?)").run(conversationId, p.id);
  db.query("UPDATE tasks SET conversation_id=? WHERE id=?").run(conversationId, p.taskId);
  const messageId = randomUUID();
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','resuelve los conflictos')").run(messageId, conversationId);
  db.query("INSERT INTO chat_actividad(conversation_id,turno_id,seq,tipo,titulo,estado) VALUES (?, ?, 1, 'texto', 'Diagnóstico previo', 'texto')").run(conversationId, messageId);
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const preparada = await pedir(`/projects/${p.id}/acciones`, {
    action: "merge", taskId: p.taskId, conversationId, pr_number: 9,
    pr_url: "https://github.com/dueno/prueba/pull/9",
  });
  const accion = await preparada.json() as { id: string };
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Un turno posterior')").run(randomUUID(), conversationId);
  const originalSpawn = Bun.spawn;
  const spy = spyOn(Bun, "spawn").mockImplementation(((cmd: any, opts: any) => {
    if (Array.isArray(cmd) && cmd.includes("fetch") && cmd.includes(REMOTO)) {
      return originalSpawn([process.execPath, "-e", "process.exit(1)"], { stdout: "pipe", stderr: "pipe" });
    }
    return originalSpawn(cmd, opts);
  }) as typeof Bun.spawn);
  let taskResolutionId: string | null = null;
  globalThis.fetch = (async (url: any) => {
    const destino = String(url);
    if (destino === "https://api.github.com/repos/dueno/prueba") {
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    }
    if (destino.endsWith("/pulls/9")) {
      return Response.json({
        html_url: "https://github.com/dueno/prueba/pull/9",
        mergeable: false,
        mergeable_state: "dirty",
        head: { ref: p.diff.rama, sha: p.diff.commit, repo: { full_name: "dueno/prueba" } },
        base: { ref: "main", repo: { full_name: "dueno/prueba" } },
      });
    }
    if (destino.endsWith("/pulls/9/files?per_page=100"))
      return Response.json([{ filename: "src/widget.ts" }, { filename: "src/widget.test.ts" }]);
    throw new Error(`Solicitud inesperada en la prueba: ${destino}`);
  }) as typeof fetch;
  try {
    const resultado = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
    expect(resultado.status).toBe(409);
    const fila = db.query<{ state: string; result: string }, [string]>("SELECT state,result FROM repository_actions WHERE id=?").get(accion.id)!;
    expect(fila.state).toBe("failed");
    const error = JSON.parse(fila.result) as { codigo: string; mensaje: string };
    const diagnostico = JSON.parse(error.mensaje) as { archivos: string[]; resoluble: boolean; rama_fuente: string };
    expect(error.codigo).toBe("merge_conflicts");
    expect(diagnostico.archivos).toEqual(["src/widget.ts", "src/widget.test.ts"]);
    expect(diagnostico.resoluble).toBe(true);

    const reparacion = await pedir(`/acciones/${accion.id}/resolver-conflictos`, {});
    expect(reparacion.status).toBe(202);
    const nueva = await reparacion.json() as { task_id: string };
    taskResolutionId = nueva.task_id;
    const tarea = db.query<{ status: string; source_branch: string; source_base_branch: string; source_pr_number: number; prompt: string; message_id: string | null }, [string]>(
      "SELECT status,source_branch,source_base_branch,source_pr_number,prompt,message_id FROM tasks WHERE id=?",
    ).get(nueva.task_id)!;
    expect(tarea).toMatchObject({ status: "queued", source_branch: p.diff.rama, source_base_branch: "main", source_pr_number: 9, message_id: messageId });
    expect(tarea.prompt).toContain("src/widget.ts");
    const payloadReparacion = JSON.parse(db.query<{ payload: string }, [string]>("SELECT payload FROM repository_actions WHERE id=?").get(accion.id)!.payload) as Record<string, unknown>;
    expect(payloadReparacion.repair_message_id).toBe(messageId);
    expect(payloadReparacion.repair_activity_from_seq).toBe(1);
    const enCurso = await pedir(`/acciones/${accion.id}/verificar-conflictos`, {});
    expect(await enCurso.json()).toMatchObject({ verificado: false, estado: "queued" });
    db.query("UPDATE tasks SET status='done' WHERE id=?").run(nueva.task_id);
    const faltaPush = await pedir(`/acciones/${accion.id}/verificar-conflictos`, {});
    expect(await faltaPush.json()).toMatchObject({ verificado: false, estado: "push_pendiente" });
    expect((await pedir(`/acciones/${accion.id}/resolver-conflictos`, {})).status).toBe(200);
  } finally {
    spy.mockRestore();
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
    if (taskResolutionId) db.query("DELETE FROM tasks WHERE id=?").run(taskResolutionId);
  }
});

test("solo verifica la reparación cuando GitHub confirma el SHA subido como limpio", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Verificar PR',?)").run(conversationId, p.id);
  db.query("UPDATE tasks SET conversation_id=?,source_branch=?,source_base_branch='main',source_pr_number=9 WHERE id=?")
    .run(conversationId, p.diff.rama, p.taskId);
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const respuesta = await pedir(`/projects/${p.id}/acciones`, {
    action: "merge", taskId: p.taskId, conversationId, pr_number: 9,
    pr_url: "https://github.com/dueno/prueba/pull/9",
  });
  expect(respuesta.status).toBe(201);
  const accion = await respuesta.json() as { id: string; payload: string };
  const payload = JSON.parse(accion.payload) as Record<string, unknown>;
  payload.repair_task_id = p.taskId;
  const diagnostico = {
    codigo: "merge_conflicts",
    mensaje: "Conflictos de prueba",
    pr_number: 9,
    pr_url: "https://github.com/dueno/prueba/pull/9",
    rama_fuente: p.diff.rama,
    rama_base: "main",
    repo_fuente: "dueno/prueba",
    repo_base: "dueno/prueba",
    archivos: ["archivo.txt"],
    archivos_exactos: true,
    task_id: p.taskId,
    resoluble: true,
  };
  db.query("UPDATE repository_actions SET state='failed',result=?,payload=? WHERE id=?")
    .run(JSON.stringify({ codigo: "merge_conflicts", mensaje: JSON.stringify(diagnostico) }), JSON.stringify(payload), accion.id);
  db.query("INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload,state) VALUES (?,?,?,?,'push',?,'approved')")
    .run(randomUUID(), p.id, conversationId, p.taskId, JSON.stringify({ source_pr_number: 9, rama: p.diff.rama, remote: REMOTO }));

  globalThis.fetch = (async (url: any) => {
    if (String(url) === "https://api.github.com/repos/dueno/prueba")
      return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
    if (String(url).endsWith("/pulls/9"))
      return Response.json({
        state: "open", draft: false, html_url: "https://github.com/dueno/prueba/pull/9",
        mergeable: true, mergeable_state: "clean",
        head: { ref: p.diff.rama, sha: p.diff.commit, repo: { full_name: "dueno/prueba" } },
        base: { ref: "main", repo: { full_name: "dueno/prueba" } },
      });
    throw new Error(`Solicitud inesperada en la prueba: ${String(url)}`);
  }) as typeof fetch;
  try {
    const verificacion = await pedir(`/acciones/${accion.id}/verificar-conflictos`, {});
    expect(verificacion.status).toBe(200);
    expect(await verificacion.json()).toMatchObject({ verificado: true, estado: "listo", pr_number: 9 });
  } finally {
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

async function conversacionTarea(p: { id: string; taskId: string }): Promise<string> {
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Subida',?)").run(conversationId, p.id);
  db.query("UPDATE tasks SET conversation_id=? WHERE id=?").run(conversationId, p.taskId);
  return conversationId;
}

test("push con destino base sube directo a la rama base y no prepara PR", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  const conversationId = await conversacionTarea(p);
  db.query("UPDATE tasks SET plan=? WHERE id=?").run('{"requiere_aprobacion":["commit","push","pr"]}', p.taskId);
  const accion = await (await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId, conversationId })).json() as any;
  globalThis.fetch = (async (url: any) => {
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba");
    return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
  }) as unknown as typeof fetch;
  const original = Bun.spawn;
  let subidas = 0;
  const espia = spyOn(Bun, "spawn").mockImplementation(((cmd: any, opts: any) => {
    if (Array.isArray(cmd) && cmd.includes("ls-remote")) {
      // Remoto sin punta legible en pruebas: el reintegro no actúa y la subida sigue igual.
      return original([process.execPath, "-e", "process.exit(0)"], { stdout: "pipe", stderr: "pipe" });
    }
    if (Array.isArray(cmd) && cmd.includes("push")) {
      subidas++;
      const commit = db.query<{ commit_sha: string }, [string]>("SELECT commit_sha FROM task_approvals WHERE task_id=? AND accion='commit' ORDER BY rowid DESC LIMIT 1").get(p.taskId)!;
      expect(cmd).toContain(`${commit.commit_sha}:refs/heads/main`);
      return original([process.execPath, "-e", "process.exit(0)"], { stdout: "pipe", stderr: "pipe" });
    }
    return original(cmd, opts);
  }) as typeof Bun.spawn);
  try {
    const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true, destino: "base" });
    const texto = await respuesta.clone().text();
    expect(respuesta.status).toBe(200);
    expect(subidas).toBe(1);
    const diff = await diffDeTarea(p.taskId);
    expect(diff.aprobaciones.push?.rama).toBe("main");
    expect(
      db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM repository_actions WHERE task_id=? AND action='pr'").get(p.taskId)?.n,
    ).toBe(0);
    expect(texto).not.toContain(TOKEN);
  } finally {
    espia.mockRestore();
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

test("push con destino rama prepara el PR aunque el plan no lo pida", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const conversationId = await conversacionTarea(p);
  const accion = await (await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId, conversationId })).json() as any;
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Un turno posterior a la tarjeta')").run(randomUUID(), conversationId);
  const ramaTarea = (await diffDeTarea(p.taskId)).rama;
  globalThis.fetch = (async (url: any) => {
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba");
    return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
  }) as unknown as typeof fetch;
  const original = Bun.spawn;
  let subidas = 0;
  const espia = spyOn(Bun, "spawn").mockImplementation(((cmd: any, opts: any) => {
    if (Array.isArray(cmd) && cmd.includes("push")) {
      subidas++;
      const commit = db.query<{ commit_sha: string }, [string]>("SELECT commit_sha FROM task_approvals WHERE task_id=? AND accion='commit' ORDER BY rowid DESC LIMIT 1").get(p.taskId)!;
      expect(cmd).toContain(`${commit.commit_sha}:refs/heads/${ramaTarea}`);
      return original([process.execPath, "-e", "process.exit(0)"], { stdout: "pipe", stderr: "pipe" });
    }
    return original(cmd, opts);
  }) as typeof Bun.spawn);
  try {
    const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true, destino: "rama" });
    const texto = await respuesta.clone().text();
    if (respuesta.status !== 200) throw new Error(`La subida con destino rama falló (${respuesta.status}): ${texto}`);
    expect(respuesta.status).toBe(200);
    expect(subidas).toBe(1);
    const diff = await diffDeTarea(p.taskId);
    expect(diff.aprobaciones.push?.rama).toBe(ramaTarea);
    const pr = db.query<{ state: string; payload: string }, [string]>("SELECT state,payload FROM repository_actions WHERE task_id=? AND action='pr'").get(p.taskId);
    expect(pr?.state).toBe("pending");
    expect(JSON.parse(pr!.payload).messageId).toBeNull();
    // Autorizar el PR preparado por la cadena: nada se fusiona ni falla sin permisos reales.
    const prId = db.query<{ id: string }, [string]>("SELECT id FROM repository_actions WHERE task_id=? AND action='pr'").get(p.taskId)!.id;
    const prAprobada = await pedir(`/acciones/${prId}/decidir`, { approve: false });
    expect(prAprobada.status).toBe(200);
  } finally {
    espia.mockRestore();
    db.query("DELETE FROM conversations WHERE id=?").run(conversationId);
  }
});

test("decidir una subida con destino desconocido responde 400 y conserva la tarjeta", { timeout: 60000 }, async () => {
  const p = await tareaConCommit();
  const accion = await (await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId })).json() as any;
  globalThis.fetch = (async () => {
    throw new Error("No debe llamar la red");
  }) as unknown as typeof fetch;
  const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true, destino: "nada" });
  expect(respuesta.status).toBe(400);
  expect((await respuesta.json() as any).error).toBe("invalid_destino");
  expect(db.query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?").get(accion.id)?.state).toBe("pending");
});

test("crear un pull request usa solo GITHUB_PR_TOKEN, sin respaldo a GITHUB_TOKEN", async () => {
  const p = proyecto();
  process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
  guardarSecreto(p.id, "GITHUB_TOKEN", TOKEN);
  await expect(githubApiPr(p.id, "/repos/dueno/prueba/pulls", fuenteAutenticacionGithub(p.id, "pr"), { title: "x" })).rejects.toThrow("Pull requests");

  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  let autorizacion = "";
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    autorizacion = (init.headers as Record<string, string>).Authorization;
    return new Response(JSON.stringify({ html_url: "https://github.com/dueno/prueba/pull/1" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const pr = (await githubApiPr(p.id, "/repos/dueno/prueba/pulls", fuenteAutenticacionGithub(p.id, "pr"), { title: "x" })) as { html_url: string };
  expect(autorizacion).toBe(`Bearer ${TOKEN_PR}`);
  expect(pr.html_url).toContain("/pull/1");

  // Ninguno de los dos tokens de GitHub llega al entorno del agente.
  expect(entornoDeProyecto(p.id)).not.toHaveProperty("GITHUB_PR_TOKEN");
  expect(entornoDeProyecto(p.id)).not.toHaveProperty("GITHUB_TOKEN");
});

test("prepararCopia sincroniza carpetas .opencode/skills y skills hacia el clon", async () => {
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

  // Crear una skill en el repo del proyecto sin hacer commit
  const skillDir = join(p.cwd, ".opencode", "skills", "test-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: test-skill\ndescription: Test skill\n---\nContenido");

  const skillRaiz = join(p.cwd, "skills", "otra-skill");
  mkdirSync(skillRaiz, { recursive: true });
  writeFileSync(join(skillRaiz, "SKILL.md"), "---\nname: otra-skill\ndescription: Otra skill\n---\nContenido raiz");

  const taskId = randomUUID();
  p.taskId = taskId;
  db.query(
    "INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Sync skills','Prueba','prueba','queued',?)",
  ).run(taskId, p.id);

  const copia = await prepararCopia(taskId, p.cwd, p.id);
  expect(existsSync(join(copia.cwd, ".opencode", "skills", "test-skill", "SKILL.md"))).toBe(true);
  expect(readFileSync(join(copia.cwd, ".opencode", "skills", "test-skill", "SKILL.md"), "utf8")).toContain("Contenido");
  expect(existsSync(join(copia.cwd, "skills", "otra-skill", "SKILL.md"))).toBe(true);
  expect(readFileSync(join(copia.cwd, "skills", "otra-skill", "SKILL.md"), "utf8")).toContain("Contenido raiz");
});

// Remoto local (bare) + copia local del proyecto apuntando a él, con un commit base ya empujado.
async function proyectoLocalConOrigen(prefijo: string) {
  const p = proyecto();
  const origen = join(config.projectsDir!, `origen-${prefijo}.git`);
  await gitOk(["init", "--bare", "-b", "main", origen], { cwd: config.projectsDir! });
  await gitOk(["init", "-b", "main"], { cwd: p.cwd });
  writeFileSync(join(p.cwd, "archivo.txt"), "base\n");
  await gitOk(["add", "archivo.txt"], { cwd: p.cwd });
  await gitOk(["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "commit", "-m", "Base"], { cwd: p.cwd });
  await gitOk(["remote", "add", "origin", origen], { cwd: p.cwd });
  await gitOk(["push", "origin", "main"], { cwd: p.cwd });
  const base = (await gitOk(["rev-parse", "HEAD"], { cwd: p.cwd })).trim();
  return { p, origen, base };
}

async function avanzarOrigen(origen: string, texto: string) {
  const aux = join(config.projectsDir!, `avance-${randomUUID()}`);
  try {
    await gitOk(["-c", "user.name=Avance", "-c", "user.email=avance@example.test", "clone", origen, aux], { cwd: config.projectsDir! });
    writeFileSync(join(aux, "archivo.txt"), texto);
    await gitOk(["add", "archivo.txt"], { cwd: aux });
    await gitOk(["-c", "user.name=Avance", "-c", "user.email=avance@example.test", "commit", "-m", "Avance del remoto"], { cwd: aux });
    await gitOk(["push", "origin", "HEAD:main"], { cwd: aux });
    return (await gitOk(["rev-parse", "HEAD"], { cwd: aux })).trim();
  } finally {
    rmSync(aux, { recursive: true, force: true });
  }
}

for (const credencial of ["global", "proyecto"] as const) {
  test(`las lecturas Git privadas usan helper y credencial ${credencial} sin exponer el token`, { timeout: 30000 }, async () => {
    const { p, origen } = await proyectoLocalConOrigen(randomUUID().slice(0, 8));
    const punta = await avanzarOrigen(origen, "avance privado\n");
    await gitOk(["branch", "resolver", punta], { cwd: origen });
    await gitOk(["remote", "set-url", "origin", REMOTO], { cwd: p.cwd });
    if (credencial === "global") {
      guardarCuentaGithubGlobal({ token: TOKEN, login: "prueba", name: "Prueba", avatar_url: "", scopes: [], actualizado_en: new Date().toISOString() });
    } else guardarSecreto(p.id, "GITHUB_TOKEN", TOKEN);
    const lecturas: { helper: boolean; autenticada: boolean; tokenEnArgumentos: boolean }[] = [];
    const original = Bun.spawn;
    const espia = spyOn(Bun, "spawn").mockImplementation(((cmd: any, opts: any) => {
      if (Array.isArray(cmd) && cmd[0] === "git" && cmd.includes("fetch")) {
        const helper = cmd.some((arg: string) => arg.startsWith("credential.https://github.com.helper=!") && arg.includes("$TELO_GIT_TOKEN"));
        const autenticada = opts.env?.TELO_GIT_TOKEN === TOKEN;
        lecturas.push({ helper, autenticada, tokenEnArgumentos: cmd.some((arg: string) => arg.includes(TOKEN)) });
        if (!helper || !autenticada) return original([process.execPath, "-e", "process.exit(1)"], { stdout: "pipe", stderr: "pipe" });
        // Sustituye el transporte remoto por un bare local; Git sigue ejecutando el fetch real.
        const local = cmd.map((arg: string) => arg === REMOTO || arg === "origin" ? origen : arg);
        if (cmd.includes("origin")) local[local.length - 1] = "refs/heads/main:refs/remotes/origin/main";
        return original(local, opts);
      }
      return original(cmd, opts);
    }) as typeof Bun.spawn);
    try {
      const taskId = randomUUID();
      p.taskId = taskId;
      db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id,source_branch,source_base_branch) VALUES (?,'Lectura privada','Prueba','prueba','queued',?,'resolver','main')").run(taskId, p.id);
      const copia = await prepararCopia(taskId, p.cwd, p.id);
      expect(copia.base_commit).toBe(punta);
      expect((await gitOk(["rev-parse", "HEAD"], { cwd: p.cwd })).trim()).toBe(punta);
      db.query("UPDATE tasks SET status='done' WHERE id=?").run(taskId);
      expect(await detectarConflictosPullRequest(taskId, REMOTO, "main", "resolver")).toEqual([]);
      expect(lecturas).toEqual(Array.from({ length: 3 }, () => ({ helper: true, autenticada: true, tokenEnArgumentos: false })));
    } finally {
      espia.mockRestore();
      rmSync(origen, { recursive: true, force: true });
    }
  });
}

test("prepararCopia trae la copia local al día con el avance del origin", { timeout: 20000 }, async () => {
  const { p, origen, base } = await proyectoLocalConOrigen(randomUUID().slice(0, 8));
  try {
    const punta = await avanzarOrigen(origen, "avanzado\n");
    expect(punta).not.toBe(base);
    const taskId = randomUUID();
    p.taskId = taskId;
    db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Traer origen','Prueba','prueba','queued',?)").run(taskId, p.id);
    const copia = await prepararCopia(taskId, p.cwd, p.id);
    expect(copia.base_commit).toBe(punta);
    expect(readFileSync(join(copia.cwd, "archivo.txt"), "utf8")).toContain("avanzado");
  } finally {
    rmSync(origen, { recursive: true, force: true });
  }
});

test("prepararCopia no avanza la copia local del usuario con cambios pendientes", { timeout: 20000 }, async () => {
  const { p, origen, base } = await proyectoLocalConOrigen(randomUUID().slice(0, 8));
  try {
    await avanzarOrigen(origen, "avanzado\n");
    writeFileSync(join(p.cwd, "archivo.txt"), "pendiente del usuario\n");
    const taskId = randomUUID();
    p.taskId = taskId;
    db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Repetida','Prueba','prueba','queued',?)").run(taskId, p.id);
    const copia = await prepararCopia(taskId, p.cwd, p.id);
    expect(copia.base_commit).toBe(base);
    expect(readFileSync(join(config.dataDir, "tasks", taskId, "repo", "archivo.txt"), "utf8")).toContain("base");
    expect(readFileSync(join(p.cwd, "archivo.txt"), "utf8")).toContain("pendiente");
  } finally {
    rmSync(origen, { recursive: true, force: true });
  }
});

test("reintegrarSobrePunta reubica el trabajo sobre la punta avanzada del remoto", { timeout: 20000 }, async () => {
  const { p, origen, base } = await proyectoLocalConOrigen(randomUUID().slice(0, 8));
  const punta = await avanzarOrigen(origen, "avanzado\n");
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Reintegro','Prueba','prueba','done',?)").run(taskId, p.id);
  const clon = join(config.projectsDir!, `clon-${taskId}`);
  try {
    await gitOk(["clone", p.cwd, clon], { cwd: config.projectsDir! });
    await gitOk(["remote", "remove", "origin"], { cwd: clon });
    await gitOk(["checkout", "-B", "telo/prueba", base], { cwd: clon });
    writeFileSync(join(clon, "hecho.txt"), "cambio de la tarea\n");
    await gitOk(["add", "hecho.txt"], { cwd: clon });
    await gitOk(["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "commit", "-m", "Cambio de tarea"], { cwd: clon });
    const head = (await gitOk(["rev-parse", "HEAD"], { cwd: clon })).trim();

    const nuevo = await reintegrarSobrePunta(
      taskId,
      { clon, projectId: null, rama: "telo/prueba", base },
      opcionesDeCredenciales(null),
      origen,
      "main",
      head,
    );
    const puntaNueva = nuevo ?? "";
    expect(puntaNueva).toBeTruthy();
    expect(puntaNueva).not.toBe(head);
    expect((await gitOk(["rev-parse", "HEAD"], { cwd: clon })).trim()).toBe(puntaNueva);
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: clon })).trim()).toBe("telo/prueba");
    expect(readFileSync(join(clon, "archivo.txt"), "utf8")).toContain("avanzado");
    expect(readFileSync(join(clon, "hecho.txt"), "utf8")).toContain("cambio de la tarea");
    const evento = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM task_events WHERE task_id=? AND kind='push_reintegrado'").get(taskId);
    expect(evento?.n).toBe(1);
    const pendientes = await gitOk(["status", "--porcelain", "--untracked-files=all"], { cwd: clon });
    expect(pendientes.trim()).toBe("");
  } finally {
    rmSync(origen, { recursive: true, force: true });
    rmSync(clon, { recursive: true, force: true });
  }
});

test("reintegrarSobrePunta aborta, restaura la rama y explica cómo continuar al chocar", { timeout: 20000 }, async () => {
  const { p, origen, base } = await proyectoLocalConOrigen(randomUUID().slice(0, 8));
  await avanzarOrigen(origen, "conflictivo\n");
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Conflicto','Prueba','prueba','done',?)").run(taskId, p.id);
  const clon = join(config.projectsDir!, `clon-${taskId}`);
  try {
    await gitOk(["clone", p.cwd, clon], { cwd: config.projectsDir! });
    await gitOk(["remote", "remove", "origin"], { cwd: clon });
    await gitOk(["checkout", "-B", "telo/prueba", base], { cwd: clon });
    writeFileSync(join(clon, "archivo.txt"), "reescrito por la tarea\n");
    await gitOk(["add", "archivo.txt"], { cwd: clon });
    await gitOk(["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "commit", "-m", "Cambio conflictivo"], { cwd: clon });
    const head = (await gitOk(["rev-parse", "HEAD"], { cwd: clon })).trim();

    expect.assertions(5);
    try {
      await reintegrarSobrePunta(
        taskId,
        { clon, projectId: null, rama: "telo/prueba", base },
        opcionesDeCredenciales(null),
        origen,
        "main",
        head,
      );
      throw new Error("Debía fallar por conflicto");
    } catch (err: any) {
      expect(err.code).toBe("push_fallido");
      expect(String(err.detail)).toContain("Pull Request");
      expect((await gitOk(["rev-parse", "HEAD"], { cwd: clon })).trim()).toBe(head);
      expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: clon })).trim()).toBe("telo/prueba");
      const evento = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM task_events WHERE task_id=? AND kind='push_fallido'").get(taskId);
      expect(evento?.n).toBe(1);
    }
  } finally {
    rmSync(origen, { recursive: true, force: true });
    rmSync(clon, { recursive: true, force: true });
  }
});

test("el escaneo de secretos ve el blob de un archivo marcado binario por .gitattributes", { timeout: 60000 }, async () => {
  const p = proyecto();
  await gitOk(["init", "-b", "main"], { cwd: p.cwd });
  writeFileSync(join(p.cwd, "archivo.txt"), "base\n");
  await gitOk(["add", "archivo.txt"], { cwd: p.cwd });
  await gitOk(
    ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Base"],
    { cwd: p.cwd },
  );
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Binario con secreto','Prueba','prueba','done',?)").run(
    taskId,
    p.id,
  );
  const copia = await prepararCopia(taskId, p.cwd, p.id);
  // El truco del agente: marcar el archivo binario. Con .gitattributes el diff no muestra
  // el contenido; el escaneo debe leerlo del blob del índice y rechazar el commit.
  writeFileSync(join(copia.cwd, ".opencode-datos.bin"), "\0etiqueta-falsa\0AKIAXK7GJQM4N2PLR9Z8\n");
  writeFileSync(join(copia.cwd, ".gitattributes"), "*.bin -diff\n");
  const antes = await diffDeTarea(taskId);
  expect(antes.hash).toBeTruthy();
  expect(antes.archivos.some((archivo) => archivo.ruta === ".opencode-datos.bin")).toBe(true);
  await expect(aprobarTarea(taskId, { accion: "commit", hash: antes.hash!, mensaje: "Agrega un binario" })).rejects.toMatchObject({
    code: "secreto_detectado",
  });
});

test("merge sin tarea captura el SHA, rechaza punta cambiada y bloquea tarjetas antiguas", async () => {
  const p = proyecto();
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,?)").run(p.id, REMOTO);
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Merge sin tarea',?)").run(conversationId, p.id);
  const sha = "a".repeat(40);
  let punta = sha;
  let puts = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === "https://api.github.com/repos/dueno/prueba")
      return Response.json({ permissions: { push: true } });
    if (init?.method === "PUT") { puts++; expect(JSON.parse(init.body).sha).toBe(sha); return Response.json({ merged: true }); }
    return Response.json({ head: { sha: punta }, state: "open", draft: false, mergeable: true, mergeable_state: "clean" });
  }) as typeof fetch;
  try {
    const preparar = () => pedir(`/projects/${p.id}/acciones`, { action: "merge", conversationId, pr_number: 55 });
    const primera = await preparar(); expect(primera.status).toBe(201);
    const accion = await primera.json() as { id: string; payload: string };
    expect(JSON.parse(accion.payload).sha_revision).toBe(sha);
    punta = "b".repeat(40);
    const resultado = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
    expect(resultado.status).toBe(409); expect(puts).toBe(0);
    punta = sha;
    const segunda = await (await preparar()).json() as { id: string; payload: string };
    const antiguo = JSON.parse(segunda.payload); delete antiguo.sha_revision;
    db.query("UPDATE repository_actions SET payload=? WHERE id=?").run(JSON.stringify(antiguo), segunda.id);
    expect((await pedir(`/acciones/${segunda.id}/decidir`, { approve: true })).status).toBe(409);
    expect(puts).toBe(0);
    const tercera = await (await preparar()).json() as { id: string };
    expect((await pedir(`/acciones/${tercera.id}/decidir`, { approve: true })).status).toBe(200);
    expect(puts).toBe(1);
  } finally { db.query("DELETE FROM conversations WHERE id=?").run(conversationId); }
});

test("el merge espera el cálculo de GitHub y respeta checks, reglas, base y borradores sin intentar el PUT", async () => {
  const p = proyecto();
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,?)").run(p.id, REMOTO);
  guardarSecreto(p.id, "GITHUB_PR_TOKEN", TOKEN_PR);
  const conversationId = randomUUID();
  db.query("INSERT INTO conversations(id,title,project_id) VALUES (?,'Requisitos de merge',?)").run(conversationId, p.id);
  const sha = "c".repeat(40);
  const escenarios = [
    { datos: { mergeable: null, mergeable_state: "unknown" }, error: "pr_verificacion_pendiente", detalle: "calculando" },
    { datos: { mergeable: true, mergeable_state: "unknown" }, error: "pr_verificacion_pendiente", detalle: "calculando" },
    { datos: { mergeable: true, mergeable_state: "blocked" }, error: "pr_no_listo", detalle: "requisitos de fusión" },
    { datos: { mergeable: true, mergeable_state: "unstable" }, error: "pr_no_listo", detalle: "comprobaciones" },
    { datos: { mergeable: true, mergeable_state: "behind" }, error: "pr_no_listo", detalle: "desactualizada" },
    { datos: { mergeable: true, mergeable_state: "clean", draft: true }, error: "pr_no_listo", detalle: "borrador" },
  ];
  let puts = 0;
  try {
    for (const [indice, escenario] of escenarios.entries()) {
      globalThis.fetch = (async (url: any, init: any) => {
        if (String(url) === "https://api.github.com/repos/dueno/prueba") return Response.json({ permissions: { push: true } });
        if (init?.method === "PUT") { puts++; return Response.json({ merged: true }); }
        return Response.json({ head: { sha }, state: "open", draft: false, ...escenario.datos });
      }) as typeof fetch;
      const preparacion = await pedir(`/projects/${p.id}/acciones`, { action: "merge", conversationId, pr_number: 60 + indice });
      expect(preparacion.status).toBe(201);
      const accion = await preparacion.json() as { id: string };
      const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
      expect(respuesta.status).toBe(409);
      const resultado = await respuesta.json() as { error: string; detail: string };
      expect(resultado.error).toBe(escenario.error);
      expect(resultado.detail).toContain(escenario.detalle);
      expect(puts).toBe(0);
    }
  } finally { db.query("DELETE FROM conversations WHERE id=?").run(conversationId); }
});

test("un archivo que el escaneo no puede verificar completo bloquea el commit", { timeout: 60000 }, async () => {
  const p = proyecto();
  await gitOk(["init", "-b", "main"], { cwd: p.cwd });
  writeFileSync(join(p.cwd, "archivo.txt"), "base\n");
  await gitOk(["add", "archivo.txt"], { cwd: p.cwd });
  await gitOk(
    ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Base"],
    { cwd: p.cwd },
  );
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Archivo pesado','Prueba','prueba','done',?)").run(
    taskId,
    p.id,
  );
  const copia = await prepararCopia(taskId, p.cwd, p.id);
  // Un blob mayor al tope por archivo no se recorta y se ignora: queda sin verificar y sin commit.
  writeFileSync(join(copia.cwd, "pesado.txt"), "x".repeat(17_000_000));
  const antes = await diffDeTarea(taskId);
  expect(antes.hash).toBeTruthy();
  await expect(aprobarTarea(taskId, { accion: "commit", hash: antes.hash!, mensaje: "Sube un archivo pesado" })).rejects.toMatchObject({
    code: "escaneo_incompleto",
  });
});

test("cancelar conserva la copia de la tarea mientras haya entregables ignorados", { timeout: 20000 }, async () => {
  const p = proyecto();
  await gitOk(["init", "-b", "main"], { cwd: p.cwd });
  writeFileSync(join(p.cwd, "base.txt"), "base\n");
  await gitOk(["add", "base.txt"], { cwd: p.cwd });
  await gitOk(
    ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Base"],
    { cwd: p.cwd },
  );
  const taskId = randomUUID();
  p.taskId = taskId;
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id) VALUES (?,'Cancelada con ignorados','Prueba','prueba','cancelled',?)").run(
    taskId,
    p.id,
  );
  const copia = await prepararCopia(taskId, p.cwd, p.id);
  writeFileSync(join(copia.cwd, ".gitignore"), "entregado*\n");
  writeFileSync(join(copia.cwd, "entregado.bin"), "trabajo que .gitignore esconde\n");
  await limpiarCopiaCancelada(taskId);
  // Con el chequeo de siempre (sin --ignored) este clon parecía limpio y se borraba: el
  // entregable ignorado desaparecía con él. Ahora los ignorados cuentan como algo que revisar.
  expect(existsSync(copia.cwd)).toBe(true);
});

test("un push fallido guarda el detalle claro para la tarjeta", { timeout: 20000 }, async () => {
  const p = await tareaConCommit();
  const accion = await (await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId })).json() as any;
  globalThis.fetch = (async (url: any) => {
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba");
    return Response.json({ full_name: "dueno/prueba", permissions: { push: true } });
  }) as unknown as typeof fetch;
  const original = Bun.spawn;
  const espia = spyOn(Bun, "spawn").mockImplementation(((cmd: any, opts: any) => {
    if (Array.isArray(cmd) && cmd.includes("ls-remote")) {
      return original([process.execPath, "-e", "process.exit(0)"], { stdout: "pipe", stderr: "pipe" });
    }
    if (Array.isArray(cmd) && cmd.includes("push")) {
      return original([process.execPath, "-e", 'process.stderr.write("remote: error: GH013: Repository rule violations found for refs/heads/main.\nremote: Updates must be made through a pull request.\n"); process.exit(1)'], { stdout: "pipe", stderr: "pipe" });
    }
    return original(cmd, opts);
  }) as typeof Bun.spawn);
  try {
    const respuesta = await pedir(`/acciones/${accion.id}/decidir`, { approve: true, destino: "base" });
    expect(respuesta.status).toBe(200);
    const respuestaFallida = await respuesta.json() as { ok: boolean; state: string; error: string; detail: string };
    expect(respuestaFallida).toMatchObject({ ok: false, state: "failed", error: "push_fallido" });
    expect(respuestaFallida.detail).toContain("regla de protección");
    const fila = db.query<{ result: string | null }, [string]>("SELECT result FROM repository_actions WHERE id=?").get(accion.id)!;
    expect(fila.result).toBeTruthy();
    const leido = JSON.parse(fila.result!) as { codigo: string; mensaje: string };
    expect(leido.codigo).toBe("push_fallido");
    expect(leido.mensaje).toContain("regla de protección");
    expect(leido.mensaje).toContain("abre un Pull Request");
  } finally {
    espia.mockRestore();
  }
});

test("el token global de GitHub se cifra en SQLite y las filas antiguas se migran al leerlas", () => {
  guardarCuentaGithubGlobal({
    token: TOKEN,
    login: "prueba",
    name: "Prueba",
    avatar_url: "",
    scopes: [],
    actualizado_en: new Date().toISOString(),
  });
  const fila = db.query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_global_auth'").get()!;
  expect(fila.value).not.toContain(TOKEN);
  expect(tokenGithubGlobal()).toBe(TOKEN);

  borrarCuentaGithubGlobal();
  db.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('github_global_auth', ?, datetime('now'))")
    .run(JSON.stringify({ token: TOKEN, login: "prueba", name: "Prueba", avatar_url: "", scopes: [], actualizado_en: "" }));
  expect(tokenGithubGlobal()).toBe(TOKEN);
  const migrada = db.query<{ value: string }, []>("SELECT value FROM app_settings WHERE key='github_global_auth'").get()!;
  expect(migrada.value).not.toContain(TOKEN);
});

