import { useEffect, useRef, useState } from "react";
import { haceTexto, tiempoTranscurrido } from "../lib/tiempo";
import { interpretarRespuestaTarea } from "../lib/respuesta-tarea";
import { partirMensaje } from "../lib/adjuntos";
import { effortLabel } from "../lib/model";
import { urlAdjuntoImagenChat, type FormatoDocumento, type SubagentChat } from "../api";
import { Contenido, copiarTexto, type ReferenciaArchivo } from "./chat-contenido";
import { CompactacionContexto, MarcaActor, ProcesoAgente, ProcesoGuardado, SubagentesTurno } from "./chat-proceso";
import { esResumenCompactacion } from "../../../shared/compactacion";
import { FORMATOS_OPCIONES } from "./documentos";
import type { PasoActividad } from "../api";
import { MediaJobCard } from "./media-job-card";

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

function fechaUtcMs(valor: string | null): number | null {
  if (!valor) return null;
  const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(valor);
  const fecha = new Date(tieneZona ? valor : `${valor.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(fecha) ? fecha : null;
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
  conversationId,
  texto,
  cuando,
  id,
  resaltado = false,
  marcado = false,
  enCola = false,
  onToggleMarca,
  onQuitarCola,
}: {
  conversationId?: string;
  texto: string;
  cuando: string | null;
  id?: string;
  resaltado?: boolean;
  marcado?: boolean;
  enCola?: boolean;
  onToggleMarca?: () => void;
  onQuitarCola?: () => void;
}) {
  const { texto: prosa, adjuntos, imagenes } = partirMensaje(texto);
  return (
    <article id={id} className={`tl-msg tl-msg-usuario${resaltado ? " is-resaltado" : ""}`}>
      <div className="tl-msg-usuario-cabecera">
        <div className="tl-msg-meta">
          Tú · {haceTexto(cuando)}
          {enCola && <span className="tl-msg-en-cola" role="note">En cola</span>}
        </div>
        <div className="tl-msg-acciones">
          {onQuitarCola && (
            <button
              type="button"
              className="tl-accion-icono"
              aria-label="Quitar de la cola"
              title="Quitar de la cola: el mensaje se borró y no se enviará"
              onClick={onQuitarCola}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
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
      {imagenes.length > 0 && (
        <ul className="tl-adjuntos-enviados tl-adjuntos-imagenes" aria-label="Imágenes adjuntas">
          {imagenes.map((imagen) => (
            <li key={imagen.id}>
              {conversationId ? (
                <a href={urlAdjuntoImagenChat(conversationId, imagen.id)} target="_blank" rel="noreferrer" title={`Abrir ${imagen.nombre}`}>
                  <img className="tl-adjunto-imagen-enviada" src={urlAdjuntoImagenChat(conversationId, imagen.id)} alt={imagen.nombre} loading="lazy" />
                </a>
              ) : (
                <span className="tl-adjunto-nombre">{imagen.nombre}</span>
              )}
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
  permitirAbrirArchivo,
  onReintentar,
  onGuardar,
  onDerivarSkill,
  guardando = false,
  proceso,
  onAbrirSubchat,
  subagentes,
  abrirProcesoInicial = false,
  sesionCompactada = false,
  duracion,
  onCitar,
  mostrarCorreccion = true,
}: {
  texto: string;
  cuando: string;
  modelo: string | null;
  esfuerzo?: string | null;
  onAbrirArchivo?: (referencia: ReferenciaArchivo, triggerId: string) => void;
  permitirAbrirArchivo?: (referencia: ReferenciaArchivo) => boolean;
  // Vuelve a enviar el mensaje del usuario que originó esta respuesta.
  onReintentar?: () => void;
  // Carga el texto en el compositor para editarlo o iterar.
  onCitar?: (texto: string) => void;
  // La corrección solo está vigente para el último informe fallido del chat.
  mostrarCorreccion?: boolean;
  // Guarda el texto de esta respuesta como documento en el formato elegido.
  onGuardar?: (formato: FormatoDocumento) => void;
  onDerivarSkill?: () => void;
  guardando?: boolean;
  // Tiempo aproximado entre el mensaje del usuario y esta respuesta.
  duracion?: string | null;
  // Chat y turno de la respuesta: de ahí salen los pasos del agente ("Ver proceso").
  proceso?: { conversacionId: string; turnoId: string };
  onAbrirSubchat?: (id: string) => void;
  subagentes?: SubagentChat[];
  abrirProcesoInicial?: boolean;
  sesionCompactada?: boolean;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const mediaId = /^\[\[telo-media:([a-f0-9-]+)\]\]$/i.exec(texto.trim())?.[1] ?? null;
  const reporte = interpretarRespuestaTarea(texto);
  const resumenContexto = esResumenCompactacion(texto);
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
          <span className="tl-msg-modelo">{modelo ?? "Modelo no guardado"}</span>
          {esfuerzo && <span className="tl-msg-esfuerzo">{effortLabel(esfuerzo)}</span>}
          <span> · {haceTexto(cuando)}</span>{duracion ? <span className="tl-msg-duracion"> · Respondió en {duracion}</span> : null}
        </span>
        <div className="tl-msg-acciones">
          {!mediaId && <BotonCopiar texto={reporte ? `${reporte.resumen}\n${reporte.causa ?? ""}`.trim() : texto} etiqueta="Copiar respuesta" />}
          {!mediaId && onCitar && (
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
          {!mediaId && onDerivarSkill && (
            <button
              type="button"
              className="tl-accion-icono"
              aria-label="Derivar una skill global de esta experiencia"
              title="Preparar un borrador de skill global a partir de esta experiencia"
              onClick={onDerivarSkill}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z" />
                <path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
              </svg>
            </button>
          )}
          {!mediaId && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" && (
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
          {!mediaId && onReintentar && (
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
          {!mediaId && onGuardar && (
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
      {!mediaId && proceso && (
        <ProcesoGuardado
          conversacionId={proceso.conversacionId}
          turnoId={proceso.turnoId}
          textoFinal={texto}
          onAbrirSubchat={onAbrirSubchat}
          subagentes={subagentes}
          abiertoInicial={abrirProcesoInicial}
        />
      )}
      {(resumenContexto || sesionCompactada) && <CompactacionContexto texto={resumenContexto ? texto : undefined} proceso={proceso} />}
      <div className="tl-msg-texto">
        {resumenContexto ? null : mediaId ? <MediaJobCard id={mediaId} /> : (
          <>
            {reporte ? (
              <InformeTarea
                reporte={reporte}
                onAbrirArchivo={onAbrirArchivo}
                permitirAbrirArchivo={permitirAbrirArchivo}
                onPrepararCorreccion={mostrarCorreccion ? onCitar : undefined}
              />
            ) : (
              <Contenido texto={texto} onAbrirArchivo={onAbrirArchivo} permitirAbrirArchivo={permitirAbrirArchivo} />
            )}
            {reporte && (
              <details className="tl-detalles-reporte">
                <summary>Ver datos técnicos del reporte</summary>
                <pre>{reporte.detalles}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function resultadoPrueba(resultado: string): { etiqueta: string; clase: string; fallo: boolean } {
  const normalizado = resultado.trim().toLocaleLowerCase();
  if (/^(ok|correcta|aprobada|passed|pass)$/.test(normalizado)) return { etiqueta: "Correcta", clase: "is-ok", fallo: false };
  if (/fall(?:o|ó|aron|id[oa]s?)|error|failed|^fail$|exit(?:\s+code)?\s*[:=]?\s*[1-9]/.test(normalizado)) {
    return { etiqueta: "Falló", clase: "is-fallo", fallo: true };
  }
  if (normalizado === "no_aplica" || normalizado === "no aplica") return { etiqueta: "No aplica", clase: "is-neutro", fallo: false };
  return { etiqueta: resultado, clase: "is-neutro", fallo: false };
}

function promptCorreccion(reporte: NonNullable<ReturnType<typeof interpretarRespuestaTarea>>): string {
  const pruebasFallidas = reporte.pruebas.filter((prueba) => resultadoPrueba(prueba.resultado).fallo);
  return [
    "Corrige el problema informado en la tarea anterior. Antes de editar, revisa los cambios que ya existen y conserva todo lo que esté correcto; continúa sobre ese trabajo sin empezar desde cero.",
    `Resumen anterior: ${reporte.resumen}`,
    reporte.causa ? `Motivo: ${reporte.causa}` : "",
    pruebasFallidas.length ? `Pruebas fallidas:\n${pruebasFallidas.map((p) => `- ${p.comando}: ${p.resultado}`).join("\n")}` : "",
    reporte.cambios.length ? `Archivos reportados:\n${reporte.cambios.map((c) => `- ${c.archivo}`).join("\n")}` : "",
    "Explica la causa concreta, aplica la corrección y vuelve a ejecutar las pruebas afectadas. Informa el resultado real. No hagas commit, push ni PR.",
  ].filter(Boolean).join("\n\n");
}

type RolAuxiliarVivo = "arquitectura" | "seguridad" | "verificacion";
type AuxiliarVivo = {
  rol: RolAuxiliarVivo;
  modelo: string;
  estado: "running" | "done" | "failed" | "cancelled";
  avance: string;
  instruccion: string | null;
  pasos: PasoActividad[];
};

function auxiliaresEnVivo(pasos: PasoActividad[]): AuxiliarVivo[] {
  const auxiliares = new Map<RolAuxiliarVivo, AuxiliarVivo>();
  const hito = /^Auxiliar (arquitectura|seguridad|verificacion) \(([^)]+)\):\s*(.+)$/i;
  const accion = /^\[(arquitectura|seguridad|verificacion)\]\s*(.+)$/i;
  for (const paso of pasos) {
    const texto = paso.tipo === "texto" ? paso.titulo : "";
    const resultadoHito = texto.match(hito);
    const resultadoAccion = paso.tipo === "accion" ? paso.titulo.match(accion) : null;
    const rol = (resultadoHito?.[1] ?? resultadoAccion?.[1]) as RolAuxiliarVivo | undefined;
    if (!rol) continue;
    let auxiliar = auxiliares.get(rol);
    if (!auxiliar) {
      auxiliar = {
        rol,
        modelo: resultadoHito?.[2] ?? "Modelo auxiliar",
        estado: "running",
        avance: "Preparando revisión de solo lectura",
        instruccion: null,
        pasos: [],
      };
      auxiliares.set(rol, auxiliar);
    }
    if (resultadoHito) {
      const detalle = resultadoHito[3].replace(/[.!]+$/, "");
      if (/^encargo del supervisor:/i.test(detalle)) {
        auxiliar.instruccion = detalle.replace(/^encargo del supervisor:\s*/i, "");
        continue;
      }
      auxiliar.avance = detalle;
      if (/termin[oó] la revisi[oó]n/i.test(detalle)) auxiliar.estado = "done";
      else if (/fall[oó]:/i.test(detalle)) auxiliar.estado = "failed";
      else if (/cancel[oó]/i.test(detalle)) auxiliar.estado = "cancelled";
      else auxiliar.estado = "running";
    } else if (resultadoAccion && paso.tipo === "accion") {
      auxiliar.pasos.push({ ...paso, titulo: resultadoAccion[2] });
      auxiliar.avance = paso.titulo.replace(/^\[[^\]]+\]\s*/, "");
      if (paso.estado === "error") auxiliar.estado = "failed";
    }
  }
  return [...auxiliares.values()];
}

function PanelAuxiliaresVivos({ auxiliares }: { auxiliares: AuxiliarVivo[] }) {
  const [abierto, setAbierto] = useState(true);
  if (!auxiliares.length) return null;
  const activos = auxiliares.filter((auxiliar) => auxiliar.estado === "running").length;
  const estadoEtiqueta = (estado: AuxiliarVivo["estado"]) => ({
    running: "Analizando",
    done: "Completado",
    failed: "Falló",
    cancelled: "Cancelado",
  })[estado];
  return (
    <details className="tl-auxiliares-vivo" open={abierto} onToggle={(event) => setAbierto(event.currentTarget.open)}>
      <summary className="tl-auxiliares-vivo-resumen">
        <strong>Auxiliares de análisis · solo lectura</strong>
        <span>{activos ? `${activos} de ${auxiliares.length} analizando` : `${auxiliares.length} revisión${auxiliares.length === 1 ? "" : "es"} terminada${auxiliares.length === 1 ? "" : "s"}`}</span>
      </summary>
      <div className="tl-auxiliares-vivo-lista">
        {auxiliares.map((auxiliar) => (
          <article key={auxiliar.rol} className={`tl-auxiliar-vivo is-${auxiliar.estado}`}>
            <header>
              <span className="tl-auxiliar-vivo-punto" aria-hidden="true" />
              <span className="tl-auxiliar-vivo-identidad">
                <strong>{auxiliar.rol}</strong>
                <small>{auxiliar.modelo}</small>
              </span>
              <span className={`tl-auxiliar-vivo-estado is-${auxiliar.estado}`} role="status">{estadoEtiqueta(auxiliar.estado)}</span>
            </header>
            {auxiliar.instruccion && (
              <div className="tl-auxiliar-vivo-encargo">
                <strong>Encargo del Supervisor</strong>
                <p>{auxiliar.instruccion}</p>
              </div>
            )}
            <p>{auxiliar.avance}</p>
            {auxiliar.pasos.length > 0 && (
              <details className="tl-auxiliar-vivo-pasos">
                <summary>Ver actividad · {auxiliar.pasos.length}</summary>
                <ProcesoAgente pasos={auxiliar.pasos} enCurso={auxiliar.estado === "running"} actor={auxiliar.rol} />
              </details>
            )}
          </article>
        ))}
      </div>
    </details>
  );
}

function etiquetaCambio(tipo: string): string {
  const normalizado = tipo.toLocaleLowerCase();
  if (normalizado === "crear" || normalizado === "nuevo") return "Creó";
  if (normalizado === "borrar" || normalizado === "borrado") return "Eliminó";
  return "Editó";
}

function InformeTarea({
  reporte,
  onAbrirArchivo,
  permitirAbrirArchivo,
  onPrepararCorreccion,
}: {
  reporte: NonNullable<ReturnType<typeof interpretarRespuestaTarea>>;
  onAbrirArchivo?: (referencia: ReferenciaArchivo, triggerId: string) => void;
  permitirAbrirArchivo?: (referencia: ReferenciaArchivo) => boolean;
  onPrepararCorreccion?: (texto: string) => void;
}) {
  const pruebas = reporte.pruebas.map((prueba) => ({ ...prueba, resultadoUI: resultadoPrueba(prueba.resultado) }));
  const bloqueanteExterno = reporte.bloqueante_externo;
  const hayFallo = reporte.estado === "fallo" || pruebas.some((prueba) => prueba.resultadoUI.fallo);
  const requiereRevision = reporte.estado === "desviacion" || reporte.pendientes.length > 0;
  const estado = bloqueanteExterno
    ? { etiqueta: "Requiere configuración", clase: "is-neutro" }
    : hayFallo
      ? { etiqueta: "Requiere corrección", clase: "is-fallo" }
    : requiereRevision
      ? { etiqueta: "Requiere revisión", clase: "is-neutro" }
      : { etiqueta: "Completada", clase: "is-ok" };
  const cambiosVisibles = reporte.cambios.slice(0, 4);
  const cambiosRestantes = reporte.cambios.slice(4);
  const listaCambios = (cambios: typeof reporte.cambios) => (
    <ul className="tl-reporte-archivos">
      {cambios.map((cambio, i) => (
        <li key={`${cambio.archivo}-${i}`}>
          <span>{etiquetaCambio(cambio.tipo)}</span>
          <Contenido texto={`\`${cambio.archivo}\``} onAbrirArchivo={onAbrirArchivo} permitirAbrirArchivo={permitirAbrirArchivo} />
        </li>
      ))}
    </ul>
  );

  return (
    <section className={`tl-reporte-tarea ${hayFallo && !bloqueanteExterno ? "is-fallo" : ""}`} aria-label="Resultado de la tarea">
      <header className="tl-reporte-cabecera">
        <h3>Resultado de la tarea</h3>
        <span className={`tl-reporte-estado ${estado.clase}`} role="status">{estado.etiqueta}</span>
      </header>
      <div className="tl-reporte-resumen">
        <Contenido texto={reporte.resumen} onAbrirArchivo={onAbrirArchivo} permitirAbrirArchivo={permitirAbrirArchivo} />
      </div>
      {bloqueanteExterno && <p className="tl-reporte-motivo"><strong>Configuración necesaria:</strong> {bloqueanteExterno}</p>}
      {reporte.causa && <p className="tl-reporte-motivo"><strong>Motivo:</strong> {reporte.causa}</p>}
      {pruebas.length > 0 && (
        <section className="tl-reporte-seccion" aria-label="Pruebas">
          <h4>Pruebas</h4>
          <ul className="tl-reporte-pruebas">
            {pruebas.map((prueba, i) => (
              <li key={`${prueba.comando}-${i}`}>
                <code>{prueba.comando}</code>
                <span className={`tl-reporte-prueba-estado ${prueba.resultadoUI.clase}`}>{prueba.resultadoUI.etiqueta}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {reporte.cambios.length > 0 && (
        <section className="tl-reporte-seccion" aria-label="Cambios realizados">
          <h4>Cambios realizados · {reporte.cambios.length}</h4>
          {listaCambios(cambiosVisibles)}
          {cambiosRestantes.length > 0 && (
            <details className="tl-reporte-mas">
              <summary>Ver {cambiosRestantes.length} archivos más</summary>
              {listaCambios(cambiosRestantes)}
            </details>
          )}
        </section>
      )}
      {reporte.pendientes.length > 0 && (
        <section className="tl-reporte-seccion" aria-label="Pendientes">
          <h4>Pendientes</h4>
          <ul className="tl-reporte-pendientes">{reporte.pendientes.map((pendiente, i) => <li key={`${pendiente}-${i}`}>{pendiente}</li>)}</ul>
        </section>
      )}
      {hayFallo && !bloqueanteExterno && onPrepararCorreccion && (
        <div className="tl-reporte-acciones">
          <button type="button" className="tl-boton tl-boton-principal" onClick={() => onPrepararCorreccion(promptCorreccion(reporte))}>
            Preparar corrección
          </button>
          <span>Revisa la instrucción antes de enviarla.</span>
        </div>
      )}
    </section>
  );
}

// Mientras el agente trabaja: estado observable arriba y acciones/marcas de fase debajo.
export function IndicadorPensando({
  modelo,
  vivo = [],
  desde = null,
  fase,
  conversacionId,
  turnoId,
  mostrarSubagentes = false,
  orquestacionActiva = false,
  onAbrirSubchat,
}: {
  modelo: string;
  vivo?: PasoActividad[];
  desde?: string | null;
  fase?: "queued" | "analyzing" | "running" | "connecting";
  conversacionId?: string;
  turnoId?: string;
  mostrarSubagentes?: boolean;
  orquestacionActiva?: boolean;
  onAbrirSubchat?: (id: string) => void;
}) {
  const [ahora, setAhora] = useState(Date.now());
  const [ultimaActividadVista, setUltimaActividadVista] = useState(() => fechaUtcMs(desde) ?? Date.now());
  const [actividadAbierta, setActividadAbierta] = useState(true);
  useEffect(() => {
    const temporizador = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(temporizador);
  }, []);
  const firmaActividad = vivo.map((paso) => `${paso.seq}:${paso.estado}:${paso.titulo}:${paso.detalle ?? ""}`).join(",");
  useEffect(() => {
    setActividadAbierta(true);
    setUltimaActividadVista(firmaActividad ? Date.now() : fechaUtcMs(desde) ?? Date.now());
  }, [turnoId, desde]);
  useEffect(() => {
    if (firmaActividad) setUltimaActividadVista(Date.now());
  }, [firmaActividad]);
  const transcurrido = tiempoTranscurrido(desde, ahora);
  const silencioMs = Math.max(0, ahora - ultimaActividadVista);
  const silencioVisible = silencioMs >= 120_000;
  const silencioTexto = tiempoTranscurrido(new Date(ultimaActividadVista).toISOString(), ahora) ?? "2 min";
  const auxiliares = auxiliaresEnVivo(vivo);
  const pasosSupervisor = vivo.filter((paso) => !(paso.tipo === "accion" && /^\[(arquitectura|seguridad|verificacion)\]/i.test(paso.titulo)) && !(paso.tipo === "texto" && /^Auxiliar (arquitectura|seguridad|verificacion) \(/i.test(paso.titulo)));
  const ultimaAccion = [...pasosSupervisor].reverse().find((paso) => paso.tipo === "accion" && paso.estado === "en_curso");
  const ultimaNarracion = [...pasosSupervisor].reverse().find((paso) => paso.tipo === "texto")?.titulo.split("\n", 1)[0]?.slice(0, 120);
  const auxiliarActivo = [...auxiliares].reverse().find((auxiliar) => auxiliar.estado === "running");
  const ultimaHerramienta = (ultimaAccion?.herramienta ?? "").toLowerCase();
  const etiquetaHerramienta = (herramienta: string): string => {
    if (herramienta === "provider" || herramienta === "capacity") return ultimaAccion?.titulo ?? "Esperando actividad del proveedor";
    if (/^(github|gh)(?:[._-]|$)/i.test(herramienta)) return "Consultando GitHub";
    if (herramienta.startsWith("skill") || herramienta.includes("skill")) return "Aplicando una skill";
    if (/^(agent|subagent|sub_agent|spawn|delegate)/i.test(herramienta)) return "Delegando trabajo";
    if (["write", "edit", "patch", "apply_patch"].includes(herramienta)) return "Editando archivos";
    if (["read", "list"].includes(herramienta)) return "Leyendo archivos";
    if (["glob", "grep"].includes(herramienta)) return "Buscando en el proyecto";
    if (herramienta === "bash") return "Ejecutando un comando";
    if (/^(websearch|web_search|search_web|webfetch|fetch_url)$/.test(herramienta)) return "Consultando la web";
    if (herramienta.includes("compact")) return "Compactando contexto";
    return "Ejecutando una acción";
  };
  const etiquetasFase = {
    queued: "En cola",
    analyzing: "Analizando y preparando el plan",
    running: "Ejecutando el plan",
    connecting: "Esperando actividad del proveedor",
  } as const;
  let estado = ultimaAccion?.titulo || ultimaNarracion || (
    fase === "queued" ? "Esperando que la tarea inicie"
      : fase === "analyzing" ? "Analizando la solicitud y preparando el plan"
        : fase === "running" ? "El plan sigue ejecutándose; esperando el siguiente paso observable"
          : "Preparando contexto; el proveedor todavía no ha enviado actividad observable"
  );
  if (ultimaAccion) {
    const h = ultimaHerramienta;
    if (/^(github|gh)(?:[._-]|$)/i.test(h)) {
      estado = `Acción de GitHub · ${ultimaAccion.titulo}`;
    } else if (h.startsWith("skill") || h.includes("skill")) {
      estado = `Aplicando skill · ${ultimaAccion.titulo}`;
    } else if (/^(agent|subagent|sub_agent|spawn|delegate)/i.test(h)) {
      estado = `Agente auxiliar · ${ultimaAccion.titulo}`;
    } else if (["write", "edit", "patch", "apply_patch"].includes(h)) {
      estado = `Modificando archivos · ${ultimaAccion.titulo}`;
    } else if (["read", "list", "glob", "grep"].includes(h)) {
      estado = `Leyendo o buscando archivos · ${ultimaAccion.titulo}`;
    } else if (h === "bash") {
      estado = `Ejecutando comando · ${ultimaAccion.titulo}`;
    } else if (/^(websearch|web_search|search_web|webfetch|fetch_url)$/.test(h)) {
      estado = `Consultando la web · ${ultimaAccion.titulo}`;
    } else {
      estado = ultimaAccion.titulo;
    }
  }
  const actorEnEstado = estado.match(/\[(Supervisor|(?:Subagente|Subagent|Agente)(?:\s*[:#-][^\]]+)?)\]\s*/i);
  const actorEstado = actorEnEstado?.[0].trim().slice(1, -1);
  const inicioActorEstado = actorEnEstado?.index ?? -1;
  const prefijoEstado = actorEnEstado ? estado.slice(0, inicioActorEstado).replace(/\s*[·:]\s*$/, "").trim() : "";
  const detalleEstado = actorEnEstado ? estado.slice(inicioActorEstado + actorEnEstado[0].length) : "";
  const etapaVisible = ultimaAccion
    ? etiquetaHerramienta(ultimaHerramienta)
    : ultimaNarracion?.startsWith("Solicitud recibida")
      ? "Preparando contexto"
    : ultimaNarracion?.startsWith("Supervisor ") && ultimaNarracion.includes("está eligiendo")
      ? "Eligiendo auxiliares"
        : auxiliarActivo
          ? "Auxiliares trabajando en paralelo"
        : ultimaNarracion?.startsWith("Los auxiliares terminaron")
          ? "Integrando análisis"
        : ultimaNarracion?.startsWith("Contexto preparado")
          ? "Esperando actividad del proveedor"
          : ultimaNarracion?.startsWith("El modelo ") && ultimaNarracion.includes("terminó")
            ? "Guardando respuesta"
          : ultimaNarracion
            ? "Preparando la respuesta"
            : fase ? etiquetasFase[fase] : "Preparando contexto";
  return (
    <article className="tl-msg tl-msg-agente" aria-live="polite">
      <div className="tl-msg-agente-cabecera">
        <span className="tl-msg-marca" aria-hidden="true">
          {ICONO_AGENTE}
        </span>
        <span className="tl-msg-meta tl-msg-procesando">
          <span className="tl-msg-modelo">{modelo}</span>
          {transcurrido ? <span className="tl-msg-duracion">Procesando desde hace {transcurrido}</span> : null}
        </span>
      </div>
      <details
        className="tl-actividad-live"
        open={actividadAbierta}
        onToggle={(event) => setActividadAbierta(event.currentTarget.open)}
      >
        <summary className="tl-actividad-live-cabecera">
          <span className="tl-actividad-live-icono" aria-hidden="true">{ICONO_AGENTE}</span>
          <span>Actividad en vivo</span>
          <span className={`tl-actividad-live-fase${silencioVisible ? " is-sin-actividad" : ""}`}>{silencioVisible ? `Sin actividad nueva · ${silencioTexto}` : etapaVisible}</span>
          <span className="tl-actividad-live-contador">
            {pasosSupervisor.filter((paso) => paso.tipo === "accion").length} acciones del supervisor
            {auxiliares.length ? ` · ${auxiliares.length} auxiliares` : ""}
          </span>
        </summary>
        <div className="tl-actividad-live-cuerpo">
          <div className="tl-pensando" title={ultimaAccion?.titulo ?? estado} aria-live="polite">
            <span className="tl-pensando-texto">
              {actorEstado ? <>
                {prefijoEstado && <><span className="tl-pensando-prefijo">{prefijoEstado}</span><span className="tl-proceso-separador" aria-hidden="true">·</span></>}
                <MarcaActor actor={actorEstado} />
                <span className="tl-pensando-detalle">{detalleEstado}</span>
              </> : estado}
            </span>
            {(ultimaAccion || orquestacionActiva) && <span className="tl-paso-spinner" role="img" aria-label={orquestacionActiva ? "Supervisor en curso" : "Acción en curso"} />}
          </div>
            {silencioVisible && (
              <p className="tl-actividad-live-inactiva" role="status">
                No llegan pasos nuevos desde hace {silencioTexto}. El turno sigue activo, pero esta vista no puede confirmar que el proveedor avance. Si no responde, puedes detenerlo desde el chat.
              </p>
            )}
            {mostrarSubagentes && conversacionId && turnoId && (
            <SubagentesTurno
              conversacionId={conversacionId}
              turnoId={turnoId}
              onAbrir={onAbrirSubchat}
              enCurso
              mostrarEspera
            />
          )}
          <PanelAuxiliaresVivos auxiliares={auxiliares} />
          {pasosSupervisor.length > 0
            ? <ProcesoAgente pasos={pasosSupervisor} enCurso actor="Supervisor" />
            : auxiliarActivo
              ? <p className="tl-actividad-live-espera">Los auxiliares están trabajando. El supervisor incorporará sus resultados cuando terminen; la tarea sigue activa.</p>
              : mostrarSubagentes
                ? <p className="tl-actividad-live-espera">El modelo principal aún no confirmó subchats mediante la herramienta task. Las plantillas de Agentes no los crean; configura el Supervisor para ejecutar modelos auxiliares.</p>
                : orquestacionActiva && ultimaNarracion?.startsWith("Supervisor ") && ultimaNarracion.includes("está eligiendo")
                  ? <p className="tl-actividad-live-espera">El supervisor está eligiendo auxiliares. Si la selección tarda más de 15 segundos, Telo continuará sin auxiliares para que responda el modelo principal.</p>
                  : orquestacionActiva
                    ? <p className="tl-actividad-live-espera">El supervisor y sus auxiliares siguen trabajando. Aquí aparecerán sus acciones observables; puedes detener el turno desde el chat.</p>
                    : <p className="tl-actividad-live-espera">Aún no llega una acción observable del agente. El turno sigue activo; puedes detenerlo desde el chat.</p>}
        </div>
      </details>
    </article>
  );
}
