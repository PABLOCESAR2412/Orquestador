import { InstalarHerramienta } from "./instalar-herramienta";
import { LoginAntigravityPanel } from "./login-antigravity";

export function AntigravityCard() {
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
            <p className="aj-descripcion-tarjeta">Instala el CLI oficial y autorízalo con tu cuenta de Google.</p>
          </div>
        </div>
        <a href="https://antigravity.google/docs/install?tab=cli" target="_blank" rel="noopener noreferrer">Guía oficial</a>
      </div>
      <InstalarHerramienta id="antigravity" nombre="Antigravity CLI">
        <LoginAntigravityPanel />
      </InstalarHerramienta>
    </article>
  );
}
