import { useRef, useState, type KeyboardEvent } from "react";
import type { Conversation, Documento, ModelInfo } from "../api";
import { effortLabel, nombreProveedor } from "../lib/model";
import { useDialogo } from "./controls";
import { ListaDocumentos } from "./documentos";

// Configuración de un chat: título, esfuerzo, proyecto, fijado y documentos guardados.
// El modelo se cambia desde el selector del compositor, que es donde se usa.
export function ChatConfiguracion({
  conversacion,
  modelo,
  onCerrar,
  onCambiar,
  onVerDocumento,
  error,
}: {
  conversacion: Conversation;
  modelo: ModelInfo | null;
  onCerrar: () => void;
  onCambiar: (patch: { title?: string; effort?: string | null; pinned?: boolean }) => void;
  onVerDocumento: (documento: Documento) => void;
  error?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogo(ref, onCerrar);
  const [titulo, setTitulo] = useState(conversacion.title);
  const fijado = !!conversacion.pinned_at;
  const niveles = modelo?.variants ?? [];
  const efectoActual = conversacion.effort ?? "";

  const guardarTitulo = () => {
    const limpio = titulo.trim();
    if (!limpio) {
      setTitulo(conversacion.title);
      return;
    }
    if (limpio !== conversacion.title) onCambiar({ title: limpio.slice(0, 80) });
  };

  const teclaTitulo = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") setTitulo(conversacion.title);
  };

  return (
    <>
      <div className="scrim" onClick={onCerrar} />
      <div className="tl-dialogo tl-dialogo-lateral" role="dialog" aria-modal="true" aria-label="Configuración del chat" ref={ref}>
        <div className="tl-dialogo-cabecera">
          <h2 className="tl-dialogo-h2">Configuración del chat</h2>
          <div className="tl-dialogo-acciones">
            <button
              type="button"
              className={fijado ? "tl-pildora-ambar" : "tl-boton tl-boton-compacto"}
              aria-pressed={fijado}
              onClick={() => onCambiar({ pinned: !fijado })}
            >
              {fijado ? "Fijado" : "Fijar"}
            </button>
            <button type="button" className="tl-boton" onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="tl-dialogo-cuerpo">
          {error && (
            <p className="tl-alerta" role="alert">
              {error}
            </p>
          )}

          <label className="tl-campo">
            <span className="tl-campo-etiqueta">Título</span>
            <input
              className="tl-campo-texto"
              value={titulo}
              maxLength={80}
              onChange={(e) => setTitulo(e.target.value)}
              onBlur={guardarTitulo}
              onKeyDown={teclaTitulo}
            />
          </label>

          <div className="tl-campo">
            <span className="tl-campo-etiqueta">Modelo</span>
            <span className="tl-campo-fila">
              <span className="tl-campo-valor">
                {modelo ? `${modelo.name} · ${nombreProveedor(modelo.provider)}` : "Predeterminado: lo elige el servidor"}
              </span>
              <span className="tl-etiqueta-solo-lectura">Solo lectura</span>
            </span>
            <span className="tl-campo-ayuda">Cambia el modelo desde el selector junto al cuadro de mensaje.</span>
          </div>

          <div className="tl-campo">
            <span className="tl-campo-etiqueta" id="cfg-esfuerzo">
              Esfuerzo de razonamiento
            </span>
            {niveles.length > 0 ? (
              <div className="tl-esfuerzo tl-esfuerzo-ancho" role="radiogroup" aria-labelledby="cfg-esfuerzo">
                {["", ...niveles].map((v) => (
                  <button
                    key={v || "auto"}
                    type="button"
                    role="radio"
                    className="tl-esfuerzo-opcion"
                    aria-checked={efectoActual === v}
                    onClick={() => onCambiar({ effort: v || null })}
                  >
                    {v ? effortLabel(v) : "Auto"}
                  </button>
                ))}
              </div>
            ) : (
              <span className="tl-campo-ayuda">Este modelo no tiene niveles de esfuerzo.</span>
            )}
          </div>

          <div className="tl-campo">
            <span className="tl-campo-etiqueta">Proyecto</span>
            <span className="tl-campo-fila">
              <span className="tl-campo-valor">
                {conversacion.project_name ?? "Sin proyecto: el chat trabaja en su carpeta temporal"}
              </span>
              <span className="tl-etiqueta-solo-lectura">Solo lectura</span>
            </span>
            <span className="tl-campo-ayuda">El proyecto se elige al crear el chat.</span>
          </div>

          <ListaDocumentos conversacionId={conversacion.id} onVer={onVerDocumento} />
        </div>
      </div>
    </>
  );
}
