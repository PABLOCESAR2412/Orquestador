import { useEffect, useRef, useState } from "react";
import { haceTexto, tiempoTranscurrido } from "../lib/tiempo";
import { interpretarRespuestaTarea } from "../lib/respuesta-tarea";
import { partirMensaje } from "../lib/adjuntos";
import { effortLabel } from "../lib/model";
import type { FormatoDocumento } from "../api";
import { Contenido, copiarTexto, type ReferenciaArchivo } from "./chat-contenido";
import { ProcesoAgente, ProcesoGuardado } from "./chat-proceso";
import { FORMATOS_OPCIONES } from "./documentos";
import type { PasoActividad } from "../api";

// Mensajes del chat. cuando es la fecha de la base; null, un mensaje que todavía se está enviando.

const ICONO_AGENTE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [estado, setEstado] = useState<"reposo" | "copiado" | "fallo">("reposo");

  const copiar = async () => {
    const ok = await copiarTexto(texto);
    setEstado(ok ? "copiado" : "fallo");
    window.setTimeout(() => setEstado("reposo"), 1600);
  };

  return (
    <button
      type="button"
      className="tl-accion-icono"
      aria-label={etiqueta}
      title={estado === "copiado" ? "Copiado" : estado === "fallo" ? "No se pudo copiar" : etiqueta}
      onClick={() => void copiar()}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {estado === "copiado" ? (
          <polyline points="20 6 9 17 4 12" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        )}
      </svg>
    </button>
  );
}

function textoParaVoz(texto: string): string {
  return texto
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[~*_]/g, "")
    .trim();
}

function vozEspanola(): SpeechSynthesisVoice | undefined {
  const idioma = navigator.language.toLowerCase();
  const voces = window.speechSynthesis
    .getVoices()
    .filter((voz) => /^es(?:-|$)/i.test(voz.lang));
  return (
    voces.find((voz) => voz.lang.toLowerCase() === idioma) ??
    voces.find((voz) => voz.lang.toLowerCase() === "es-mx") ??
    voces.find((voz) => voz.lang.toLowerCase() === "es-es") ??
    voces[0]
  );
}

let utteranceActiva: SpeechSynthesisUtterance | null = null;
let limpiarLecturaActiva: (() => void) | null = null;

