import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
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
  const claveCifradoAnterior = process.env.TELO_CLAVE_CIFRADO;
  const creados: { id: string; proyecto?: string; conversacion?: string }[] = [];

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
    process.env.TELO_CLAVE_CIFRADO = Buffer.alloc(32, 1).toString("base64");
    ({ db } = await import("../src/db"));
    const { config } = await import("../src/config");
    datos = config.dataDir;
    proyectos = config.projectsDir!;
    mkdirSync(proyectos, { recursive: true });
    hogar = mkdtempSync(join(tmpdir(), "telo-worker-home-"));
    const bin = join(hogar, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "opencode"), readFileSync(join(import.meta.dir, "fixtures", "opencode-falso.py"), "utf8").replaceAll("\r\n", "\n"));
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
      if (fila.conversacion) db.query("DELETE FROM conversations WHERE id=?").run(fila.conversacion);
      if (fila.proyecto) {
        db.query("DELETE FROM repository_actions WHERE project_id=?").run(fila.proyecto);
        db.query("DELETE FROM project_secrets WHERE project_id=?").run(fila.proyecto);
        db.query("DELETE FROM projects WHERE id=?").run(fila.proyecto);
      }
    }
    if (homeAnterior === undefined) delete process.env.HOME;
    else process.env.HOME = homeAnterior;
    if (pathAnterior === undefined) delete process.env.PATH;
    else process.env.PATH = pathAnterior;
    if (aislamientoAnterior === undefined) delete process.env.TELO_AISLAMIENTO;
    else process.env.TELO_AISLAMIENTO = aislamientoAnterior;
    if (claveCifradoAnterior === undefined) delete process.env.TELO_CLAVE_CIFRADO;
    else process.env.TELO_CLAVE_CIFRADO = claveCifradoAnterior;
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
    if (model === "fixture/git") {
      await git(["remote", "add", "origin", "https://github.com/ejemplo/worker-pruebas"]);
      const { guardarSecreto } = await import("../src/secretos");
      guardarSecreto(proyecto, "GITHUB_TOKEN", "ghp_credencialficticiaparapruebas123456789");
    }
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
  function nuevaSinProyecto(model = "fixture/lento") {
    const id = crearTarea({ prompt: "Prueba tareas concurrentes", model, effort: null, projectId: null });
    creados.push({ id });
    return id;
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
          "SELECT 1 FROM messages WHERE conversation_id=? AND content LIKE 'Obrero aislado completado%'",
        )
        .get(conversacion),
    ).not.toBeNull();
  }, 15000);

  test("el worker procesa diez tareas independientes al mismo tiempo", async () => {
    const ids = Array.from({ length: 10 }, () => nuevaSinProyecto());
    const inicio = Date.now();
    await esperar(() => ids.every((id) => ["waiting_approval", "failed"].includes(fila(id).status)), "diez planes concurrentes");
    expect(ids.map((id) => fila(id).status)).toEqual(Array(10).fill("waiting_approval"));
    expect(Date.now() - inicio).toBeLessThan(9_000);
  }, 15000);

  test("prepara una sola autorización para commit y push sin ejecutar nada al rechazar", async () => {
    const {id,clon}=await nueva("fixture/git");
    await esperar(()=>fila(id).status === "waiting_approval" || fila(id).status === "failed",id);
    expect(fila(id).error).toBeNull();
    const head=(await gitSeguro(["rev-parse","HEAD"],{cwd:clon})).stdout.trim();
    expect((await aprobar(id)).status).toBe(200);
    await esperar(()=>fila(id).status === "done" || fila(id).status === "failed",id);
    expect(fila(id).status).toBe("done");
    await esperar(()=>!!db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='push' AND state='pending'").get(id),id);
    expect(db.query("SELECT 1 FROM repository_actions WHERE task_id=? AND action='commit'").get(id)).toBeNull();
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=?").get(id)).toBeNull();
    const accion=db.query<{id:string},[string]>("SELECT id FROM repository_actions WHERE task_id=? AND action='push'").get(id)!;
    const respuesta=await repositoryActions.request(`/acciones/${accion.id}/decidir`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approve:false})});
    expect(respuesta.status).toBe(200);
    expect((await gitSeguro(["rev-parse","HEAD"],{cwd:clon})).stdout.trim()).toBe(head);
    expect(db.query("SELECT 1 FROM task_approvals WHERE task_id=?").get(id)).toBeNull();
  },15000);

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
    await esperar(() => fila(id).status === "waiting_approval" && fila(id).plan_hash !== hash || fila(id).status === "failed", id);
    expect(fila(id).status).toBe("waiting_approval");
    expect(fila(id).approved_hash).toBeNull();
    expect(db.query<{detail:string},[string]>("SELECT detail FROM task_events WHERE task_id=? AND kind='replanificada' ORDER BY id DESC LIMIT 1").get(id)?.detail).toContain("extra.txt");
    expect(existsSync(join(clon, "extra.txt"))).toBe(true);
    expect(existsSync(join(clon, "permitido.txt"))).toBe(true);
    expect((await aprobar(id, hash)).status).toBe(409);
  }, 15000);
});
