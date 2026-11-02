// Prueba de extremo a extremo del analizador y el obrero, con un `opencode` falso en el PATH.
// La ejecuta server/tests/analizador.test.ts en un proceso propio: el worker es único por proceso.
// Requiere DATA_DIR (temporal) y TELO_AISLAMIENTO=desactivado, que pone el test.
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { db } = await import("../../src/db");
const { config } = await import("../../src/config");
const { crearTarea } = await import("../../src/tareas");
const { startWorker } = await import("../../src/worker");
const { tasks } = await import("../../src/routes/tasks");

const app = new Hono();
app.route("/api", tasks);

type Respuesta = { status: number; json: () => Promise<any> };
async function api(ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  return app.request(`/api${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }) as Promise<Respuesta>;
}

async function leer(id: string): Promise<any> {
  const r = await api(`/tasks/${id}`);
  if (r.status !== 200) throw new Error(`GET /tasks/${id} respondió ${r.status}`);
  return r.json();
}

function estadoDe(id: string): string | undefined {
  return db.query<{ status: string }, [string]>("SELECT status FROM tasks WHERE id = ?").get(id)?.status;
}

async function esperar(id: string, estados: string[], ms = 20_000): Promise<string> {
  const inicio = Date.now();
  for (;;) {
    const estado = estadoDe(id);
    if (estado && estados.includes(estado)) return estado;
    if (Date.now() - inicio > ms) {
      throw new Error(`La tarea ${id.slice(0, 8)} no llegó a ${estados.join(" o ")}; está en ${estado}`);
    }
    await Bun.sleep(40);
  }
}

function eventos(id: string): string[] {
  return db
    .query<{ kind: string }, [string]>("SELECT kind FROM task_events WHERE task_id = ? ORDER BY id")
    .all(id)
    .map((e) => e.kind);
}

// Cada llamada al agente falso queda anotada en la carpeta de la tarea.
function llamadas(id: string): { rol: string; sesion: string | null; prompt: string }[] {
  const ruta = join(config.dataDir, "tasks", id, ".opencode", "fixture-analizador", "llamadas.jsonl");
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, "utf8")
    .trim()
    .split("\n")
    .map((linea) => JSON.parse(linea));
}

const comprobaciones: string[] = [];
function comprobar(condicion: boolean, descripcion: string) {
  if (!condicion) throw new Error(`Falló: ${descripcion}`);
  comprobaciones.push(descripcion);
}

const base = { model: "opencode/fake", effort: null, projectId: null };

async function main() {
  startWorker();

  // A. Sin acciones que aprobar: el plan pasa solo y el obrero termina con su reporte.
  const a = crearTarea({ ...base, prompt: "Ordena la carpeta de notas" });
  await esperar(a, ["done", "failed"]);
  const ta = await leer(a);
  comprobar(ta.status === "done", "un plan sin acciones que aprobar termina en done");
  comprobar(ta.plan?.objetivo === "Ordenar la carpeta", "el plan del analizador se guarda en la tarea");
  comprobar(ta.reporte?.resumen === "Carpeta ordenada", "el reporte del obrero se guarda en la tarea");
  const ea = eventos(a);
  comprobar(
    ea.includes("plan_creado") && ea.includes("plan_aprobado") && ea.includes("obrero_iniciado") && !ea.includes("plan_pendiente"),
    "el historial registra plan creado, aprobación automática y obrero iniciado",
  );
  const la = llamadas(a);
  comprobar(la[0]?.rol === "analizador" && la[0].sesion === null, "el analizador arranca sin sesión previa");
  comprobar(la.at(-1)?.rol === "obrero" && la.at(-1)?.sesion === "ses_fake", "el obrero continúa la sesión del analizador");

  // B. Plan con commit: espera la aprobación. Con las notas, el obrero las recibe junto al plan.
  const b = crearTarea({ ...base, prompt: "Sube los cambios COMMIT" });
  await esperar(b, ["waiting_approval"]);
  let tb = await leer(b);
  comprobar(tb.plan?.requiere_aprobacion?.includes("commit"), "un plan con commit pide aprobación");
  comprobar(tb.reporte === null && tb.plan_aprobado_en === null, "sin aprobación no hay reporte ni fecha de aprobación");
  await Bun.sleep(300);
  comprobar(estadoDe(b) === "waiting_approval", "el obrero no corre antes de aprobar");
  const apB = await api(`/tasks/${b}/aprobar-plan`, { notas: "Usa la rama principal", plan_hash: tb.plan_hash });
  comprobar(apB.status === 200, "aprobar-plan responde 200");
  await esperar(b, ["done", "failed"]);
  tb = await leer(b);
  comprobar(tb.status === "done" && tb.reporte?.resumen === "Carpeta ordenada con notas", "el obrero ejecuta el plan aprobado con las notas");
  const obreroB = llamadas(b).filter((l) => l.rol === "obrero");
  comprobar(obreroB.length === 1 && obreroB[0].prompt.includes("Usa la rama principal"), "las notas llegan al obrero");
  comprobar(eventos(b).includes("plan_aprobado"), "la aprobación queda en el historial");
  const otraVez = await api(`/tasks/${b}/aprobar-plan`, { plan_hash: tb.plan_hash });
  comprobar(otraVez.status === 409, "un plan ya aprobado no se aprueba de nuevo");

  // C. Rechazo: el plan no se ejecuta y la tarea queda cancelada.
  const c = crearTarea({ ...base, prompt: "Borra todo COMMIT" });
  await esperar(c, ["waiting_approval"]);
  const rc = await api(`/tasks/${c}/rechazar-plan`, { motivo: "Demasiado riesgo" });
  comprobar(rc.status === 200, "rechazar-plan responde 200");
  const tc = await leer(c);
  comprobar(tc.status === "cancelled" && tc.error === "Plan rechazado por el usuario.", "un plan rechazado cancela la tarea");
  comprobar(!llamadas(c).some((l) => l.rol === "obrero"), "el obrero no corre con un plan rechazado");
  comprobar(eventos(c).includes("plan_rechazado"), "el rechazo queda en el historial");

  // D. Cancelar mientras el plan espera al usuario.
  const d = crearTarea({ ...base, prompt: "Ordena algo PREGUNTA" });
  await esperar(d, ["waiting_approval"]);
  const cancelD = await api(`/tasks/${d}/cancel`, {});
  comprobar(cancelD.status === 200 && estadoDe(d) === "cancelled", "cancelar un plan en espera lo cierra");

  // E. Desviación: el obrero se sale del plan, el analizador replanifica y el usuario vuelve a aprobar.
  const e = crearTarea({ ...base, prompt: "Ordena la carpeta DESVIAR COMMIT" });
  await esperar(e, ["waiting_approval"]);
  let te = await leer(e);
  await api(`/tasks/${e}/aprobar-plan`, { plan_hash: te.plan_hash });
  await esperar(e, ["waiting_approval"]);
  te = await leer(e);
  comprobar(te.plan?.objetivo?.startsWith("Plan replanificado"), "una desviación replanifica y vuelve a esperar aprobación");
  comprobar(eventos(e).includes("replanificada"), "la desviación queda en el historial");
  await api(`/tasks/${e}/aprobar-plan`, { plan_hash: te.plan_hash });
  await esperar(e, ["done", "failed"]);
  te = await leer(e);
  comprobar(te.status === "done", "tras replanificar y aprobar, la tarea termina");
  comprobar(eventos(e).filter((k) => k === "plan_creado").length === 2, "quedan dos versiones del plan");

  // F. Desviaciones repetidas: al llegar al tope de planes, la tarea falla.
  const f = crearTarea({ ...base, prompt: "Ordena la carpeta TOPE COMMIT" });
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    await esperar(f, ["waiting_approval", "failed"]);
    if (estadoDe(f) === "failed") break;
    const tf = await leer(f);
    await api(`/tasks/${f}/aprobar-plan`, { plan_hash: tf.plan_hash });
  }
  await esperar(f, ["failed"]);
  const tf = await leer(f);
  comprobar(tf.status === "failed" && tf.error?.includes("se desvió del plan 2 veces"), "el tope de desviaciones falla la tarea");
  comprobar(eventos(f).filter((k) => k === "plan_creado").length === 2, "el tope permite dos versiones del plan");

  // G. El obrero reporta un fallo: dos ciclos de corrección y, agotados, la tarea queda fallida con su reporte.
  const g = crearTarea({ ...base, prompt: "Ordena la carpeta FALLO" });
  await esperar(g, ["done", "failed"]);
  const tg = await leer(g);
  comprobar(tg.status === "failed" && tg.reporte?.estado === "fallo", "un reporte de fallo deja la tarea fallida con su reporte");
  comprobar(
    eventos(g).filter((k) => k === "correccion_iniciada").length === 2,
    "el fallo del obrero se devuelve como corrección dos veces antes de fallar",
  );

  // H. El analizador no devuelve JSON ni al repararlo: la tarea falla con un motivo legible.
  const h = crearTarea({ ...base, prompt: "SIEMPRE_INVALIDO" });
  await esperar(h, ["done", "failed"]);
  const th = await leer(h);
  comprobar(th.status === "failed" && th.error?.includes("no produjo un plan válido"), "un plan inválido falla la tarea con un motivo legible");

  // I. El analizador repara su respuesta en la misma sesión.
  const i = crearTarea({ ...base, prompt: "INVALIDO una vez" });
  await esperar(i, ["done", "failed"]);
  const li = llamadas(i).filter((l) => l.rol === "analizador");
  comprobar((await leer(i)).status === "done", "un plan inválido se repara en la misma sesión");
  comprobar(li.length === 2 && li[1].sesion === "ses_fake", "la reparación del analizador continúa su sesión");

  // J. Tras la migración 019, borrar una tarea borra su historial (las claves foráneas apuntan a la tabla nueva).
  const antes = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ?").get(a)?.n ?? 0;
  comprobar(antes > 0, "la tarea de prueba tiene historial antes de borrarla");
  db.query("DELETE FROM tasks WHERE id = ?").run(a);
  const despues = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ?").get(a)?.n ?? 0;
  comprobar(despues === 0, "borrar una tarea borra su historial en cascada");

  const rotas = db.query("PRAGMA foreign_key_check").all();
  comprobar(rotas.length === 0, "no quedan claves foráneas rotas");
  console.log(`${comprobaciones.length} comprobaciones correctas`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(`Comprobaciones correctas antes del fallo: ${comprobaciones.length}`);
    process.exit(1);
  });
