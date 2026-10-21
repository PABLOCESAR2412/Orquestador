import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type FuenteAutenticacionGithub, type PasoActividad, type RepositoryAction, type Task, type VerificacionConflictos } from "../api";
import { errorText } from "../lib/model";
import { pullRequestLink } from "../lib/pull-request-link";
import { ProcesoAgente } from "./chat-proceso";

// merge y push_main ya no se crean; quedan aquí solo para mostrar el historial de acciones antiguas.
const labels: Record<string, string> = {
  init: "Inicializar repositorio",
  commit: "Crear commit",
  push: "Commit y push",
  push_main: "Commit y push a principal",
  pr: "Crear pull request",
  merge: "Hacer merge del Pull Request",
};

type DiagnosticoConflictos = {
  codigo: "merge_conflicts";
  mensaje: string;
  pr_number: number;
  pr_url: string;
  rama_fuente: string;
  rama_base: string;
  archivos: string[];
  archivos_exactos: boolean;
  task_id: string | null;
  resoluble: boolean;
};

function diagnosticoConflictos(valor: string | null): DiagnosticoConflictos | null {
  if (!valor) return null;
  try {
    const error = JSON.parse(valor) as { codigo?: string; mensaje?: string };
    if (error.codigo !== "merge_conflicts" || !error.mensaje) return null;
    const dato = JSON.parse(error.mensaje) as DiagnosticoConflictos;
    return dato.codigo === "merge_conflicts" ? dato : null;
  } catch {
    return null;
  }
}

function estadoTareaGit(valor?: string): string | null {
  const nombres: Record<string, string> = {
    queued: "en cola",
    analyzing: "analizando cambios",
    waiting_approval: "esperando aprobación del plan",
    running: "corrigiendo conflictos",
    done: "resuelta; revisión pendiente",
    failed: "falló",
    cancelled: "cancelada",
    interrupted: "interrumpida",
    sin_cuota: "en espera de cuota",
  };
  return valor ? nombres[valor] ?? valor : null;
}

function resultadoPrueba(valor: string): string {
  return ({ ok: "Correcta", fallo: "Falló", no_aplica: "No aplica" } as Record<string, string>)[valor] ?? valor;
}