function renderizarTextoConSkills(texto: string) {
  const partes = texto.split(/(?:^|(?<=[\s([{"'`]))([$/][a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?=$|[\s)\]}"'`,:;.!?])/gi);
  if (partes.length === 1) return texto;

  return partes.map((parte, index) => {
    if (parte && (parte.startsWith("$") || parte.startsWith("/"))) {
      const nombre = parte.slice(1);
      if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i.test(nombre)) {
        return (
          <span key={index} className="tl-skill-badge" title={`Skill: ${nombre}`}>
            {parte}
          </span>
        );
      }
    }
    return parte;
  });
}

// id: ancla para ir a este mensaje desde el historial de prompts. resaltado: destaca el mensaje un momento.
export function MensajeUsuario({
  texto,
  cuando,
  id,
  resaltado = false,
  marcado = false,
  onToggleMarca,
}: {
  texto: string;
  cuando: string | null;
  id?: string;
  resaltado?: boolean;
  marcado?: boolean;
  onToggleMarca?: () => void;
}) {
  const { texto: prosa, adjuntos } = partirMensaje(texto);
  return (
    <article id={id} className={`tl-msg tl-msg-usuario${resaltado ? " is-resaltado" : ""}`}>
      <div className="tl-msg-usuario-cabecera">
        <div className="tl-msg-meta">Tú · {haceTexto(cuando)}</div>
        <div className="tl-msg-acciones">
          {onToggleMarca && (
            <button
              type="button"
              className={`tl-accion-icono tl-msg-marcar${marcado ? " is-marcado" : ""}`}
              aria-label={marcado ? "Quitar marca de importante" : "Marcar mensaje como importante"}
              aria-pressed={marcado}
              title={marcado ? "Quitar marca de importante" : "Marcar como importante"}
              onClick={onToggleMarca}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={marcado ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 4h12v16l-6-4-6 4z" />
              </svg>
            </button>
          )}
          <BotonCopiar texto={texto} etiqueta="Copiar mensaje" />
        </div>
      </div>
      {prosa && <div className="tl-msg-burbuja">{renderizarTextoConSkills(prosa)}</div>}
      {adjuntos.length > 0 && (
        <ul className="tl-adjuntos-enviados" aria-label="Archivos adjuntos">
          {adjuntos.map((a, i) => (
            <li key={`${a.nombre}-${i}`}>
              <details>
                <summary>
                  <span className="tl-adjunto-nombre">{a.nombre}</span>
                </summary>
                <pre className="tl-adjunto-cuerpo">{a.contenido}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function MensajeAgente({
  texto,
  cuando,
  modelo,
  esfuerzo,
  onAbrirArchivo,
  onReintentar,
  onGuardar,
  guardando = false,
  proceso,
  duracion,
  onCitar,
}: {
  texto: string;
  cuando: string;
  modelo: string | null;
  esfuerzo?: string | null;
  onAbrirArchivo?: (referencia: ReferenciaArchivo, triggerId: string) => void;
  // Vuelve a enviar el mensaje del usuario que originó esta respuesta.
  onReintentar?: () => void;
  // Carga el texto en el compositor para editarlo o iterar.
  onCitar?: (texto: string) => void;
  // Guarda el texto de esta respuesta como documento en el formato elegido.
  onGuardar?: (formato: FormatoDocumento) => void;
  guardando?: boolean;
  // Tiempo aproximado entre el mensaje del usuario y esta respuesta.
  duracion?: string | null;
  // Chat y turno de la respuesta: de ahí salen los pasos del agente ("Ver proceso").
  proceso?: { conversacionId: string; turnoId: string };
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const reporte = interpretarRespuestaTarea(texto);
  const [leyendo, setLeyendo] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const montadoRef = useRef(false);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      const utterance = utteranceRef.current;
      if (utterance && utteranceActiva === utterance) {
        window.speechSynthesis.cancel();
        utteranceActiva = null;
        limpiarLecturaActiva = null;
      }
      utteranceRef.current = null;
    };
  }, []);

  const leer = () => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    if (leyendo) {
      const utterance = utteranceRef.current;
      if (utterance && utteranceActiva === utterance) window.speechSynthesis.cancel();
      if (utterance && utteranceRef.current === utterance) limpiarLecturaActiva?.();
      utteranceActiva = null;
      limpiarLecturaActiva = null;
      utteranceRef.current = null;
      setLeyendo(false);
      return;
    }
    const contenido = textoParaVoz(reporte ? `${reporte.resumen}\n${reporte.causa ?? ""}` : texto);
    if (!contenido) return;
    if (utteranceActiva) {
      window.speechSynthesis.cancel();
      limpiarLecturaActiva?.();
    }
    const utterance = new SpeechSynthesisUtterance(contenido);
    const voz = vozEspanola();
    utterance.lang = voz?.lang || "es-ES";
    if (voz) utterance.voice = voz;
    const limpiar = () => {
      if (!montadoRef.current) return;
      if (utteranceActiva === utterance) {
        utteranceActiva = null;
        limpiarLecturaActiva = null;
      }
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setLeyendo(false);
    };
    utterance.onend = limpiar;
    utterance.onerror = limpiar;
    utteranceActiva = utterance;
    limpiarLecturaActiva = limpiar;
    utteranceRef.current = utterance;
    setLeyendo(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <article className="tl-msg tl-msg-agente">
      <div className="tl-msg-agente-cabecera">
        <span className="tl-msg-marca" aria-hidden="true">
          {ICONO_AGENTE}
        </span>
        <span className="tl-msg-meta">
          <span className="tl-msg-modelo">{modelo ?? "Modelo no registrado"}</span>
          {esfuerzo && <span className="tl-msg-esfuerzo">{effortLabel(esfuerzo)}</span>}
          <span> · {haceTexto(cuando)}</span>{duracion ? <span className="tl-msg-duracion"> · Respondió en {duracion}</span> : null}
        </span>
        <div className="tl-msg-acciones">
          <BotonCopiar texto={reporte ? `${reporte.resumen}\n${reporte.causa ?? ""}`.trim() : texto} etiqueta="Copiar respuesta" />
          {onCitar && (
            <button
              type="button"
              className="tl-accion-icono"
              aria-label="Citar o editar en compositor"
              title="Cargar esta respuesta en el compositor para editarla o continuar sobre ella"
              onClick={() => onCitar(reporte ? `${reporte.resumen}\n${reporte.causa ?? ""}`.trim() : texto)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {"speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" && (
            <button
              type="button"
              className="tl-accion-icono"
              aria-label={leyendo ? "Detener lectura" : "Escuchar respuesta"}
              title={leyendo ? "Detener lectura" : "Escuchar respuesta"}
              aria-pressed={leyendo}
              onClick={leer}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {leyendo ? (
                  <>
                    <rect x="7" y="7" width="10" height="10" rx="1" />
                  </>
                ) : (
                  <>
                    <path d="M11 5 6 9H3v6h3l5 4z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    <path d="M19 5a10 10 0 0 1 0 14" />
                  </>
                )}
              </svg>
            </button>
          )}
          {onReintentar && (
            <button
              type="button"
              className="tl-accion-icono"
              aria-label="Reintentar respuesta"
              title="Volver a enviar el mensaje anterior"
              onClick={onReintentar}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
              </svg>
            </button>
          )}
          {onGuardar && (
            <div className="tl-menu-wrap">
              <button
                type="button"
                className="tl-accion-icono"
                aria-label="Guardar como documento"
                title="Guardar como documento"
                aria-haspopup="menu"
                aria-expanded={menuAbierto}
                disabled={guardando}
                onClick={() => setMenuAbierto((o) => !o)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </button>
              {menuAbierto && (
                <>
                  <div className="tl-menu-fondo" onClick={() => setMenuAbierto(false)} aria-hidden="true" />
                  <div className="tl-menu-formatos" role="menu" aria-label="Formato del documento">
                    {FORMATOS_OPCIONES.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="menuitem"
                        className="tl-menu-item"
                        onClick={() => {
                          setMenuAbierto(false);
                          onGuardar(f.id);
                        }}
                      >
                        {f.etiqueta}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {proceso && (
        <ProcesoGuardado conversacionId={proceso.conversacionId} turnoId={proceso.turnoId} textoFinal={texto} />
      )}
      <div className="tl-msg-texto">
        <Contenido texto={reporte?.resumen ?? texto} onAbrirArchivo={onAbrirArchivo} />
        {reporte?.causa && <p className="tl-alerta">{reporte.causa}</p>}
        {reporte && (
          <details className="tl-detalles-reporte">
            <summary>Ver detalles técnicos</summary>
            <pre>{reporte.detalles}</pre>
          </details>
        )}
      </div>
    </article>
  );
}

// Mientras el agente trabaja: "Pensando…" y, debajo, cada paso en cuanto ocurre.
export function IndicadorPensando({ modelo, vivo = [], desde = null }: { modelo: string; vivo?: PasoActividad[]; desde?: string | null }) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const temporizador = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(temporizador);
  }, []);
  const transcurrido = tiempoTranscurrido(desde, ahora);
  const ultimaAccion = [...vivo].reverse().find((paso) => paso.tipo === "accion");
  let estado = "Escribiendo";
  if (ultimaAccion) {
    const h = (ultimaAccion.herramienta ?? "").toLowerCase();
    if (/^(github|gh)(?:[._-]|$)/i.test(h)) {
      estado = ultimaAccion.titulo || "Usando GitHub";
    } else if (h.startsWith("skill") || h.includes("skill")) {
      estado = ultimaAccion.titulo || "Aplicando skill";
    } else if (/^(agent|subagent|sub_agent|spawn|delegate)/i.test(h)) {
      estado = ultimaAccion.titulo || "Subagente activo";
    } else if (["write", "edit", "patch", "apply_patch"].includes(h)) {
      estado = ultimaAccion.titulo || "Editando archivos";
    } else if (["read", "list", "glob", "grep"].includes(h)) {
      estado = ultimaAccion.titulo || "Investigando archivos";
    } else if (h === "bash") {
      estado = ultimaAccion.titulo || "Ejecutando comando";
    } else if (h === "websearch" || h === "webfetch") {
      estado = ultimaAccion.titulo || "Buscando en la web";
    } else {
      estado = ultimaAccion.titulo || "Trabajando";
    }
  }
  return (
    <article className="tl-msg tl-msg-agente" aria-live="polite">
      <div className="tl-msg-agente-cabecera">
        <span className="tl-msg-marca" aria-hidden="true">
          {ICONO_AGENTE}
        </span>
        <span className="tl-msg-meta">{modelo}{transcurrido ? <span className="tl-msg-duracion"> · Procesando desde hace {transcurrido}</span> : null}</span>
      </div>
      <div className="tl-pensando" title={ultimaAccion?.titulo ?? estado}>
        <span className="tl-pensando-texto">{estado}</span>
        <span className="tl-escribiendo-puntos" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      {vivo.length > 0 && (
        <details className="tl-actividad-live" open>
          <summary className="tl-actividad-live-cabecera">
            <span className="tl-actividad-live-icono" aria-hidden="true">{ICONO_AGENTE}</span>
            <span>Actividad del agente</span>
            <span className="tl-actividad-live-contador">{vivo.filter((paso) => paso.tipo === "accion").length} acciones</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <div className="tl-actividad-live-scroll" role="region" aria-label="Actividad reciente del agente">
            <ProcesoAgente pasos={vivo} enCurso />
          </div>
        </details>
      )}
    </article>
  );
}
