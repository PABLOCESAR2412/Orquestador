import { useEffect, useRef, type RefObject } from "react";
import cambios from "../cambios.json";
import { VERSION_SISTEMA } from "../lib/version-sistema";
import { useDialogo } from "./controls";

type Cambio = (typeof cambios.cambios)[number];
type GrupoCambios = { fecha: string; cambios: Cambio[] };

const gruposCambios = [...cambios.cambios]
  .sort((a, b) => b.fecha.localeCompare(a.fecha))
  .reduce<GrupoCambios[]>((grupos, cambio) => {
    let grupo = grupos.at(-1);
    if (!grupo || grupo.fecha !== cambio.fecha) {
      grupo = { fecha: cambio.fecha, cambios: [] };
      grupos.push(grupo);
    }
    grupo.cambios.push(cambio);
    return grupos;
  }, []);

function fechaLegible(fecha: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${fecha}T12:00:00`));
}

function tipoLegible(tipo: string): string {
  if (tipo === "grande") return "Cambio grande";
  if (tipo === "mediano") return "Mejora";
  return "Ajuste";
}

export function HistorialCambios({
  disparador,
  onCerrar,
}: {
  disparador: RefObject<HTMLButtonElement | null>;
  onCerrar: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const cerrar = () => {
    disparador.current?.focus();
    onCerrar();
  };

  useDialogo(dialogRef, cerrar);
  useEffect(() => cerrarRef.current?.focus(), []);

  return (
    <>
      <div className="tl-cambios-capa" onClick={cerrar} aria-hidden="true" />
      <div
        className="panel tl-cambios-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tl-cambios-titulo"
        ref={dialogRef}
      >
        <div className="tl-cambios-cabecera">
          <div>
            <h2 id="tl-cambios-titulo">Historial de cambios</h2>
            <p>Versión {VERSION_SISTEMA} · {cambios.cambios.length} cambios registrados</p>
          </div>
          <button ref={cerrarRef} type="button" className="tl-boton tl-boton-compacto" onClick={cerrar}>
            Cerrar
          </button>
        </div>
        <div className="tl-cambios-lista" aria-label="Actualizaciones agrupadas por fecha">
          {gruposCambios.map((grupo) => (
            <section className="tl-cambios-grupo" key={grupo.fecha}>
              <h3>{fechaLegible(grupo.fecha)}</h3>
              <ul>
                {grupo.cambios.map((cambio, index) => (
                  <li className="tl-cambio" key={`${cambio.pr ?? "local"}-${cambio.titulo}-${index}`}>
                    <div className="tl-cambio-meta">
                      <span>{tipoLegible(cambio.tipo)}</span>
                      {cambio.pr !== null && <span>PR #{cambio.pr}</span>}
                    </div>
                    <p>{cambio.titulo}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
