import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Se ejecuta aparte: el worker queda vivo y no debe consumir fixtures de otras suites.
const disponible =
  process.env.TELO_TEST_WORKER === "1" &&
  process.platform !== "win32" &&
  !!Bun.which("bwrap") &&
  !!Bun.which("python3");

describe.skipIf(!disponible)("worker con agente falso y bubblewrap real", () => {
  let db: typeof import("../src/db").db;
  let crearTarea: typeof import("../src/tareas").crearTarea;
  let cancelTask: typeof import("../src/worker").cancelTask;
  let tasks: typeof import("../src/routes/tasks").tasks;
  let repositoryActions: typeof import("../src/routes/repository-actions").repositoryActions;
  let gitSeguro: typeof import("../src/git").gitSeguro;
  let datos: string;
  let proyectos: string;
  let hogar: string;
  const homeAnterior = process.env.HOME;
  const pathAnterior = process.env.PATH;
  const aislamientoAnterior = process.env.TELO_AISLAMIENTO;
  const creados: { id: string; proyecto: string; conversacion: string }[] = [];

  beforeAll(async () => {
    const raiz = join(tmpdir(), "telo-pruebas-servicio");
    if (!process.env.TELO_PRUEBAS_INICIADAS) {
      if (resolve(raiz) !== join(resolve(tmpdir()), "telo-pruebas-servicio"))
        throw new Error("Raíz temporal inesperada");
      rmSync(raiz, { recursive: true, force: true });
      process.env.TELO_PRUEBAS_INICIADAS = "1";
    }
    process.env.DATA_DIR = join(raiz, "data");
    process.env.TELO_PROYECTOS_DIR = join(raiz, "proyectos");
    process.env.TELO_AISLAMIENTO = "activado";
    ({ db } = await import("../src/db"));
    const { config } = await import("../src/config");
    datos = config.dataDir;
    proyectos = config.projectsDir!;
    mkdirSync(proyectos, { recursive: true });
    hogar = mkdtempSync(join(tmpdir(), "telo-worker-home-"));
    const bin = join(hogar, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    copyFileSync(join(import.meta.dir, "fixtures", "opencode-falso.py"), join(bin, "opencode"));
    chmodSync(join(bin, "opencode"), 0o755);
    process.env.HOME = hogar;
    process.env.PATH = `${bin}:${pathAnterior}`;
    ({ crearTarea } = await import("../src/tareas"));
    ({ cancelTask } = await import("../src/worker"));
    ({ tasks } = await import("../src/routes/tasks"));
    ({ repositoryActions } = await import("../src/routes/repository-actions"));
    ({ gitSeguro } = await import("../src/git"));
    const { startWorker } = await import("../src/worker");
    startWorker();
  });

  afterAll(() => {
    if (!db) return;
    for (const fila of creados) {
      cancelTask(fila.id);
      db.query("DELETE FROM usage WHERE task_id=?").run(fila.id);
      db.query("DELETE FROM tasks WHERE id=?").run(fila.id);
      db.query("DELETE FROM conversations WHERE id=?").run(fila.conversacion);
      db.query("DELETE FROM projects WHERE id=?").run(fila.proyecto);
    }
    if (homeAnterior === undefined) delete process.env.HOME;
    else process.env.HOME = homeAnterior;
    if (pathAnterior === undefined) delete process.env.PATH;
    else process.env.PATH = pathAnterior;
    if (aislamientoAnterior === undefined) delete process.env.TELO_AISLAMIENTO;
    else process.env.TELO_AISLAMIENTO = aislamientoAnterior;
    if (
      hogar &&
      resolve(hogar).startsWith(resolve(tmpdir()) + sep) &&
      hogar.includes("telo-worker-home-")
    )
      rmSync(hogar, { recursive: true, force: true });
  });

  function fila(id: string): any {
    return db.query("SELECT * FROM tasks WHERE id=?").get(id);
  }
  async function esperar(condicion: () => boolean, detalle: string) {
    const limite = Date.now() + 10000;
    while (!condicion()) {
      if (Date.now() > limite) throw new Error("Tiempo agotado: " + detalle);
      await Bun.sleep(25);
    }
  }
  async function nueva(model = "fixture/normal") {
    const proyecto = crypto.randomUUID(),
      conversacion = crypto.randomUUID();
    const repo = join(proyectos, "worker-" + proyecto);
    mkdirSync(repo, { recursive: true });
    const git = async (args: string[]) => {
      const r = await gitSeguro(args, { cwd: repo });
      if (r.code) throw new Error(r.stderr);
      return r.stdout.trim();
    };
    await git(["init"]);
    writeFileSync(join(repo, "base.txt"), "base\n");
    await git(["add", "-A"]);
    await git([
      "-c",
      "user.name=Prueba",
      "-c",
      "user.email=prueba@example.invalid",
      "commit",
      "-m",
      "base",
    ]);
    db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,'Worker de prueba',?)").run(
      proyecto,
      repo,
    );
    db.query("INSERT INTO conversations(id,project_id) VALUES (?,?)").run(conversacion, proyecto);
    const id = crearTarea({
      prompt: "Crear el archivo permitido",
      model,
      effort: null,
      projectId: proyecto,
      conversationId: conversacion,
    });
    creados.push({ id, proyecto, conversacion });
    return { id, conversacion, clon: join(datos, "tasks", id, "repo") };
  }
  async function aprobar(id: string, hash = fila(id).plan_hash) {
    return tasks.request(`http://telo/tasks/${id}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash, decision: "approve" }),
    });
  }

  test("analiza en solo lectura, espera aprobación y ejecuta sin poder hacer commit", async () => {
    const { id, conversacion, clon } = await nueva();
    await esperar(() => fila(id).status === "waiting_approval" || fila(id).status === "failed", id);
    expect(fila(id).error).toBeNull();
    expect(fila(id).status).toBe("waiting_approval");
    expect(JSON.parse(fila(id).plan).supuestos).toContain("solo lectura verificada");
    expect(existsSync(join(clon, "escritura-analizador.txt"))).toBe(false);
    expect(existsSync(join(clon, "permitido.txt"))).toBe(false);
    expect((await aprobar(id, "0".repeat(64))).status).toBe(409);
    expect((await aprobar(id)).status).toBe(200);
    await esperar(() => ["done", "failed", "interrupted"].includes(fila(id).status), id);
    expect(fila(id).error).toBeNull();
    expect(fila(id).status).toBe("done");
    expect(JSON.parse(fila(id).reporte).pruebas[0].comando).toBe("git commit bloqueado");
    expect(readFileSync(join(clon, "permitido.txt"), "utf8")).toBe("trabajo conservado\n");
    expect(
      db
        .query(
          "SELECT 1 FROM messages WHERE conversation_id=? AND content='Obrero aislado completado'",
        )
        .get(conversacion),
    ).not.toBeNull();
  }, 15000);

  test("prepara commit y push sucesivos y exige autorización separada", async () => {
    const { id, clon } = await nueva("fixture/git");
    await esperar(() => fila(id).status === "waiting_approval" || fila(id).status === "failed", id);
    expect(fila(id).error).toBeNull();
    const headInicial = (await gitSeguro(["rev-parse", "HEAD"], { cwd: clon })).stdout.trim();
    expect((await aprobar(id)).status).toBe(200);
    await esperar(() => ["done", "failed", "interrupted"].includes(fila(id).status), id);
    expect(fila(id).status).toBe("done");
    await esperar(() => !!db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='commit' AND state='pending'").get(id), id);
    expect((await gitSeguro(["rev-parse", "HEAD"], { cwd: clon })).stdout.trim()).toBe(headInicial);
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=?").get(id)).toBeNull();
    expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='push'").get(id)).toBeNull();
    const commit = db.query<{id:string}, [string]>("SELECT id FROM repository_actions WHERE task_id=? AND action='commit' AND state='pending'").get(id)!;
    const decidir = (accionId:string, approve:boolean) => repositoryActions.request(`http://telo/acciones/${accionId}/decidir`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }),
    });
    const respuesta = await decidir(commit.id, true);
    expect(respuesta.status).toBe(200);
    expect((await gitSeguro(["rev-parse", "HEAD"], { cwd: clon })).stdout.trim()).not.toBe(headInicial);
    await esperar(() => !!db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='push' AND state='pending'").get(id), id);
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=? AND accion='commit'").get(id)).not.toBeNull();
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=? AND accion='push'").get(id)).toBeNull();
    const push = db.query<{id:string}, [string]>("SELECT id FROM repository_actions WHERE task_id=? AND action='push' AND state='pending'").get(id)!;
    expect((await decidir(push.id, false)).status).toBe(200);
    expect(db.query<any, [string]>("SELECT state FROM repository_actions WHERE id=?").get(push.id)?.state).toBe("rejected");
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=? AND accion='push'").get(id)).toBeNull();
  }, 15000);

  test("registra consumo aunque el proveedor termine con error", async () => {
    const { id } = await nueva("fixture/fallo");
    await esperar(() => fila(id).status === "failed", id);
    const uso = db
      .query<
        any,
        [string]
      >("SELECT SUM(input_tokens) AS tokens,SUM(cost) AS costo FROM usage WHERE task_id=?")
      .get(id);
    expect(uso).toEqual({ tokens: 17, costo: 0.004 });
  }, 15000);

  test("conserva consumo emitido antes de cancelar", async () => {
    const { id } = await nueva("fixture/cancelar");
    await esperar(() => !!db.query("SELECT 1 FROM usage WHERE task_id=?").get(id), id);
    expect(cancelTask(id)).toBe("cancelling");
    await esperar(() => fila(id).status === "cancelled", id);
    expect(
      db
        .query<any, [string]>("SELECT SUM(input_tokens) AS tokens FROM usage WHERE task_id=?")
        .get(id)?.tokens,
    ).toBe(17);
  }, 15000);

  test("detiene cambios fuera del plan y exige revisión conservando el diff", async () => {
    const { id, clon } = await nueva("fixture/fuera");
    await esperar(() => fila(id).status === "waiting_approval" || fila(id).status === "failed", id);
    expect(fila(id).error).toBeNull();
    const hash = fila(id).plan_hash;
    expect((await aprobar(id)).status).toBe(200);
    await esperar(() => ["done", "failed", "interrupted"].includes(fila(id).status), id);
    expect(fila(id).status).toBe("interrupted");
    expect(fila(id).approved_hash).toBeNull();
    expect(fila(id).error).toContain("extra.txt");
    expect(existsSync(join(clon, "extra.txt"))).toBe(true);
    expect(existsSync(join(clon, "permitido.txt"))).toBe(true);
    expect((await aprobar(id, hash)).status).toBe(409);
  }, 15000);
});
