import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

const raiz = join(import.meta.dir, ".test-data-config-" + randomUUID().slice(0, 8));
process.env.DATA_DIR = join(raiz, "data");
process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
mkdirSync(process.env.TELO_PROYECTOS_DIR, { recursive: true });
const { db } = await import("../src/db");
const { proyectoConfig } = await import("../src/routes/proyecto-config");
const { repositoryActions } = await import("../src/routes/repository-actions");
const { guardarSecreto } = await import("../src/secretos");
const { gitOk } = await import("../src/git");
const { guardarCuentaGithubGlobal, borrarCuentaGithubGlobal } = await import("../src/github-auth");
const { fuenteAutenticacionGithub, githubApi, githubApiPr } = await import("../src/routes/proyecto-config");
const app = new Hono().route("/", proyectoConfig).route("/", repositoryActions);
const proyectos: { id: string; cwd: string }[] = [];
const claveOriginal = process.env.TELO_CLAVE_CIFRADO;
const fetchOriginal = globalThis.fetch;
function hacerEscribible(ruta: string) {
  for (const nombre of readdirSync(ruta)) {
    const hijo = join(ruta, nombre);
    const stat = lstatSync(hijo);
    if (stat.isDirectory()) hacerEscribible(hijo);
    else if (!stat.isSymbolicLink()) chmodSync(hijo, 0o666);
  }
  chmodSync(ruta, 0o777);
}
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  borrarCuentaGithubGlobal();
  if (claveOriginal === undefined) delete process.env.TELO_CLAVE_CIFRADO;
  else process.env.TELO_CLAVE_CIFRADO = claveOriginal;
  for (const proyecto of proyectos.splice(0)) {
    db.query("DELETE FROM repository_actions WHERE project_id=?").run(proyecto.id);
    db.query("DELETE FROM projects WHERE id=?").run(proyecto.id);
    try { rmSync(proyecto.cwd, { recursive: true, force: true }); } catch { /* Windows puede retener archivos dentro de .git hasta salir de Bun. */ }
  }
});
afterAll(() => {
  db.close();
  hacerEscribible(raiz);
  rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
function proyecto() {
  const id = "p-" + randomUUID().slice(0, 8);
  const cwd = join(process.env.TELO_PROYECTOS_DIR!, id);
  mkdirSync(cwd, { recursive: true });
  db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,?,?)").run(id, id, cwd);
  const p = { id, cwd };
  proyectos.push(p);
  return p;
}
function pedir(path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const cfg = {
  remote: "https://github.com/ejemplo/proyecto",
  author_name: "Usuario",
  base_branch: "main",
};

describe("configuración del proyecto", () => {
  test("rechaza proyecto desconocido e inputs Git inválidos sin guardar configuración", async () => {
    expect((await app.request("/projects/no-existe/contexto")).status).toBe(404);
    const p = proyecto();
    for (const cambio of [
      { author_name: "" },
      { base_branch: "../main" },
      { remote: "https://otro.example/repo" },
      { remote: "https://token@github.com/ejemplo/proyecto" },
    ])
      expect((await pedir(`/projects/${p.id}/git`, { ...cfg, ...cambio }, "PUT")).status).toBe(400);
    expect(db.query("SELECT 1 FROM project_git WHERE project_id=?").get(p.id)).toBeNull();
    expect((await pedir(`/projects/${p.id}/git`, cfg, "PUT")).status).toBe(200);
    expect((await pedir(`/projects/${p.id}/git`, { ...cfg, remote: "https://github.com/otro/repo" }, "PUT")).status).toBe(409);
    const estado = await app.request(`/projects/${p.id}/git`);
    const json = await estado.json() as Record<string, unknown>;
    expect(json.remote).toBe(cfg.remote);
    expect(json.author_email).toBeUndefined();
    expect(existsSync(join(p.cwd, ".git"))).toBe(false);
  });

  test("contexto requiere booleano y se comparte solo al activarlo", async () => {
    const p = proyecto();
    expect((await app.request(`/projects/${p.id}/contexto`)).status).toBe(200);
    expect((await pedir(`/projects/${p.id}/contexto`, { compartir: "sí" }, "PUT")).status).toBe(
      400,
    );
    expect((await pedir(`/projects/${p.id}/contexto`, { compartir: true }, "PUT")).status).toBe(
      200,
    );
    expect(((await (await app.request(`/projects/${p.id}/contexto`)).json()) as any).compartir).toBe(true);
  });

  test("API Git solo indica disponibilidad de token; comprobación redacta credenciales", async () => {
    const p = proyecto();
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    const secreto = "ghp_" + "abcdefghijklmnopqrstuvwxyz123456";
    expect(guardarSecreto(p.id, "GITHUB_TOKEN", secreto)).not.toBeNull();
    await pedir(`/projects/${p.id}/git`, cfg, "PUT");
    const estado = await app.request(`/projects/${p.id}/git`);
    const texto = await estado.text();
    expect(estado.status).toBe(200);
    expect(JSON.parse(texto).token).toBe(true);
    expect(texto).not.toContain(secreto);
    globalThis.fetch = (async () => {
      throw new Error("Fallo de prueba " + secreto);
    }) as unknown as typeof fetch;
    const comprobacion = await pedir(`/projects/${p.id}/git/comprobar`, {});
    expect(comprobacion.status).toBe(409);
    expect(await comprobacion.text()).not.toContain(secreto);
  });

  test("la cuenta global se identifica sin exponer su token y autoriza la creación de PR", async () => {
    const p = proyecto();
    const secreto = "token-global-de-prueba";
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    expect(guardarSecreto(p.id, "GITHUB_TOKEN", "token-proyecto-antiguo")).not.toBeNull();
    guardarCuentaGithubGlobal({
      token: secreto,
      login: "pablo",
      name: "Pablo",
      avatar_url: "https://example.test/avatar.png",
      scopes: ["repo"],
      actualizado_en: new Date().toISOString(),
    });
    await pedir(`/projects/${p.id}/git`, cfg, "PUT");
    const estado = await app.request(`/projects/${p.id}/git`);
    const texto = await estado.text();
    expect(JSON.parse(texto).github).toMatchObject({ conectado: true, login: "pablo", name: "Pablo" });
    expect(texto).not.toContain(secreto);

    let autorizacion = "";
    globalThis.fetch = (async (_url, init) => {
      autorizacion = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({ html_url: "https://github.com/ejemplo/proyecto/pull/1" });
    }) as typeof fetch;
    await githubApi(p.id, "/repos/ejemplo/proyecto", fuenteAutenticacionGithub(p.id, "push"));
    expect(autorizacion).toBe(`Bearer ${secreto}`);
    await githubApiPr(p.id, "/repos/ejemplo/proyecto/pulls", fuenteAutenticacionGithub(p.id, "pr"), { title: "PR" });
    expect(autorizacion).toBe(`Bearer ${secreto}`);
  });

  test("comprobar acceso informa la credencial elegida y valida escritura antes de autorizar", async () => {
    const p = proyecto();
    const secreto = "token-previo-de-prueba";
    process.env.TELO_CLAVE_CIFRADO = randomBytes(32).toString("base64");
    guardarCuentaGithubGlobal({
      token: secreto,
      login: "pablo",
      name: "Pablo",
      avatar_url: "",
      scopes: ["repo"],
      actualizado_en: new Date().toISOString(),
    });
    await pedir(`/projects/${p.id}/git`, cfg, "PUT");
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("https://api.github.com/repos/ejemplo/proyecto");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${secreto}`);
      return Response.json({ full_name: "ejemplo/proyecto", permissions: { push: true } });
    }) as typeof fetch;

    const respuesta = await pedir(`/projects/${p.id}/git/comprobar`, { action: "push" });
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({
      ok: true,
      repo: "ejemplo/proyecto",
      push: true,
      verificacion: "confirmada",
      autenticacion: { tipo: "credencial_anterior", etiqueta: "Credencial anterior", cuenta: "pablo" },
    });
  });

  test("un remoto de origin se detecta y queda bloqueado aunque aún no esté guardado en Telo", async () => {
    const p = proyecto();
    await gitOk(["init", "-b", "main"], { cwd: p.cwd });
    await gitOk(["remote", "add", "origin", cfg.remote], { cwd: p.cwd });
    const estado = await (await app.request(`/projects/${p.id}/git`)).json() as Record<string, unknown>;
    expect(estado.remote).toBe(cfg.remote);
    expect(estado.repository).toBe("ejemplo/proyecto");
    expect((await pedir(`/projects/${p.id}/git`, { ...cfg, remote: "https://github.com/otro/repo" }, "PUT")).status).toBe(409);
  });
});

describe("aprobaciones del repositorio", () => {
  test("rechaza acciones desconocidas, conversación ajena y operaciones sin tarea", async () => {
    const p = proyecto();
    expect((await pedir(`/projects/${p.id}/acciones`, { action: "delete" })).status).toBe(400);
    expect(
      (await pedir(`/projects/${p.id}/acciones`, { action: "init", conversationId: "otro" }))
        .status,
    ).toBe(404);
    for (const action of ["commit", "push", "pr"]) {
      expect((await pedir(`/projects/${p.id}/acciones`, { action })).status).toBe(409);
    }
    expect(existsSync(join(p.cwd, ".git"))).toBe(false);
  });

  test("crear y rechazar init no hace Git; una decisión no se reutiliza", async () => {
    const p = proyecto();
    const respuesta = await pedir(`/projects/${p.id}/acciones`, { action: "init" });
    expect(respuesta.status).toBe(201);
    const accion = (await respuesta.json()) as any;
    expect(accion.state).toBe("pending");
    expect(existsSync(join(p.cwd, ".git"))).toBe(false);
    expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: "sí" })).status).toBe(400);
    expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: false })).status).toBe(200);
    expect(existsSync(join(p.cwd, ".git"))).toBe(false);
    expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(409);
    expect(
      db
        .query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?")
        .get(accion.id)?.state,
    ).toBe("rejected");
  });

  test("aprobar init crea commit vacío, conserva archivos y no repite una segunda aprobación", async () => {
    const p = proyecto();
    writeFileSync(join(p.cwd, "pendiente.txt"), "Trabajo local");
    const accion = (await (await pedir(`/projects/${p.id}/acciones`, { action: "init" })).json()) as any;
    expect(existsSync(join(p.cwd, ".git"))).toBe(false);
    expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(200);
    const primerCommit = await gitOk(["rev-parse", "HEAD"], { cwd: p.cwd });
    expect(await gitOk(["ls-tree", "--name-only", "HEAD"], { cwd: p.cwd })).toBe("");
    expect(readFileSync(join(p.cwd, "pendiente.txt"), "utf8")).toBe("Trabajo local");
    expect((await pedir(`/acciones/${accion.id}/decidir`, { approve: true })).status).toBe(200);
    expect(await gitOk(["rev-parse", "HEAD"], { cwd: p.cwd })).toBe(primerCommit);
    expect(
      db
        .query<{ state: string }, [string]>("SELECT state FROM repository_actions WHERE id=?")
        .get(accion.id)?.state,
    ).toBe("approved");
  });
});
