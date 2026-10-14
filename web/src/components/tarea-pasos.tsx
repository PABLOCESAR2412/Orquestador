import type { TaskDiff, Task, TaskEvent } from "../api";
import { cuando } from "./tarea-formato";

export type EstadoPaso = "hecho" | "actual" | "pendiente" | "fallo";

export type Paso = {
  id: string;
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
};

const TEXTO_ESTADO: Record<EstadoPaso, string> = {
  hecho: "Hecho",
  actual: "En curso",
  pendiente: "Pendiente",
  fallo: "Con error",
};

const TITULO_FINAL: Partial<Record<Task["status"], string>> = {
  done: "Lista",
  failed: "Falló",
  cancelled: "Cancelada",
  interrupted: "Interrumpida",
  sin_cuota: "Sin cuota",
};

// Deriva los pasos del estado real: la tarea, sus eventos y la revisión de Git (si la tiene).
export function derivarPasos(args: {
  tarea: Task;
  eventos: TaskEvent[] | undefined;
  conGit: boolean;
  diff: TaskDiff | undefined;
  errorDiff: boolean;
}): Paso[] {
  const { tarea, eventos, conGit, diff, errorDiff } = args;
  const estado = tarea.status;
  const enCola = estado === "queued";
  const corriendo = estado === "running";
  const analizando = estado === "analyzing";
  const esperando = estado === "waiting_approval";
  const terminal = !enCola && !corriendo && !analizando && !esperando;
  const kinds = new Set((eventos ?? []).map((e) => e.kind));
  // Con plan, el obrero empieza cuando el plan se aprueba. Sin plan (tareas anteriores), corre desde el inicio.
  const conPlan = Boolean(tarea.plan) || kinds.has("plan_creado") || analizando || esperando;
  const iniciada = conPlan ? kinds.has("obrero_iniciado") : Boolean(tarea.started_at) || kinds.has("iniciada");

  const pasos: Paso[] = [];

  pasos.push({
    id: "creada",
    titulo: "Creada",
    estado: "hecho",
    detalle: cuando(tarea.created_at),
  });

  pasos.push({
    id: "cola",
    titulo: "En cola",
    estado: enCola ? "actual" : "hecho",
    detalle: enCola ? "Espera su turno. El servidor corre una tarea a la vez." : "Salió de la cola",
  });

  if (conPlan) {
    let plan: Paso;
    if (analizando) {
      plan = { id: "plan", titulo: "Plan", estado: "actual", detalle: "El analizador escribe el plan" };
    } else if (esperando) {
      plan = {
        id: "plan",
        titulo: "Plan",
        estado: "actual",
        detalle: "Revisa el plan y apruébalo para que el obrero empiece",
      };
    } else if (tarea.plan_aprobado_en || kinds.has("plan_aprobado")) {
      plan = { id: "plan", titulo: "Plan", estado: "hecho", detalle: "Aprobado" };
    } else {
      plan = {
        id: "plan",
        titulo: "Plan",
        estado: estado === "failed" ? "fallo" : "pendiente",
        detalle: terminal ? "No se aprobó" : "Todavía no se aprueba",
      };
    }
    pasos.push(plan);
  }

  if (corriendo) {
    pasos.push({
      id: "corriendo",
      titulo: "Corriendo",
      estado: "actual",
      detalle: tarea.started_at ? `Desde ${cuando(tarea.started_at)}` : "Arrancando",
    });
  } else if (iniciada) {
    pasos.push({
      id: "corriendo",
      titulo: "Corriendo",
      estado: "hecho",
      detalle: tarea.started_at ? `Empezó ${cuando(tarea.started_at)}` : "Empezó",
    });
  } else {
    pasos.push({
      id: "corriendo",
      titulo: "Corriendo",
      estado: estado === "failed" ? "fallo" : "pendiente",
      detalle: terminal ? "No llegó a correr" : "Todavía no empieza",
    });
  }

  if (conGit) {
    let revision: Paso;
    if (diff?.estado === "sin_cambios") {
      revision = { id: "revision", titulo: "Revisión", estado: "hecho", detalle: "No hubo cambios que guardar" };
    } else if (diff?.estado === "con_cambios") {
      const commit = diff.aprobaciones.commit;
      if (commit?.estado === "aprobada") {
        revision = {
          id: "revision",
          titulo: "Revisión",
          estado: "hecho",
          detalle: diff.aprobaciones.push ? "Commit aprobado y rama subida" : "Commit aprobado",
        };
      } else if (terminal) {
        revision = {
          id: "revision",
          titulo: "Revisión",
          estado: "actual",
          detalle: "Revisa los cambios y aprueba el commit",
        };
      } else {
        revision = { id: "revision", titulo: "Revisión", estado: "pendiente", detalle: "Se revisa al terminar" };
      }
    } else if (errorDiff) {
      revision = {
        id: "revision",
        titulo: "Revisión",
        estado: "pendiente",
        detalle: "No se pudieron cargar los cambios",
      };
    } else if (terminal) {
      revision = { id: "revision", titulo: "Revisión", estado: "actual", detalle: "Cargando los cambios…" };
    } else {
      revision = { id: "revision", titulo: "Revisión", estado: "pendiente", detalle: "Se revisa al terminar" };
    }
    pasos.push(revision);
  }

  const titulo = TITULO_FINAL[estado] ?? "Terminada";
  let final: Paso;
  if (estado === "done") {
    final = { id: "final", titulo, estado: "hecho", detalle: cuando(tarea.finished_at) };
  } else if (estado === "failed") {
    final = { id: "final", titulo, estado: "fallo", detalle: cuando(tarea.finished_at) };
  } else if (estado === "cancelled") {
    final = { id: "final", titulo, estado: "hecho", detalle: "Se canceló antes de terminar" };
  } else if (estado === "sin_cuota") {
    final = {
      id: "final",
      titulo,
      estado: "actual",
      detalle: "Elige otro modelo y pulsa Seguir",
    };
  } else if (estado === "interrupted") {
    final = {
      id: "final",
      titulo,
      estado: "actual",
      detalle: tarea.reanudable ? "Puedes reanudarla" : "Puedes reintentarla",
    };
  } else {
    final = { id: "final", titulo, estado: "pendiente", detalle: "Aún no termina" };
  }
  pasos.push(final);

  return pasos;
}

export function TareaPasos({ pasos }: { pasos: Paso[] }) {
  return (
    <ol className="tarea-pasos" aria-label="Estado de la tarea">
      {pasos.map((paso, indice) => (
        <li
          key={paso.id}
          className={`tarea-paso is-${paso.estado}`}
          aria-current={paso.estado === "actual" ? "step" : undefined}
        >
          <span className="tarea-paso-marca" aria-hidden="true">
            {indice + 1}
          </span>
          <div className="tarea-paso-texto">
            <span className="tarea-paso-titulo">{paso.titulo}</span>
            <span className="tarea-paso-estado">{TEXTO_ESTADO[paso.estado]}</span>
            {paso.detalle && <span className="tarea-paso-detalle">{paso.detalle}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
