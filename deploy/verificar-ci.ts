type WorkflowRun = {
  id?: number;
  path?: string;
  head_sha?: string;
  head_branch?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  run_attempt?: number;
  created_at?: string;
};

type WorkflowRunsResponse = { workflow_runs: WorkflowRun[] };
type Job = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};
type JobsResponse = { jobs: Job[] };

export type EstadoCI = { listo: boolean; motivo: string };
type Solicitar = (input: string | URL, init?: RequestInit) => Promise<Response>;

const REPOSITORIO = "PABLOCESAR2412/Orquestador";
const FLUJO = ".github/workflows/ci.yml";
const TRABAJOS_REQUERIDOS = ["servidor", "interfaz"] as const;
const CABECERAS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor && typeof valor === "object" && !Array.isArray(valor));
}

function elegirEjecucion(valor: unknown, sha: string): WorkflowRun | null | "invalida" {
  if (!esObjeto(valor) || !Array.isArray(valor.workflow_runs)) return "invalida";
  const candidatas = (valor as WorkflowRunsResponse).workflow_runs.filter((run) =>
    esObjeto(run) && (run.path === FLUJO || run.path?.startsWith(`${FLUJO}@`)) &&
    run.head_sha === sha && run.head_branch === "main" && run.event === "push"
  );
  candidatas.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
    (b.run_attempt ?? 0) - (a.run_attempt ?? 0) ||
    (b.id ?? 0) - (a.id ?? 0)
  );
  return candidatas[0] ?? null;
}

function evaluarTrabajos(valor: unknown): EstadoCI {
  if (!esObjeto(valor) || !Array.isArray(valor.jobs)) return { listo: false, motivo: "respuesta_invalida" };
  const trabajos = (valor as JobsResponse).jobs;
  const pendientes: string[] = [];
  for (const nombre of TRABAJOS_REQUERIDOS) {
    const candidatas = trabajos
      .filter((job) => esObjeto(job) && job.name === nombre)
      .sort((a, b) =>
        (b.started_at ?? b.completed_at ?? "").localeCompare(a.started_at ?? a.completed_at ?? "") ||
        (b.id ?? 0) - (a.id ?? 0)
      );
    const actual = candidatas[0];
    if (!actual || actual.status !== "completed") {
      pendientes.push(`${nombre}:pendiente`);
    } else if (actual.conclusion !== "success") {
      pendientes.push(`${nombre}:${actual.conclusion ?? "sin_resultado"}`);
    }
  }

  return pendientes.length
    ? { listo: false, motivo: pendientes.join(",") }
    : { listo: true, motivo: "servidor e interfaz aprobaron CI" };
}

async function leerGitHub(url: string, token: string, solicitar: Solicitar): Promise<unknown> {
  const respuesta = await solicitar(url, {
    headers: { ...CABECERAS, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!respuesta.ok) throw new Error(`github_http_${respuesta.status}`);
  const cuerpo = await respuesta.text();
  if (cuerpo.length > 2_000_000) throw new Error("respuesta_demasiado_grande");
  return JSON.parse(cuerpo);
}

/** Comprueba el workflow de push a main y los dos jobs obligatorios para el SHA exacto. */
export async function comprobarCI(sha: string, token: string | undefined, solicitar: Solicitar = fetch): Promise<EstadoCI> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) return { listo: false, motivo: "sha_invalido" };
  if (!token || !/^[A-Za-z0-9_]{20,}$/.test(token)) return { listo: false, motivo: "token_ausente_o_invalido" };

  try {
    const runsUrl = `https://api.github.com/repos/${REPOSITORIO}/actions/runs?head_sha=${sha}&per_page=100`;
    const run = elegirEjecucion(await leerGitHub(runsUrl, token, solicitar), sha);
    if (run === "invalida") return { listo: false, motivo: "respuesta_invalida" };
    if (!run) return { listo: false, motivo: "workflow:pendiente" };
    if (!Number.isSafeInteger(run.id) || (run.id ?? 0) < 1) return { listo: false, motivo: "run_id_invalido" };
    if (run.status !== "completed" || run.conclusion !== "success") {
      return { listo: false, motivo: `workflow:${run.conclusion ?? run.status ?? "pendiente"}` };
    }

    const jobsUrl = `https://api.github.com/repos/${REPOSITORIO}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`;
    return evaluarTrabajos(await leerGitHub(jobsUrl, token, solicitar));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "error_desconocido";
    return { listo: false, motivo: motivo.startsWith("github_http_") ? motivo : "error_de_consulta" };
  }
}

if (import.meta.main) {
  const resultado = await comprobarCI(process.argv[2] ?? "", process.env.TELO_GITHUB_CI_TOKEN);
  if (!resultado.listo) {
    console.error(`CI no aprobado: ${resultado.motivo}`);
    process.exitCode = 1;
  } else {
    console.log(`CI aprobado: ${resultado.motivo}`);
  }
}
