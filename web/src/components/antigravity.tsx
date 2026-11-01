import { useState } from "react";
import { InstalarHerramienta } from "./instalar-herramienta";
import { copiarTexto } from "./chat-contenido";

// Antigravity requiere una TTY interactiva para el OAuth remoto. Telo instala el CLI,
// pero el login se completa en la terminal SSH del mismo usuario del servicio.
export function AntigravityCard() {
  const [copiado, setCopiado] = useState<string | null>(null);
  return (
    <article className="aj-tarjeta" aria-labelledby="aj-antigravity-titulo">
      <div className="aj-tarjeta-cabecera">
        <div className="aj-tarjeta-titulo">
          <span className="aj-icono" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
              <path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z" />
            </svg>
          </span>
          <div className="aj-tarjeta-texto">
            <h3 id="aj-antigravity-titulo">Antigravity CLI · Piloto</h3>
            <p className="aj-descripcion-tarjeta">Instala el harness de Google en la VM y autorízalo con tu cuenta.</p>
          </div>
        </div>
        <div className="aj-estado-proveedor" role="status">
          <span className="aj-proveedor-punto" aria-hidden="true" />
          Configuración del piloto
        </div>
      </div>
      <div className="aj-campos">
        <p className="aj-nota">
          La instalación se hace desde Telo. Para iniciar sesión, abre una terminal SSH como usuario <code>orquestador</code>,
          ejecuta <code>~/.local/bin/agy</code>, abre en tu equipo la URL que muestra y escribe allí el código que entrega Google.
          No uses <code>sudo</code> para que Telo y la terminal compartan la instalación y la sesión.
        </p>
        <p className="aj-nota">
          La CLI necesita una terminal interactiva para este acceso remoto. Tras autorizar, escribe <code>/usage</code> para ver uso restante y reinicios por modelo; luego <code>/exit</code> para cerrarla. Esta cuota corresponde a Antigravity y no al uso de Gemini API.
          Este paso instala y autentica Antigravity; todavía no cambia el runner de chats y tareas de Telo.
        </p>
        <p className="aj-nota">
          <a href="https://antigravity.google/docs/install?tab=cli" target="_blank" rel="noopener noreferrer">
            Guía oficial de instalación y autenticación
          </a>
          {" · "}
          <a href="https://antigravity.google/docs/cli/commands/usage?app=antigravity-ide" target="_blank" rel="noopener noreferrer">
            Comando oficial /usage
          </a>
        </p>
      </div>
      <InstalarHerramienta id="antigravity" nombre="Antigravity CLI">
        <div className="instalar-acciones">
          <button type="button" className="aj-btn aj-btn-primario" onClick={async () => {
            setCopiado(await copiarTexto("~/.local/bin/agy") ? "Comando copiado." : "No se pudo copiar. Selecciona el comando y cópialo.");
          }}>
            Copiar comando de inicio de sesión
          </button>
          <code className="aj-mono">~/.local/bin/agy</code>
          {copiado && <span className="aj-nota" role="status">{copiado}</span>}
        </div>
      </InstalarHerramienta>
    </article>
  );
}
