import { useState } from "react";
import { haceTexto } from "../lib/tiempo";
import { partirMensaje } from "../lib/adjuntos";
import type { FormatoDocumento } from "../api";
import { Contenido, copiarTexto } from "./chat-contenido";
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

// id: ancla para ir a este mensaje desde el historial de prompts. resaltado: destaca el mensaje un momento.
export function MensajeUsuario({
  texto,
  cuando,
  id,
  resaltado = false,
}: {
  texto: string;
  cuando: string | null;
  id?: string;
  resaltado?: boolean;
}) {
  const { texto: prosa, adjuntos } = partirMensaje(texto);
  return (
    <article id={id} className={`tl-msg tl-msg-usuario${resaltado ? " is-resaltado" : ""}`}>
      <div className="tl-msg-meta">Tú · {haceTexto(cuando)}</div>
      {prosa && <div className="tl-msg-burbuja">{prosa}</div>}
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
  onReintentar,
  onGuardar,
  guardando = false,
  proceso,
}: {
  texto: string;
  cuando: string;
  modelo: string;
  // Vuelve a enviar el mensaje del usuario que originó esta respuesta.
  onReintentar?: () => void;
  // Guarda el texto de esta respuesta como documento en el formato elegido.
  onGuardar?: (formato: FormatoDocumento) => void;
  guardando?: boolean;
  // Chat y turno de la respuesta: de ahí salen los pasos del agente ("Ver proceso").
  proceso?: { conversacionId: string; turnoId: string };
}) {
  const [estado, setEstado] = useState<"reposo" | "copiado" | "fallo">("reposo");
  const [menuAbierto, setMenuAbierto] = useState(false);

  const copiar = async () => {
    const ok = await copiarTexto(texto);
    setEstado(ok ? "copiado" : "fallo");
    window.setTimeout(() => setEstado("reposo"), 1600);
  };

  return (
    <article className="tl-msg tl-msg-agente">
      <div className="tl-msg-agente-cabecera">
        <span className="tl-msg-marca" aria-hidden="true">
          {ICONO_AGENTE}
        </span>
        <span className="tl-msg-meta">
          {modelo} · {haceTexto(cuando)}
        </span>
        <div className="tl-msg-acciones">
          <button
            type="button"
            className="tl-accion-icono"
            aria-label="Copiar respuesta"
            title={estado === "copiado" ? "Copiado" : estado === "fallo" ? "No se pudo copiar" : "Copiar respuesta"}
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
        <Contenido texto={texto} />
      </div>
    </article>
  );
}

// Mientras el agente trabaja: "Pensando…" y, debajo, cada paso en cuanto ocurre.
export function IndicadorPensando({ modelo, vivo = [] }: { modelo: string; vivo?: PasoActividad[] }) {
  return (
    <article className="tl-msg tl-msg-agente" aria-live="polite">
      <div className="tl-msg-agente-cabecera">
        <span className="tl-msg-marca" aria-hidden="true">
          {ICONO_AGENTE}
        </span>
        <span className="tl-msg-meta">{modelo}</span>
      </div>
      <div className="tl-pensando">
        <span className="tl-pensando-punto" aria-hidden="true" />
        <span>Pensando…</span>
      </div>
      {vivo.length > 0 && <ProcesoAgente pasos={vivo} enCurso />}
    </article>
  );
}
