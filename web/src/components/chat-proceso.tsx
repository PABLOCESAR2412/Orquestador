import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PasoActividad } from "../api";
import { errorText } from "../lib/model";

// Proceso del agente en un chat: lo que dijo mientras trabajaba y cada acción con su vista previa.
// Se ve en vivo mientras el agente corre, y después desde "Ver proceso" debajo de la respuesta.

type Familia = "archivo" | "busqueda" | "terminal" | "web" | "github" | "contexto" | "subagente" | "skill" | "otro";

const TRAZO = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONOS: Record<Familia, ReactNode> = {
  archivo: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  busqueda: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  terminal: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  web: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
    </svg>
  ),
  github: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  ),
  contexto: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </svg>
  ),
  subagente: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16.01" />
      <line x1="16" y1="16" x2="16" y2="16.01" />
    </svg>
  ),
  skill: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  ),
  otro: (
    <svg width="14" height="14" viewBox="0 0 24 24" {...TRAZO} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

const FAMILIA: Record<string, Familia> = {
  read: "archivo",
  list: "archivo",
  write: "archivo",
  edit: "archivo",
  patch: "archivo",
  glob: "busqueda",
  grep: "busqueda",
  bash: "terminal",
  webfetch: "web",
  websearch: "busqueda",
  web_search: "busqueda",
  search_web: "busqueda",
  fetch_url: "web",
  apply_patch: "archivo",
  compaction: "contexto",
  agent: "subagente",
  subagent: "subagente",
  invoke_subagent: "subagente",
  task: "subagente",
  spawn: "subagente",
  delegate: "subagente",
  skill: "skill",
  skills: "skill",
  use_skill: "skill",
  load_skill: "skill",
  apply_skill: "skill",
};

function familiaDe(herramienta: string | null): Familia {
  if (!herramienta) return "otro";
  const h = herramienta.toLowerCase();
  if (/^(github|gh)(?:[._-]|$)/i.test(h)) return "github";
  if (h.startsWith("skill") || h.includes("skill")) return "skill";
  if (/^(agent|subagent|sub_agent|spawn|delegate)/i.test(h)) return "subagente";
  return FAMILIA[h] || "otro";
}

function esTextoPlanJson(texto: string): boolean {
  if (!texto) return false;
  const limpio = texto.trim();
  return (
    (limpio.includes('"objetivo"') && limpio.includes('"pasos"') && (limpio.startsWith("{") || limpio.includes("```"))) ||
    /```(?:json)?\s*\{[\s\S]*"objetivo"\s*:/i.test(limpio)
  );
}

// Texto que dijo el agente y que ya aparece como respuesta: no se repite en el proceso.
// Además, no se repite el JSON crudo del plan generado por el analizador.
function sinRespuesta(pasos: PasoActividad[], textoFinal: string): PasoActividad[] {
  const final = textoFinal.trim();
  return pasos.filter((p) => {
    if (p.tipo === "texto" && esTextoPlanJson(p.titulo)) return false;
    if (p.tipo === "texto" && final && p.titulo.trim() === final) return false;
    return true;
  });
}

function AccionFila({ paso }: { paso: PasoActividad }) {
  const vista = paso.detalle ?? "";
  const primeraLinea = vista.split("\n").find((l) => l.trim()) ?? "";
  const fallo = paso.estado === "error";
  const enCurso = paso.estado === "en_curso";
  return (
    <details className={`tl-paso-accion${fallo ? " is-error" : ""}${enCurso ? " is-running" : ""}`}>
      <summary className="tl-paso-resumen">
        <span className="tl-paso-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span className="tl-paso-familia">{ICONOS[familiaDe(paso.herramienta)]}</span>
        <span className="tl-paso-titulo">{paso.titulo}</span>
        <span
          className="tl-paso-estado"
          role="img"
          aria-label={fallo ? "Falló" : enCurso ? "En curso" : "Hecho"}
          title={fallo ? "Falló" : enCurso ? "En curso" : "Hecho"}
        >
          {enCurso ? <span className="tl-paso-spinner" aria-hidden="true" /> : fallo ? "✕" : "✓"}
        </span>
        {primeraLinea && <span className="tl-paso-vista">{primeraLinea}</span>}
      </summary>
      {vista && <pre className="tl-paso-detalle">{vista}</pre>}
    </details>
  );
}

// Lista de pasos en orden. Lo que el agente dijo va como texto; cada acción, con su vista previa.
export function ProcesoAgente({
  pasos,
  enCurso = false,
  textoFinal = "",
}: {
  pasos: PasoActividad[];
  enCurso?: boolean;
  // Respuesta final del mensaje: si un paso de texto es igual, no se repite.
  textoFinal?: string;
}) {
  const visibles = sinRespuesta(pasos, textoFinal);
  if (visibles.length === 0) {
    return enCurso ? null : <p className="tl-nota">El agente respondió sin usar herramientas.</p>;
  }
  return (
    <ol className="tl-proceso" aria-label="Pasos del agente">
      {visibles.map((p) =>
        p.tipo === "texto" ? (
          <li key={p.seq} className="tl-proceso-texto">
            {p.titulo}
          </li>
        ) : (
          <li key={p.seq} className="tl-proceso-accion">
            <AccionFila paso={p} />
          </li>
        ),
      )}
    </ol>
  );
}

// Proceso de una respuesta ya terminada: se pide al abrirlo, para no cargar cada mensaje.
export function ProcesoGuardado({
  conversacionId,
  turnoId,
  textoFinal,
}: {
  conversacionId: string;
  turnoId: string;
  textoFinal: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const pasos = useQuery({
    queryKey: ["actividad", conversacionId, turnoId],
    queryFn: () => api.listTurnoActividad(conversacionId, turnoId),
    enabled: abierto,
    // Un turno terminado no cambia: se guarda en caché para no pedirlo otra vez al volver.
    staleTime: Infinity,
  });

  const acciones = pasos.data?.filter((p) => p.tipo === "accion").length ?? 0;
  const etiqueta = pasos.data ? `Proceso · ${acciones} ${acciones === 1 ? "acción" : "acciones"}` : "Ver proceso";

  return (
    <div className="tl-proceso-wrap">
      <button
        type="button"
        className="tl-proceso-boton"
        aria-expanded={abierto}
        onClick={() => setAbierto((o) => !o)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={abierto ? "is-abierto" : undefined}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {etiqueta}
      </button>
      {abierto && (
        <div className="tl-proceso-cuerpo">
          {pasos.isPending && <p className="tl-nota">Cargando el proceso…</p>}
          {pasos.isError && (
            <div className="error-box" role="alert">
              <span className="error-text">{errorText(pasos.error)}</span>
            </div>
          )}
          {pasos.data && pasos.data.length === 0 && (
            <p className="tl-nota">No hay pasos guardados para esta respuesta.</p>
          )}
          {pasos.data && pasos.data.length > 0 && <ProcesoAgente pasos={pasos.data} textoFinal={textoFinal} />}
        </div>
      )}
    </div>
  );
}
