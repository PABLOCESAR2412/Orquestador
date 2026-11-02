import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const raiz = join(tmpdir(), "telo-pruebas-servicio");
if (!process.env.TELO_PRUEBAS_INICIADAS) { rmSync(raiz, { recursive: true, force: true }); process.env.TELO_PRUEBAS_INICIADAS = "1"; }
process.env.DATA_DIR = join(raiz, "data");
mkdirSync(process.env.DATA_DIR, { recursive: true });
const { db } = await import("../src/db");
const { registrarSeguimientoPublicacion, leerSeguimientoPublicacion, revisarSeguimientosPublicacion, recuperarSeguimientosRecientes } = await import("../src/seguimiento-pr");
const { crearTarea } = await import("../src/tareas");
const proyectos: string[] = [];
const AHORA = Date.now();
afterEach(() => { for (const id of proyectos.splice(0)) {
  db.query("DELETE FROM repository_actions WHERE project_id=?").run(id);
  db.query("DELETE FROM tasks WHERE project_id=?").run(id);
  db.query("DELETE FROM conversations WHERE project_id=?").run(id);
  db.query("DELETE FROM projects WHERE id=?").run(id);
} });
function proyecto() {
  const project = randomUUID(), conversation = randomUUID(), message = randomUUID(); proyectos.push(project);
  db.query("INSERT INTO projects(id,name,repo_path) VALUES (?,'Seguimiento','/tmp/seguimiento')").run(project);
  db.query("INSERT INTO project_git(project_id,remote) VALUES (?,'https://github.com/dueno/prueba')").run(project);
  db.query("INSERT INTO conversations(id,project_id,model,effort) VALUES (?,?,'google/modelo-actual','low')").run(conversation, project);
  db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES (?,?,'user','Publica y revisa')").run(message, conversation);
  return { project, conversation, message };
}
function publicacion(contexto = proyecto(), opciones: { sha?: string; numero?: number | null; accion?: "pr" | "push"; rama?: string; esperarPr?: boolean } = {}) {
  const id = randomUUID(), task = randomUUID(), sha = opciones.sha ?? "a".repeat(40), numero = opciones.numero === undefined ? 9 : opciones.numero;
  const accion = opciones.accion ?? "pr", rama = opciones.rama ?? (numero ? "telo/prueba" : "main");
  db.query("INSERT INTO tasks(id,title,prompt,model,status,project_id,conversation_id,message_id,source_pr_number) VALUES (?,'Origen','Cambio','opencode/modelo-antiguo','done',?,?,?,?)").run(task, contexto.project, contexto.conversation, contexto.message, numero);
  db.query("INSERT INTO task_approvals(id,task_id,accion,commit_sha,rama,remoto) VALUES (?,?,'push',?,?,'https://github.com/dueno/prueba')").run(randomUUID(), task, sha, rama);
  db.query("INSERT INTO repository_actions(id,project_id,conversation_id,task_id,action,payload,state,result) VALUES (?,?,?,?,?,?,'approved',?)").run(id, contexto.project, contexto.conversation, task, accion,
    JSON.stringify({ remote: "https://github.com/dueno/prueba", rama, base: "main", commit: sha, messageId: contexto.message }),
    JSON.stringify(accion === "pr" ? { number: numero, url: `https://github.com/dueno/prueba/pull/${numero}` } : { sha, rama }));
  registrarSeguimientoPublicacion(id, AHORA, { esperarPr: opciones.esperarPr });
  return { ...contexto, id, task, sha, numero, rama };
}
function github(p: ReturnType<typeof publicacion>, opciones: { conflicto?: boolean; fallo?: boolean; externo?: boolean; sha?: string; estadoPr?: string } = {}) {
  const llamadas: string[] = [];
  const consultar = async (_project: string, path: string) => {
    llamadas.push(path);
    if (/\/pulls\//.test(path)) return { state: "open", mergeable: !opciones.conflicto, mergeable_state: opciones.conflicto ? "dirty" : opciones.estadoPr ?? "clean", head: { sha: opciones.sha ?? p.sha, ref: p.rama, repo: { full_name: "dueno/prueba" } }, base: { ref: "main", repo: { full_name: "dueno/prueba" } } };
    if (/\/git\/ref\//.test(path)) return { object: { sha: opciones.sha ?? p.sha } };
    if (/\/jobs\?/.test(path)) return { jobs: [{ name: "Quality", conclusion: "failure", steps: [{ name: opciones.externo ? "GitHub couldn't verify an account for the commit" : "Run bun test", conclusion: "failure" }] }] };
    return { workflow_runs: [{ id: 10, workflow_id: 1, event: "push", head_sha: p.sha, head_branch: p.rama, head_repository: { full_name: "dueno/prueba" }, name: "Quality", status: "completed", conclusion: opciones.fallo || opciones.externo ? "failure" : "success" }] };
  };
  return { consultar, llamadas };
}
test("un PR con conflictos inicia una corrección local del modelo actual y no la duplica tras releer el estado persistido", async () => {
  const p = publicacion(), api = github(p, { conflicto: true });
  await revisarSeguimientosPublicacion(AHORA, api);
  const s = leerSeguimientoPublicacion(p.id)!;
  expect(s.estado).toBe("corrigiendo"); expect(s.repair_task_id).toBeTruthy();
  const t = db.query("SELECT model,effort,project_id,source_branch,source_base_branch,source_pr_number FROM tasks WHERE id=?").get(s.repair_task_id);
  expect(t).toMatchObject({ model: "google/modelo-actual", effort: "low", project_id: p.project, source_branch: p.rama, source_base_branch: "main", source_pr_number: 9 });
  registrarSeguimientoPublicacion(p.id, AHORA + 5_000);
  await revisarSeguimientosPublicacion(AHORA + 60_001, api);
  expect(leerSeguimientoPublicacion(p.id)?.repair_task_id).toBe(s.repair_task_id);
  expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tasks WHERE project_id=?").get(p.project)?.n).toBe(2);
});
test("un head distinto detiene el seguimiento antes de crear una corrección", async () => {
  const p = publicacion(), api = github(p, { sha: "b".repeat(40), conflicto: true });
  await revisarSeguimientosPublicacion(AHORA, api);
  expect(leerSeguimientoPublicacion(p.id)).toMatchObject({ estado: "cambiado", repair_task_id: null });
  expect(api.llamadas).toHaveLength(1);
});
test("un fallo explícito de cuenta no se convierte en cambios de código", async () => {
  const p = publicacion();
  await revisarSeguimientosPublicacion(AHORA, github(p, { externo: true }));
  expect(leerSeguimientoPublicacion(p.id)).toMatchObject({ estado: "bloqueado", repair_task_id: null });
  expect(leerSeguimientoPublicacion(p.id)?.mensaje).toContain("cuenta o permisos");
});
test("Actions en verde no certifica un PR bloqueado por comprobaciones externas", async () => {
  const p = publicacion();
  await revisarSeguimientosPublicacion(AHORA, github(p, { estadoPr: "blocked" }));
  expect(leerSeguimientoPublicacion(p.id)).toMatchObject({ estado: "esperando", repair_task_id: null });
  expect(leerSeguimientoPublicacion(p.id)?.mensaje).toContain("blocked");
});
test("una subida directa a main revisa su SHA y crea tarea sin número de PR ni integración de base", async () => {
  const p = publicacion(undefined, { accion: "push", numero: null }), api = github(p, { fallo: true });
  await revisarSeguimientosPublicacion(AHORA, api);
  expect(api.llamadas.some(path => path.includes("/pulls/"))).toBe(false);
  expect(api.llamadas[0]).toContain("/git/ref/heads/main");
  const s = leerSeguimientoPublicacion(p.id)!;
  expect(db.query("SELECT source_branch,source_base_branch,source_pr_number FROM tasks WHERE id=?").get(s.repair_task_id)).toMatchObject({ source_branch: "main", source_base_branch: null, source_pr_number: null });
});
test("dos acciones para el mismo head comparten corrección y dos heads reparados agotan el límite del PR", async () => {
  const contexto = proyecto(), a = publicacion(contexto), duplicada = publicacion(contexto, { accion: "push" });
  const api = github(a, { fallo: true });
  await revisarSeguimientosPublicacion(AHORA, api);
  expect(leerSeguimientoPublicacion(a.id)?.repair_task_id).toBe(leerSeguimientoPublicacion(duplicada.id)?.repair_task_id);
  const b = publicacion(contexto, { sha: "b".repeat(40) });
  await revisarSeguimientosPublicacion(AHORA, github(b, { fallo: true }));
  expect(leerSeguimientoPublicacion(b.id)?.intentos).toBe(2);
  const c = publicacion(contexto, { sha: "c".repeat(40) });
  await revisarSeguimientosPublicacion(AHORA, github(c, { fallo: true }));
  expect(leerSeguimientoPublicacion(c.id)).toMatchObject({ estado: "bloqueado", repair_task_id: null, intentos: 2 });
});
test("un seguimiento vencido no hace llamadas y uno terminado prepara aprobación una sola vez", async () => {
  const p = publicacion(), api = github(p, { conflicto: true });
  await revisarSeguimientosPublicacion(AHORA, api);
  const s = leerSeguimientoPublicacion(p.id)!;
  db.query("UPDATE tasks SET status='done' WHERE id=?").run(s.repair_task_id);
  let aprobaciones = 0;
  await revisarSeguimientosPublicacion(AHORA + 60_001, { ...api, prepararRevision: async () => { aprobaciones++; } });
  await revisarSeguimientosPublicacion(AHORA + 120_001, api);
  expect(aprobaciones).toBe(1); expect(leerSeguimientoPublicacion(p.id)?.estado).toBe("revision");
  const caducada = publicacion(); let llamadas = 0;
  await revisarSeguimientosPublicacion(AHORA + 24 * 60 * 60_000 + 1, { consultar: async () => { llamadas++; return {}; } });
  expect(llamadas).toBe(0); expect(leerSeguimientoPublicacion(caducada.id)?.estado).toBe("caducado");
});
test("los escaneos concurrentes no generan tareas duplicadas", async () => {
  const p = publicacion(), api = github(p, { conflicto: true });
  let continuar!: () => void; const espera = new Promise<void>(resolve => { continuar = resolve; }); let llamadas = 0;
  const consultar = async (project: string, path: string) => { llamadas++; await espera; return api.consultar(project, path); };
  const primera = revisarSeguimientosPublicacion(AHORA, { consultar, crear: crearTarea });
  await revisarSeguimientosPublicacion(AHORA, { consultar });
  expect(llamadas).toBe(1);
  continuar(); await primera;
  expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tasks WHERE project_id=?").get(p.project)?.n).toBe(2);
});

test("la subida ordinaria de rama y su PR comparten una sola corrección", async () => {
  const contexto = proyecto();
  const push = publicacion(contexto, { accion: "push", numero: null, rama: "telo/prueba", esperarPr: true });
  await revisarSeguimientosPublicacion(AHORA, github(push, { fallo: true }));
  expect(leerSeguimientoPublicacion(push.id)?.repair_task_id).toBeNull();
  const pr = publicacion(contexto);
  expect(leerSeguimientoPublicacion(push.id)?.estado).toBe("traspasado");
  await revisarSeguimientosPublicacion(AHORA, github(pr, { fallo: true }));
  expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tasks WHERE project_id=?").get(pr.project)?.n).toBe(3);
  expect(db.query("SELECT source_pr_number,source_commit FROM tasks WHERE id=?").get(leerSeguimientoPublicacion(pr.id)!.repair_task_id)).toMatchObject({ source_pr_number: 9, source_commit: pr.sha });
});

test("un fallo durante persistencia revierte la tarea y permite reintentar sin huérfanos", async () => {
  const p = publicacion();
  await revisarSeguimientosPublicacion(AHORA, { ...github(p, { fallo: true }), crear: opts => { crearTarea(opts); throw new Error("fallo de persistencia simulado"); } });
  expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tasks WHERE project_id=?").get(p.project)?.n).toBe(1);
  expect(leerSeguimientoPublicacion(p.id)).toMatchObject({ repair_task_id: null, intentos: 0 });
  await revisarSeguimientosPublicacion(AHORA + 60_001, github(p, { fallo: true }));
  expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM tasks WHERE project_id=?").get(p.project)?.n).toBe(2);
});

test("al recuperar solo se registran publicaciones aprobadas recientes con una subida verificable", () => {
  const reciente = publicacion(), vieja = publicacion();
  db.query("UPDATE repository_actions SET result=? WHERE id IN (?,?)").run(JSON.stringify({ number: 9 }), reciente.id, vieja.id);
  db.query("UPDATE repository_actions SET created_at=datetime('now','-2 days') WHERE id=?").run(vieja.id);
  recuperarSeguimientosRecientes(AHORA + 1_000);
  expect(leerSeguimientoPublicacion(reciente.id)).not.toBeNull();
  expect(leerSeguimientoPublicacion(vieja.id)).toBeNull();
  const limite = leerSeguimientoPublicacion(reciente.id)!.vence_en;
  recuperarSeguimientosRecientes(AHORA + 10_000);
  expect(leerSeguimientoPublicacion(reciente.id)?.vence_en).toBe(limite);
});

test("una comprobación cancelada o que exige autorización no se presenta como aprobada ni crea cambios", async () => {
  for (const [conclusion, estado] of [["cancelled", "esperando"], ["action_required", "bloqueado"]]) {
    const p = publicacion(), api = github(p);
    await revisarSeguimientosPublicacion(AHORA, { consultar: async (project, path) => {
      const datos = await api.consultar(project, path);
      if (datos.workflow_runs) datos.workflow_runs[0].conclusion = conclusion!;
      return datos;
    } });
    expect(leerSeguimientoPublicacion(p.id)).toMatchObject({ estado, repair_task_id: null });
  }
});