function resultadoLegible(valor: string): string {
  const sinCommits = valor.match(/No commits between\s+([^\s;]+)\s+and\s+([^\s;]+)/i);
  if (sinCommits) {
    return `GitHub no ve commits nuevos entre ${sinCommits[1]} y ${sinCommits[2]}. Comprueba que la rama de origen se haya subido y que sea la rama que contiene el cambio.`;
  }
  try {
    const r = JSON.parse(valor) as {
      mensaje?: string;
      message?: string;
      sha?: string;
      url?: string;
      merged?: boolean;
      number?: number;
      codigo?: string;
    };
    if (r.codigo === "merge_conflicts" && typeof r.mensaje === "string") {
      try {
        return (JSON.parse(r.mensaje) as DiagnosticoConflictos).mensaje;
      } catch { /* Compatibilidad con resultados sin diagnóstico estructurado. */ }
    }
    if (r.merged) return "✓ Pull Request fusionado exitosamente en GitHub";
    if (r.url && r.number) return `Pull Request #${r.number} creado en GitHub.`;
    return (
      r.mensaje ?? r.message ?? r.url ?? (r.sha ? `Commit ${r.sha.slice(0, 8)}` : valor)
    );
  } catch {
    return /^[a-z_]+$/.test(valor)
      ? errorText(new ApiError(409, valor))
      : valor;
  }
}
const estados: Record<string, string> = {
  pending: "Espera tu autorización",
  approved: "Completada",
  rejected: "Rechazada",
  failed: "No se completó",
  executing: "Ejecutando",
  superseded: "Reemplazada",
};
function autenticacionDe(accion: RepositoryAction): FuenteAutenticacionGithub | null {
  try {
    const payload = JSON.parse(accion.payload) as { autenticacion?: FuenteAutenticacionGithub };
    return payload.autenticacion ?? null;
  } catch {
    return null;
  }
}
function payloadDe(accion: RepositoryAction): Record<string, unknown> {
  try { return JSON.parse(accion.payload) as Record<string, unknown>; }
  catch { return {}; }
}
function etiquetaAutenticacion(accion: RepositoryAction): string | null {
  if (accion.action !== "push" && accion.action !== "pr" && accion.action !== "merge") return null;
  const autenticacion = autenticacionDe(accion);
  if (!autenticacion) return "Credencial: método no registrado";
  return `Credencial: ${autenticacion.etiqueta}${autenticacion.cuenta ? ` · @${autenticacion.cuenta}` : ""}`;
}
export function RepositoryApproval({
  accion,
  onChange,
  compacta = false,
  projectId,
  onResolverConflictos,
  resolviendoConflictos = false,
  tareaResolucion,
  actividadResolucion = [],
  cargandoDiffResolucion = false,
  puedeVerificarConflictos = false,
  verificandoConflictos = false,
  verificacionConflictos,
  onVerificarConflictos,
}: {
  accion: RepositoryAction;
  onChange: (resultado?: unknown, aprobada?: boolean, error?: string) => void;
  compacta?: boolean;
  projectId?: string;
  onResolverConflictos?: () => void;
  resolviendoConflictos?: boolean;
  tareaResolucion?: Task;
  actividadResolucion?: PasoActividad[];
  cargandoDiffResolucion?: boolean;
  puedeVerificarConflictos?: boolean;
  verificandoConflictos?: boolean;
  verificacionConflictos?: VerificacionConflictos | null;
  onVerificarConflictos?: () => void;
}) {
  const p = JSON.parse(accion.payload) as {
    diff?: string;
    descripcion?: string;
    remote?: string;
    rama?: string;
    base?: string;
    message?: string;
    title?: string;
    archivos?: string[];
    truncado?: boolean;
    autorGit?: string;
    autenticacion?: FuenteAutenticacionGithub;
    pr_number?: number;
    pr_url?: string;
    source_pr_number?: number | null;
    repair_task_id?: string;
    repair_message_id?: string | null;
    repair_activity_from_seq?: number;
  };
  const necesitaGitHub = accion.action === "push" || accion.action === "pr" || accion.action === "merge";
  const credencialObsoleta = necesitaGitHub && !p.autenticacion;
  const [confirmarAccesoNoVerificado, setConfirmarAccesoNoVerificado] = useState(false);
  const [avisoAcceso, setAvisoAcceso] = useState<string | null>(null);
  // En una subida, "siempre pregunta": el usuario elige destino (base directo o rama + PR)
  // al autorizar. Si el acceso no se pudo verificar, se recuerda aquí qué botón pulsó.
  const [destinoPendiente, setDestinoPendiente] = useState<"base" | "rama" | null>(null);
  const decide = useMutation({
    mutationFn: async ({ approve, destino }: { approve: boolean; destino?: "base" | "rama" }) => {
      if (!approve) return api.decideRepositoryAction(accion.id, false);
      if (necesitaGitHub) {
        if (!projectId || !p.autenticacion) {
          throw new ApiError(409, "github_access", "Esta autorización no tiene una credencial registrada. Prepara una nueva para comprobar el acceso antes de aprobar.");
        }
        const acceso = await api.checkProjectGit(projectId, accion.action as "push" | "pr" | "merge");
        const esperada = p.autenticacion;
        if (
          acceso.autenticacion.tipo !== esperada.tipo ||
          acceso.autenticacion.origen !== esperada.origen ||
          acceso.autenticacion.cuenta !== esperada.cuenta ||
          acceso.autenticacion.instalacion_id !== esperada.instalacion_id
        ) {
          throw new ApiError(409, "github_access", "La credencial seleccionada cambió desde que preparaste la autorización. Prepara otra para revisar qué cuenta hará la acción.");
        }
        if (acceso.verificacion === "no_verificada" && !confirmarAccesoNoVerificado) {
          return { requiereConfirmacion: true as const, aviso: acceso.aviso ?? "No se pudo confirmar el permiso de escritura antes de la acción." };
        }
      }
      return api.decideRepositoryAction(accion.id, true, destino);
    },
    onSuccess: (resultado, args) => {
      if ("requiereConfirmacion" in resultado && resultado.requiereConfirmacion) {
        setConfirmarAccesoNoVerificado(true);
        setDestinoPendiente(args.destino ?? null);
        setAvisoAcceso(resultado.aviso);
        return;
      }
      setAvisoAcceso(null);
      onChange("result" in resultado ? resultado.result : undefined, args.approve);
    },
    onError: (error) => onChange(undefined, false, errorText(error)),
  });
  const titulo = labels[accion.action] ?? accion.action;
  const subida = accion.action === "push";
  const conflictos = accion.action === "merge" && accion.state === "failed"
    ? diagnosticoConflictos(accion.result)
    : null;
  const estado = estados[accion.state] ?? accion.state;
  const estadoResolucion = tareaResolucion?.status;
  const reparacionTerminada = estadoResolucion === "done";
  const reparacionFallida = estadoResolucion === "failed" || estadoResolucion === "cancelled";
  const reparacionDetenida = reparacionFallida || estadoResolucion === "interrupted";
  const enlacePr = pullRequestLink(accion);
  const cuerpo = (
    <>
      {!compacta && (
        <header className="approval-heading">
          <h2>{titulo}</h2>
          <span className={`approval-state-ticket is-${accion.state}`} role="status">
            {estado}
          </span>
        </header>
      )}
      {(p.remote || p.rama) && (
        <p className="approval-meta">
          {p.remote && <span>{p.remote}</span>}
          {p.rama && (
            <span>
              Rama: {p.rama}
              {(accion.action === "pr" || accion.action === "merge") ? ` → ${p.base ?? "main"}` : ""}
            </span>
          )}
        </p>
      )}
      {enlacePr && (
        <p className="approval-meta">
          <a className="approval-pr-link" href={enlacePr.url} target="_blank" rel="noreferrer">
            Ver PR #{enlacePr.number} en GitHub ↗
          </a>
        </p>
      )}
      {subida ? (
        <ol className="approval-steps" aria-label="Pasos autorizados">
          <li>Crear commit con los cambios revisados</li>
          <li>{p.source_pr_number
            ? `Subir a ${p.rama ?? "la rama del PR"} para actualizar el PR #${p.source_pr_number}`
            : `Subir al destino que elijas abajo: ${p.base ?? "main"} directo, o ${p.rama ?? "la rama de la tarea"} para abrir el PR`}</li>
        </ol>
      ) : (
        p.descripcion && <p>{p.descripcion}</p>
      )}
      {accion.action === "commit" && <p>Mensaje: {p.message}</p>}
      {(accion.action === "commit" || subida) && (
        <p className="approval-auth">Commit local · identidad de Git: {p.autorGit ?? "la configurada en el proyecto"}.{subida ? " La subida usa la credencial indicada abajo." : " GitHub no participa en este paso."}</p>
      )}
      {accion.action === "pr" && <p>Título: {p.title}</p>}
      {conflictos && (
        <section className="approval-conflicts" aria-label="Diagnóstico de conflictos">
          <strong>Conflictos detectados en la fusión</strong>
          <p>{conflictos.mensaje}</p>
          {conflictos.archivos.length > 0 ? (
            <>
              <p>{conflictos.archivos_exactos ? "Archivos con conflicto:" : "Archivos modificados por el PR que conviene revisar; GitHub no entregó la lista exacta de conflictos:"}</p>
              <ul>{conflictos.archivos.map((archivo) => <li key={archivo}><code>{archivo}</code></li>)}</ul>
            </>
          ) : <p>No se pudo obtener la lista de archivos. Telo la inspeccionará al preparar la tarea.</p>}
          <p className="approval-conflicts-plan">
            Telo preparará una tarea sobre <code>{conflictos.rama_fuente}</code>, integrará <code>{conflictos.rama_base}</code>, resolverá los conflictos sin descartar cambios y ejecutará las pruebas. Luego podrás revisar y aprobar el commit y la subida al mismo PR.
          </p>
          {p.repair_task_id ? (
            <div className="approval-conflicts-progress">
              <div className="approval-conflicts-progress-heading">
                <strong>Seguimiento de la reparación</strong>
                <span className={`approval-state-ticket is-${reparacionDetenida ? "failed" : reparacionTerminada ? "approved" : "executing"}`}>
                  {estadoTareaGit(estadoResolucion) ?? "preparando"}
                </span>
              </div>
              {tareaResolucion?.status === "failed" ? (
                <p className="approval-auth approval-auth-warning" role="alert">{tareaResolucion.error ?? "La tarea de resolución falló."}</p>
              ) : tareaResolucion?.status === "cancelled" ? (
                <p className="approval-auth approval-auth-warning" role="status">La tarea de resolución se canceló.</p>
              ) : tareaResolucion?.status === "interrupted" ? (
                <p className="approval-auth approval-auth-warning" role="status">La tarea se interrumpió. Reanúdala desde Tareas para continuar.</p>
              ) : tareaResolucion?.status === "sin_cuota" ? (
                <p className="approval-auth approval-auth-warning" role="status">La tarea espera cuota del modelo. Continúa con otro modelo desde Tareas.</p>
              ) : tareaResolucion ? (
                <p role="status">
                  {reparacionTerminada
                    ? "El agente terminó. Revisa el resultado y luego autoriza el commit y la subida al mismo PR."
                    : `La tarea está ${estadoTareaGit(tareaResolucion.status) ?? "en curso"}. Aquí aparecen sus pasos reales mientras trabaja.`}
                </p>
              ) : <p role="status">Cargando el estado de la tarea de resolución…</p>}
              {actividadResolucion.length > 0 && (
                <ProcesoAgente
                  pasos={actividadResolucion}
                  enCurso={!reparacionTerminada && !reparacionDetenida && estadoResolucion !== "sin_cuota"}
                  textoFinal={tareaResolucion?.reporte?.resumen ?? ""}
                />
              )}
              {tareaResolucion?.reporte && (
                <details className="approval-conflicts-report">
                  <summary>Resultado y pruebas</summary>
                  <p>{tareaResolucion.reporte.resumen}</p>
                  {tareaResolucion.reporte.pruebas.length > 0 && (
                    <ul>
                      {tareaResolucion.reporte.pruebas.map((prueba, index) => (
                        <li key={`${prueba.comando}-${index}`}><code>{prueba.comando}</code> · {resultadoPrueba(prueba.resultado)}</li>
                      ))}
                    </ul>
                  )}
                  {tareaResolucion.reporte.pendientes.length > 0 && (
                    <p>Pendiente: {tareaResolucion.reporte.pendientes.join("; ")}</p>
                  )}
                </details>
              )}
              {reparacionFallida && onResolverConflictos && (
                <button type="button" className="primary" disabled={resolviendoConflictos} onClick={onResolverConflictos}>
                  {resolviendoConflictos ? "Preparando tarea…" : "Reintentar resolución"}
                </button>
              )}
              {reparacionTerminada && puedeVerificarConflictos && onVerificarConflictos && (
                <button type="button" className="primary" disabled={verificandoConflictos} onClick={onVerificarConflictos}>
                  {verificandoConflictos ? "Verificando en GitHub…" : "Verificar GitHub y preparar merge"}
                </button>
              )}
              {reparacionTerminada && !puedeVerificarConflictos && tareaResolucion && !cargandoDiffResolucion && (
                <p className="approval-files" role="status">La verificación se habilitará cuando el commit y la subida al PR estén aprobados.</p>
              )}
              {reparacionTerminada && cargandoDiffResolucion && <p role="status">Revisando los cambios y aprobaciones de la tarea…</p>}
              {verificacionConflictos && (
                <p className={`approval-conflicts-verification${verificacionConflictos.verificado ? " is-ready" : ""}`} role="status">
                  {verificacionConflictos.mensaje}
                </p>
              )}
            </div>
          ) : conflictos.resoluble && onResolverConflictos ? (
            <button type="button" className="primary" disabled={resolviendoConflictos} onClick={onResolverConflictos}>
              {resolviendoConflictos ? "Preparando tarea…" : "Arreglar inconsistencias"}
            </button>
          ) : (
            <p className="approval-auth approval-auth-warning" role="status">Telo no puede preparar la rama fuente automáticamente. Abre el PR en GitHub y confirma que la rama pertenece a este repositorio.</p>
          )}
        </section>
      )}
      {necesitaGitHub && p.autenticacion && (
        <div className={`approval-auth${p.autenticacion.tipo === "credencial_anterior" ? " approval-auth-warning" : ""}`} role={p.autenticacion.tipo === "credencial_anterior" ? "alert" : "status"}>
          <strong>Credencial para esta acción: {p.autenticacion.etiqueta}</strong>
          {p.autenticacion.cuenta && <span>Cuenta: @{p.autenticacion.cuenta}</span>}
          {p.autenticacion.tipo === "credencial_anterior" && (
            <span>Esta acción usará la credencial anterior indicada. Confirma que reconoces esta cuenta antes de autorizar.</span>
          )}
        </div>
      )}
      {credencialObsoleta && accion.state === "pending" && (
        <p className="approval-auth approval-auth-warning" role="alert">
          Esta autorización es antigua y no indica qué credencial usar. Prepara una nueva para comprobar el acceso y mostrar la cuenta antes de aprobar.
        </p>
      )}
      {credencialObsoleta && accion.state !== "pending" && necesitaGitHub && (
        <p className="approval-auth approval-auth-warning" role="status">
          Esta acción anterior no guardó el método de autenticación; Telo no puede confirmar qué credencial usó.
        </p>
      )}
      {p.diff && (
        <details className="approval-changes">
          <summary>Ver cambios · {p.archivos?.length ?? 0} archivos</summary>
          {p.truncado && (
            <p className="hint">
              Vista recortada. La autorización cubre todos los archivos
              enumerados.
            </p>
          )}
          {p.archivos && (
            <p className="approval-files">{p.archivos.join(", ")}</p>
          )}
          <pre className="approval-diff">{p.diff}</pre>
        </details>
      )}
      {accion.state === "pending" && (
        <div className="approval-buttons">
          {subida ? (
            destinoPendiente ? (
              <button
                type="button"
                className="primary"
                disabled={decide.isPending || credencialObsoleta}
                onClick={() => decide.mutate({ approve: true, destino: destinoPendiente })}
              >
                {decide.isPending ? "Comprobando acceso…" : "Confirmar y autorizar"}
              </button>
            ) : (
              p.source_pr_number ? (
                <button
                  type="button"
                  className="primary"
                  disabled={decide.isPending || credencialObsoleta}
                  onClick={() => decide.mutate({ approve: true, destino: "rama" })}
                >
                  Subir a {p.rama ?? "la rama del PR"} y actualizar PR #{p.source_pr_number}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary"
                    disabled={decide.isPending || credencialObsoleta}
                    onClick={() => decide.mutate({ approve: true, destino: "base" })}
                  >
                    Subir a {p.base ?? "main"} directo
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={decide.isPending || credencialObsoleta}
                    onClick={() => decide.mutate({ approve: true, destino: "rama" })}
                  >
                    Subir a {p.rama ?? "la rama de la tarea"} y abrir PR
                  </button>
                </>
              )
            )
          ) : (
            <button
              type="button"
              className="primary"
              disabled={decide.isPending || credencialObsoleta}
              onClick={() => decide.mutate({ approve: true })}
            >
              {decide.isPending
                ? necesitaGitHub ? "Comprobando acceso…" : "Ejecutando…"
                : accion.action === "merge"
                  ? "Fusionar Pull Request en GitHub"
                  : confirmarAccesoNoVerificado
                    ? "Confirmar y autorizar"
                    : `Autorizar ${titulo.toLowerCase()}`}
            </button>
          )}
          <button
            type="button"
            className="ghost"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ approve: false })}
          >
            Rechazar
          </button>
        </div>
      )}
      {accion.result && (
        <p className={`approval-result${accion.state === "failed" ? " is-failed" : ""}`} role={accion.state === "failed" ? "alert" : "status"}>
          {resultadoLegible(accion.result)}
        </p>
      )}
      {decide.isError && accion.state === "pending" && !(decide.error instanceof ApiError && decide.error.code === "action_already_decided") && (
        <p className="error" role="alert">
          {errorText(decide.error)}
        </p>
      )}
      {avisoAcceso && <p className="approval-auth approval-auth-warning" role="alert">{avisoAcceso}</p>}
    </>
  );
  return compacta ? (
    <details className="approval-history-row">
      <summary>
        <span>{titulo}</span>
        <span className="approval-files">{estado}</span>
      </summary>
      <div className="approval-history-body">{cuerpo}</div>
    </details>
  ) : (
    <section className={`panel approval-panel${accion.state === "failed" ? " is-failed" : ""}`} aria-label={titulo}>
      {cuerpo}
    </section>
  );
}

