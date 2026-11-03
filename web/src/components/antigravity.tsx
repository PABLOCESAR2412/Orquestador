import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InstalarHerramienta } from "./instalar-herramienta";
import { copiarTexto } from "./chat-contenido";
import { api } from "../api";

// Antigravity requiere una TTY interactiva para el OAuth remoto. Telo instala el CLI,
// pero el login se completa en la terminal SSH del mismo usuario del servicio.
export function AntigravityCard() {
  const [copiado, setCopiado] = useState<string | null>(null);
  const uso = useQuery({
    queryKey: ["antigravity-usage"],
    queryFn: () => api.antigravityUsage(true),
    enabled: false,
    retry: false,
  });
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
          Autoriza Antigravity desde el flujo de inicio de sesión de Ajustes. Telo guarda OAuth en Secret Service del usuario <code>orquestador</code> y comprueba la sesión con <code>/usage</code>.
        </p>
        <p className="aj-nota">
          La cuota de Antigravity es distinta del uso de Gemini API. Para mantener la sesión entre reinicios, el servicio requiere el bus persistente de usuario descrito en la guía de despliegue.
        </p>
        <p className="aj-nota aj-nota-aviso">
          Para que la CLI no se bloquee esperando confirmaciones, Telo omite sus permisos por acción. El proceso queda dentro del aislamiento de Telo: solo puede escribir en el workspace de la tarea y sus entregables; la autorización de despliegues y acciones Git sigue en el flujo de planes de Telo. Usa únicamente solicitudes y proyectos de confianza.
        </p>
        <div className="instalar-acciones">
          <button type="button" className="aj-btn" disabled={uso.isFetching} onClick={() => void uso.refetch()}>
            {uso.isFetching ? "Consultando cuotas…" : "Consultar cuotas"}
          </button>
          {uso.data?.estado === "activo" && (
            <p className="aj-nota" role="status">Cuotas informadas por la CLI · {new Date(uso.data.comprobadoEn).toLocaleString("es")}</p>
          )}
          {uso.data?.estado === "sin_cli" && <p className="aj-error" role="alert">No se encontró Antigravity CLI en el servidor. Instálala y vuelve a consultar.</p>}
          {uso.data?.estado === "sin_sesion" && <p className="aj-error" role="alert">Antigravity no pudo leer la sesión de Google desde el servicio. Comprueba el keyring y vuelve a autorizar desde Ajustes.</p>}
          {uso.data?.estado === "no_disponible" && <p className="aj-error" role="alert">La CLI no pudo consultar la cuota{uso.data.detalle ? `: ${uso.data.detalle}` : "."}</p>}
          {uso.isError && <p className="aj-error" role="alert">No se pudo consultar la cuota de Antigravity. Inténtalo de nuevo.</p>}
        </div>
        {uso.data?.estado === "activo" && uso.data.respuesta && (
          <pre className="aj-registros-texto" aria-label="Cuotas informadas por Antigravity">{uso.data.respuesta}</pre>
        )}
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
