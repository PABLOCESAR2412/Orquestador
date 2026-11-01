type CheckRun = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

type CheckRunsResponse = { check_runs: CheckRun[] };

export type EstadoCI = { listo: boolean; motivo: string };

const CHECKS_REQUERIDOS = ["servidor", "interfaz"] as const;

/** Exige que ambos jobs obligatorios de GitHub Actions hayan terminado bien. */
export function evaluarChecksGitHub(valor: unknown): EstadoCI {
  if (!valor || typeof valor !== "object" || !Array.isArray((valor as CheckRunsResponse).check_runs)) {
    return { listo: false, motivo: "respuesta_invalida" };
  }

  const ejecuciones = (valor as CheckRunsResponse).check_runs;
  const pendientes: string[] = [];
  for (const nombre of CHECKS_REQUERIDOS) {
    const candidatas = ejecuciones
      .filter((run) => run.name === nombre)
      .sort((a, b) => {
        const fechaA = a.completed_at ?? a.started_at ?? "";
        const fechaB = b.completed_at ?? b.started_at ?? "";
        return fechaB.localeCompare(fechaA) || (b.id ?? 0) - (a.id ?? 0);
      });
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

if (import.meta.main) {
  try {
    const cuerpo = await Bun.stdin.text();
    const resultado = evaluarChecksGitHub(JSON.parse(cuerpo));
    if (!resultado.listo) {
      console.error(`CI no aprobado: ${resultado.motivo}`);
      process.exitCode = 1;
    } else {
      console.log(`CI aprobado: ${resultado.motivo}`);
    }
  } catch {
    console.error("CI no aprobado: respuesta inválida de GitHub");
    process.exitCode = 1;
  }
}