export function AccionesAnteriores({ acciones }: { acciones: RepositoryAction[] }) {
  return (
    <details className="tl-git-intentos">
      <summary>Historial de acciones Git · {acciones.length}</summary>
      <ul>
        {acciones.map((accion) => (
          <li key={accion.id}>
            <span>
              {labels[accion.action] ?? accion.action} · {estados[accion.state] ?? accion.state}
              {etiquetaAutenticacion(accion) && <small className="approval-history-auth">{etiquetaAutenticacion(accion)}</small>}
            </span>
            {accion.result && <span>{resultadoLegible(accion.result)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AccionesRepositorioChat({
  conversationId,
  projectId,
  taskId,
  terminada,
}: {
  conversationId: string;
  projectId: string | null;
  taskId?: string;
  terminada: boolean;
}) {
  const qc = useQueryClient();
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [verCambios, setVerCambios] = useState(false);
  const acciones = useQuery({
    queryKey: ["repository-actions", conversationId],
    queryFn: () => api.repositoryActions(conversationId),
    refetchInterval: 3000,
  });
  const diffQuery = useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.taskDiff(taskId!),
    enabled: Boolean(taskId && terminada),
    refetchInterval: 4000,
    retry: false,
  });
  const refrescar = () => {
    void qc.invalidateQueries({
      queryKey: ["repository-actions", conversationId],
    });
    void qc.invalidateQueries({ queryKey: ["task-diff", taskId] });
  };
  const pedir = useMutation({
    mutationFn: (args: string | { action: string; pr_number?: number; pr_url?: string; title?: string }) => {
      const body = typeof args === "string" ? { action: args } : args;
      return api.requestRepositoryAction(projectId!, {
        conversationId,
        taskId,
        ...body,
      });
    },
    onSuccess: refrescar,
  });
  const lista = acciones.data ?? [];
  const accionConflicto = [...lista].reverse().find((a) =>
    a.action === "merge" && a.state === "failed" && diagnosticoConflictos(a.result),
  ) ?? null;
  const payloadConflicto = accionConflicto ? payloadDe(accionConflicto) : {};
  const diagnosticoActual = accionConflicto ? diagnosticoConflictos(accionConflicto.result) : null;
  const tareaResolucionId = typeof payloadConflicto.repair_task_id === "string" ? payloadConflicto.repair_task_id : null;
  const mensajeResolucionId = typeof payloadConflicto.repair_message_id === "string"
    ? payloadConflicto.repair_message_id
    : accionConflicto?.message_id ?? null;
  const actividadDesde = typeof payloadConflicto.repair_activity_from_seq === "number" ? payloadConflicto.repair_activity_from_seq : 0;
  const tareaResolucionQuery = useQuery({
    queryKey: ["task", tareaResolucionId],
    queryFn: () => api.getTask(tareaResolucionId!),
    enabled: Boolean(tareaResolucionId),
    refetchInterval: (consulta) => ["done", "failed", "cancelled", "interrupted", "sin_cuota"].includes(consulta.state.data?.status ?? "") ? false : 1500,
  });
  const estadoReparacion = tareaResolucionQuery.data?.status;
  const terminalReparacion = ["done", "failed", "cancelled", "interrupted", "sin_cuota"].includes(estadoReparacion ?? "");
  const actividadResolucionQuery = useQuery({
    queryKey: ["actividad-reparacion", conversationId, mensajeResolucionId, tareaResolucionId],
    queryFn: () => api.listTurnoActividad(conversationId, mensajeResolucionId!),
    enabled: Boolean(tareaResolucionId && mensajeResolucionId),
    refetchInterval: terminalReparacion ? false : 1500,
  });
  const diffResolucionQuery = useQuery({
    queryKey: ["task-diff", tareaResolucionId],
    queryFn: () => api.taskDiff(tareaResolucionId!),
    enabled: Boolean(tareaResolucionId && estadoReparacion === "done"),
    refetchInterval: estadoReparacion === "done" ? 3000 : false,
    retry: false,
  });
  const actividadResolucion = (actividadResolucionQuery.data ?? []).filter((paso) => paso.seq > actividadDesde);
  const diffResolucion = diffResolucionQuery.data?.estado === "en_curso" ? undefined : diffResolucionQuery.data;
  const pushResolucion = lista.find((a) => a.task_id === tareaResolucionId && a.action === "push" && a.state === "approved");
  const datosPushResolucion = pushResolucion ? payloadDe(pushResolucion) : {};
  const aprobacionCommitResolucion = diffResolucion?.estado === "con_cambios" ? diffResolucion.aprobaciones.commit : null;
  const aprobacionPushResolucion = diffResolucion?.estado === "con_cambios" ? diffResolucion.aprobaciones.push : null;
  const puedeVerificarConflictos = Boolean(
    tareaResolucionId && estadoReparacion === "done" && diagnosticoActual && diffResolucion?.estado === "con_cambios" &&
    aprobacionCommitResolucion?.estado === "aprobada" && aprobacionCommitResolucion.sha === diffResolucion.commit &&
    aprobacionCommitResolucion.hash === diffResolucion.hash && aprobacionPushResolucion?.sha === diffResolucion.commit &&
    aprobacionPushResolucion.rama === diagnosticoActual.rama_fuente && aprobacionPushResolucion.remoto === diffResolucion.remoto_url &&
    pushResolucion && datosPushResolucion.source_pr_number === diagnosticoActual.pr_number &&
    datosPushResolucion.rama === diagnosticoActual.rama_fuente && datosPushResolucion.remote === diffResolucion.remoto_url,
  );
  const [verificacionVisible, setVerificacionVisible] = useState<{ id: string; resultado: VerificacionConflictos } | null>(null);
  const accionActual = [...lista].reverse().find((a) => a.id !== accionConflicto?.id && (a.state === "pending" || a.state === "executing"))
    ?? [...lista].reverse().find((a) => a.id !== accionConflicto?.id && a.state !== "superseded")
    ?? null;
  const anteriores = lista.filter((a) => a.id !== accionActual?.id && a.id !== accionConflicto?.id);
  const resolverConflictos = useMutation({
    mutationFn: (id: string) => api.resolveRepositoryConflicts(id),
    onMutate: () => setVerificacionVisible(null),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["repository-actions", conversationId] }),
        qc.invalidateQueries({ queryKey: ["conversation-tasks", conversationId] }),
      ]);
    },
  });
  const verificarConflictos = useMutation({
    mutationFn: async () => {
      if (!projectId || !accionConflicto || !diagnosticoActual || !tareaResolucionId)
        throw new Error("No se encontró la tarea de reparación para verificar este PR.");
      const resultado = await api.verifyRepositoryConflicts(accionConflicto.id);
      if (resultado.verificado) {
        await api.requestRepositoryAction(projectId, {
          action: "merge",
          conversationId,
          taskId: tareaResolucionId,
          pr_number: diagnosticoActual.pr_number,
          pr_url: resultado.pr_url ?? diagnosticoActual.pr_url,
          title: `Fusionar Pull Request #${diagnosticoActual.pr_number} en ${diagnosticoActual.rama_base}`,
        });
      }
      return resultado;
    },
    onSuccess: async (resultado) => {
      if (accionConflicto) setVerificacionVisible({ id: accionConflicto.id, resultado });
      await qc.invalidateQueries({ queryKey: ["repository-actions", conversationId] });
    },
  });
  const pendiente = lista.find(
    (a) => a.state === "pending" || a.state === "executing",
  );
  const diff = diffQuery.data?.estado === "en_curso" ? undefined : diffQuery.data;
  const archivos = diff?.archivos ?? [];
  const adiciones = archivos.reduce((total, archivo) => total + archivo.adiciones, 0);
  const eliminaciones = archivos.reduce((total, archivo) => total + archivo.eliminaciones, 0);
  const commitVigente = Boolean(
    diff?.aprobaciones.commit?.estado === "aprobada" &&
    diff.aprobaciones.commit.hash === diff.hash &&
    diff.aprobaciones.commit.sha === diff.commit,
  );
  const pushAprobacion = diff?.aprobaciones.push;
  const pushVigente = Boolean(
    commitVigente &&
    diff?.remoto &&
    pushAprobacion &&
    pushAprobacion.sha === diff.commit &&
    pushAprobacion.remoto === diff.remoto_url &&
    pushAprobacion.rama === diff.rama,
  );
  const ramaSubida = diff?.aprobaciones.push?.rama ?? diff?.rama;
  const prCreado = lista.find(
    (a) =>
      a.action === "pr" &&
      a.state === "approved" &&
      JSON.parse(a.payload).commit === diff?.commit,
  );
  const prUrl = prCreado?.result
    ? (JSON.parse(prCreado.result) as { url?: string }).url
    : null;
  const prSinCommits = lista.some((accion) => {
    if (
      accion.task_id !== taskId ||
      accion.action !== "pr" ||
      accion.state !== "failed" ||
      !diff?.commit ||
      !/no commits between/i.test(accion.result ?? "")
    ) return false;
    try {
      return (JSON.parse(accion.payload) as { commit?: string }).commit === diff.commit;
    } catch {
      return false;
    }
  });
  const puedeCrearPr = pushVigente && ramaSubida === diff?.rama && !prCreado && !prSinCommits;
  const conflictoDeTareaActual = Boolean(
    accionConflicto && taskId && diagnosticoActual &&
    (taskId === diagnosticoActual.task_id || taskId === tareaResolucionId),
  );
  const tieneCambios = Boolean(diff?.archivos.length);
  const ocupado = Boolean(pendiente) || pedir.isPending || diffQuery.isPending;
  return (
    <>
      {terminada && diff && tieneCambios && (
        <section className="tl-resumen-cambios" aria-label="Cambios realizados por la tarea">
          <header className="tl-resumen-cambios-cabecera">
            <span className="tl-resumen-cambios-icono" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M8 15h8M12 11v8" />
              </svg>
            </span>
            <span className="tl-resumen-cambios-totales">
              <strong>{archivos.length} {archivos.length === 1 ? "archivo modificado" : "archivos modificados"}</strong>
              <span><b className="tl-cambio-adicion">+{adiciones}</b><b className="tl-cambio-eliminacion">−{eliminaciones}</b></span>
            </span>
            <button
              type="button"
              className="tl-resumen-cambios-ver"
              aria-expanded={verCambios}
              aria-controls={`tl-resumen-diff-${taskId}`}
              onClick={() => setVerCambios((visible) => !visible)}
            >
              {verCambios ? "Ocultar cambios" : "Ver cambios"}
            </button>
          </header>
          <ul className="tl-resumen-cambios-archivos">
            {(mostrarTodos ? archivos : archivos.slice(0, 3)).map((archivo) => (
              <li key={archivo.ruta}>
                <span className="tl-resumen-cambios-ruta" title={archivo.ruta}>{archivo.ruta}</span>
                <span className="tl-resumen-cambios-lineas">
                  <b className="tl-cambio-adicion">+{archivo.adiciones}</b>
                  <b className="tl-cambio-eliminacion">−{archivo.eliminaciones}</b>
                </span>
              </li>
            ))}
          </ul>
          {archivos.length > 3 && (
            <button
              type="button"
              className="tl-resumen-cambios-mas"
              aria-expanded={mostrarTodos}
              onClick={() => setMostrarTodos((mostrar) => !mostrar)}
            >
              {mostrarTodos ? "Mostrar menos" : `Mostrar ${archivos.length - 3} archivos más`}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          {verCambios && (
            <div className="tl-resumen-diff" id={`tl-resumen-diff-${taskId}`}>
              {diff.truncado && <p className="tl-resumen-diff-vacio">El diff está recortado; la lista de archivos sí está completa.</p>}
              {diff.diff ? (
                <pre className="approval-diff">{diff.diff}</pre>
              ) : (
                <p className="tl-resumen-diff-vacio">No hay un diff de texto disponible para estos archivos.</p>
              )}
            </div>
          )}
        </section>
      )}
      {accionConflicto && projectId && (
        <section className="tl-accion-git-actual" aria-label={`Resolución del PR #${diagnosticoActual?.pr_number ?? ""}`}>
          <RepositoryApproval
            accion={accionConflicto}
            projectId={projectId}
            onChange={refrescar}
            onResolverConflictos={() => resolverConflictos.mutate(accionConflicto.id)}
            resolviendoConflictos={resolverConflictos.isPending}
            tareaResolucion={tareaResolucionQuery.data}
            actividadResolucion={actividadResolucion}
            cargandoDiffResolucion={diffResolucionQuery.isPending}
            puedeVerificarConflictos={puedeVerificarConflictos}
            verificandoConflictos={verificarConflictos.isPending}
            verificacionConflictos={verificacionVisible?.id === accionConflicto.id ? verificacionVisible.resultado : null}
            onVerificarConflictos={() => verificarConflictos.mutate()}
          />
          {resolverConflictos.isError && <p role="alert" className="error">{errorText(resolverConflictos.error)}</p>}
          {tareaResolucionQuery.isError && <p role="alert" className="error">No se pudo cargar el estado de la reparación: {errorText(tareaResolucionQuery.error)}</p>}
          {verificarConflictos.isError && <p role="alert" className="error">{errorText(verificarConflictos.error)}</p>}
          {actividadResolucionQuery.isError && <p role="alert" className="error">No se pudo cargar la actividad de la reparación: {errorText(actividadResolucionQuery.error)}</p>}
          {diffResolucionQuery.isError && <p role="alert" className="error">No se pudo revisar el diff de la reparación: {errorText(diffResolucionQuery.error)}</p>}
        </section>
      )}
      {accionActual && projectId && (
        <section className="tl-accion-git-actual" aria-label="Acción actual del repositorio">
          <RepositoryApproval
            accion={accionActual}
            projectId={projectId}
            onChange={refrescar}
          />
          {anteriores.length > 0 && <AccionesAnteriores acciones={anteriores} />}
        </section>
      )}
      {projectId && terminada && taskId && diff && !pendiente && !conflictoDeTareaActual && (
        <div className="approval-buttons" aria-label="Acciones del repositorio">
          {tieneCambios && !pushVigente && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => pedir.mutate(diff.remoto ? "push" : "commit")}
            >
              {pedir.isPending
                ? "Preparando…"
                : diff.remoto
                  ? "Commit y subir (elige destino)"
                  : "Crear commit"}
            </button>
          )}
          {puedeCrearPr && (
            <button
              type="button"
              className="primary"
              disabled={ocupado}
              onClick={() => pedir.mutate("pr")}
            >
              Crear PR desde {ramaSubida}
            </button>
          )}
          {prSinCommits && (
            <p className="approval-auth approval-auth-warning" role="alert">
              GitHub no ve commits nuevos en {ramaSubida}. Revisa la tarea que contiene el commit; no prepares otra autorización desde esta rama.
            </p>
          )}
          {prUrl && /^https:\/\/github\.com\//.test(prUrl) && (
            <div className="approval-pr-directo" style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <a href={prUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                Ver pull request en GitHub ↗
              </a>
              {!lista.some((a) => a.action === "merge" && a.task_id === taskId && (a.state === "pending" || a.state === "approved")) && (
                <button
                  type="button"
                  className="primary"
                  disabled={ocupado}
                  onClick={() => {
                    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
                    const prNumber = prNumberMatch ? Number(prNumberMatch[1]) : undefined;
                    pedir.mutate({
                      action: "merge",
                      pr_number: prNumber,
                      pr_url: prUrl,
                      title: `Fusionar PR #${prNumber ?? ""} en ${diff?.rama ?? "main"}`,
                    });
                  }}
                >
                  Fusionar Pull Request directamente desde Telo
                </button>
              )}
            </div>
          )}
          {pushVigente && ramaSubida !== diff?.rama && (
            <span className="approval-files" role="status">
              Cambios subidos a {ramaSubida}.
            </span>
          )}
        </div>
      )}
      {(pedir.isError || diffQuery.isError) && (
        <p role="alert" className="error">
          {errorText(pedir.error ?? diffQuery.error)}
        </p>
      )}
    </>
  );
}
