import { useState } from "react";
import { guardarTema, leerTema, type Tema } from "../lib/tema";

// Botón de la barra superior: cambia entre modo claro y oscuro. "Sistema" se elige en Ajustes.
function esClaroAhora(tema: Tema): boolean {
  if (tema === "claro") return true;
  if (tema === "oscuro") return false;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}

export function BotonTema() {
  const [tema, setTema] = useState<Tema>(() => leerTema());
  const claro = esClaroAhora(tema);
  const destino = claro ? "oscuro" : "claro";

  return (
    <button
      type="button"
      className="ghost tema-boton"
      aria-label={claro ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      title={claro ? "Modo oscuro" : "Modo claro"}
      onClick={() => {
        guardarTema(destino);
        setTema(destino);
      }}
    >
      {claro ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
