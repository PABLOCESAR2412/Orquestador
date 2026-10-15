import { afterAll, afterEach, expect, test } from "bun:test";
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
const { guardarSecreto } = await import("../src/secretos");
const originalFetch = globalThis.fetch;
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
const proyectos: { id: string; cwd: string; taskId?: string }[] = [];
const REMOTO = "https://github.com/dueno/prueba";
const TOKEN = "ghp_" + "credencialficticiaparapruebas123456789";

afterEach(() => {
  globalThis.fetch = originalFetch;
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
  await aprobarTarea(taskId, { accion: "commit", hash: antes.hash, mensaje: "Cambio aprobado" });
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
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = await respuesta.json();
  expect(JSON.parse(accion.payload).remote).toBe(REMOTO);
  let llamadas = 0;
  globalThis.fetch = (async (url, init) => {
    llamadas++;
    expect(String(url)).toBe("https://api.github.com/repos/dueno/prueba/pulls");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init?.body));
    expect(body.head).toBe(p.diff.rama);
    expect(body.base).toBe("main");
    return Response.json({ html_url: "https://github.com/dueno/prueba/pull/1", token: TOKEN });
  }) as typeof fetch;
  const aprobada = await pedir(`/acciones/${accion.id}/decidir`, { approve: true });
  const texto = await aprobada.text();
  expect(aprobada.status).toBe(200);
  expect(llamadas).toBe(1);
  expect(texto).not.toContain(TOKEN);
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
  }) as typeof fetch;
  const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "push", taskId: p.taskId });
  expect(respuesta.status).toBe(201);
  const accion = await respuesta.json();
  expect(JSON.parse(accion.payload).remote).toBe(REMOTO);
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: false })).status).toBe(200);
  expect(llamadas).toBe(0);
});

test("si diff cambia después de solicitar PR, rechaza aprobar antes de llamar GitHub", async () => {
  const p = await tareaConCommit();
  const accion = await (
    await pedir(`/projects/${p.id}/acciones`, { action: "pr", taskId: p.taskId })
  ).json();
  writeFileSync(join(p.clon, "archivo.txt"), "cambio posterior sin aprobar\n");
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas++;
    throw new Error("No debe llamar GitHub");
  }) as typeof fetch;
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
      expect((await respuesta.json()).error).toBe("invalid_body");
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
  const accion = await (await pedir(`/projects/${p.id}/acciones`, { action: "init" })).json();
  expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
  expect(readFileSync(join(p.cwd, ".git"), "utf8")).toBe(gitdir);
  expect(readFileSync(join(otro.cwd, ".git", "config"), "utf8")).toBe(configAntes);
});
