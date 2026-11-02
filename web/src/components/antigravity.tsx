import { useState } from "react";
import { InstalarHerramienta } from "./instalar-herramienta";
import { copiarTexto } from "./chat-contenido";

// El login se completa por SSH; el runner usa el almacén de archivos de esa VM.
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
            <h3 id="aj-antigravity-titulo">Antigravity CLI</h3>
            <p className="aj-descripcion-tarjeta">CLI independiente; conserva su propia sesión y cuota.</p>
          </div>
        </div>
        <div className="aj-estado-proveedor" role="status">
          <span className="aj-proveedor-punto" aria-hidden="true" />
          Inicio por SSH
        </div>
      </div>
      <div className="aj-campos">
        <p className="aj-nota">
          Abre una terminal SSH como usuario <code>orquestador</code>, ejecuta <code>~/.local/bin/agy</code>,
          abre la URL que imprime en tu navegador y pega el código de Google directamente en esa misma terminal. No escribas el código en Telo ni uses <code>sudo</code>.
        </p>
        <p className="aj-nota">
          La CLI necesita esa terminal interactiva para autorizar. Después escribe <code>/usage</code> para ver el uso restante y los reinicios por modelo; escribe <code>/exit</code> al terminar.
          Esa cuota es de Antigravity, aparte de la API de Google. Después del login, pulsa «Actualizar modelos» en la fila de Antigravity para mostrar su catálogo nativo. El aislamiento requiere el almacén de archivos del login SSH; las sesiones que solo están en el keyring no se comparten.
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
            Copiar comando para SSH
          </button>
          <code className="aj-mono">~/.local/bin/agy</code>
          {copiado && <span className="aj-nota" role="status">{copiado}</span>}
        </div>
      </InstalarHerramienta>
    </article>
  );
}
