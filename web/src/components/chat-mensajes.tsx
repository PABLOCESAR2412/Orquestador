import { useState } from "react";
import { haceTexto } from "../lib/tiempo";
import { Contenido, copiarTexto } from "./chat-contenido";

// Mensajes del chat. cuando es la fecha de la base; null, un mensaje que todavía se está enviando.

const ICONO_AGENTE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

export function MensajeUsuario({ texto, cuando }: { texto: string; cuando: string | null }) {
  return (
    <article className="tl-msg tl-msg-usuario">
      <div className="tl-msg-meta">Tú · {haceTexto(cuando)}</div>
      <div className="tl-msg-burbuja">{texto}</div>
    </article>
  );
}

export function MensajeAgente({ texto, cuando, modelo }: { texto: string; cuando: string; modelo: string }) {
  const [estado, setEstado] = useState<"reposo" | "copiado" | "fallo">("reposo");

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
          <button
            type="button"
            className="tl-accion-icono"
            disabled
            aria-label="Reintentar respuesta"
            title="Reintentar no está disponible: envía el mensaje de nuevo"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
            </svg>
          </button>
          <button
            type="button"
            className="tl-accion-icono"
            disabled
            aria-label="Valorar respuesta"
            title="Valorar respuestas todavía no está disponible"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 19.7 9H14z" />
              <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
          </button>
        </div>
      </div>
      <div className="tl-msg-texto">
        <Contenido texto={texto} />
      </div>
    </article>
  );
}

export function IndicadorPensando({ modelo }: { modelo: string }) {
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
    </article>
  );
}
