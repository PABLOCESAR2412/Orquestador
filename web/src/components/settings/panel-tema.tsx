import { useEffect, useState } from "react";
import {
  guardarEscalaTexto,
  guardarTema,
  guardarTipografia,
  leerEscalaTexto,
  leerTema,
  leerTipografia,
  TEMAS,
  TIPOGRAFIAS,
  type Tema,
  type TipografiaId,
} from "../../lib/tema";

export function TemaPanel() {
  const [tema, setTema] = useState<Tema>(() => leerTema());
  useEffect(() => {
    const actualizar = () => setTema(leerTema());
    window.addEventListener("telo:tema-cambiado", actualizar);
    return () => window.removeEventListener("telo:tema-cambiado", actualizar);
  }, []);
  const [tipografia, setTipografia] = useState<TipografiaId>(() => leerTipografia());
  const [escala, setEscala] = useState(() => leerEscalaTexto());
  const muestra = TIPOGRAFIAS.find((f) => f.id === tipografia) ?? TIPOGRAFIAS[0];

  return (
    <article className="aj-tarjeta aj-apariencia" aria-labelledby="ajustes-apariencia">
      <div className="aj-apariencia-cabecera">
        <div>
          <h2 id="ajustes-apariencia" className="aj-tarjeta-titulo-simple">Personalización</h2>
          <p className="aj-nota">Ajusta la apariencia de Telo en este dispositivo. Los cambios se aplican al instante.</p>
        </div>
        <button
          type="button"
          className="aj-btn"
          onClick={() => {
            guardarTema("telo-obsidiana");
            guardarTipografia("geist");
            guardarEscalaTexto(100);
            setTema("telo-obsidiana");
            setTipografia("geist");
            setEscala(100);
          }}
        >
          Restablecer
        </button>
      </div>

      <section className="aj-apariencia-seccion" aria-labelledby="ajustes-paletas">
        <div className="aj-apariencia-label-fila">
          <div>
            <h3 id="ajustes-paletas" className="aj-apariencia-subtitulo">Temas</h3>
            <p className="aj-nota">20 paletas para personalizar los colores de toda la interfaz.</p>
          </div>
          <button
            type="button"
            className="aj-apariencia-auto"
            aria-pressed={tema === "sistema"}
            onClick={() => {
              guardarTema("sistema");
              setTema("sistema");
            }}
          >
            Automático
          </button>
        </div>
        <div className="aj-temas-grid" role="radiogroup" aria-label="Tema de color">
          {TEMAS.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              role="radio"
              aria-checked={tema === opcion.id}
              aria-label={opcion.nombre}
              className={`aj-tema-opcion${tema === opcion.id ? " is-seleccionado" : ""}`}
              onClick={() => {
                guardarTema(opcion.id);
                setTema(opcion.id);
              }}
            >
              <span className="aj-tema-muestras" aria-hidden="true">
                <i style={{ background: opcion.bg }} />
                <i style={{ background: opcion.surface }} />
                <i style={{ background: opcion.accent }} />
              </span>
              <span className="aj-tema-nombre">{opcion.nombre}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="aj-apariencia-controles">
        <label className="aj-apariencia-control" htmlFor="ajustes-tipografia">
          <span>
            <strong>Tipografía</strong>
            <small>Aplica a los textos de la interfaz.</small>
          </span>
          <select
            id="ajustes-tipografia"
            value={tipografia}
            onChange={(evento) => {
              const id = evento.target.value as TipografiaId;
              guardarTipografia(id);
              setTipografia(id);
            }}
          >
            {TIPOGRAFIAS.map((fuente) => <option key={fuente.id} value={fuente.id}>{fuente.nombre}</option>)}
          </select>
        </label>

        <label className="aj-apariencia-control aj-escala-control" htmlFor="ajustes-escala-texto">
          <span>
            <strong>Tamaño del texto</strong>
            <small>Amplía o reduce texto y controles para mantener la proporción.</small>
          </span>
          <span className="aj-escala-campo">
            <input
              id="ajustes-escala-texto"
              type="range"
              min={90}
              max={125}
              step={5}
              value={escala}
              onChange={(evento) => {
                const valor = Number(evento.target.value);
                guardarEscalaTexto(valor);
                setEscala(valor);
              }}
            />
            <output htmlFor="ajustes-escala-texto">{escala}%</output>
          </span>
        </label>
      </div>

      <div className="aj-apariencia-preview" aria-live="polite">
        <span className="aj-apariencia-preview-etiqueta">Vista previa</span>
        <strong style={{ fontFamily: muestra.stack }}>Una interfaz a tu manera</strong>
        <span style={{ fontFamily: muestra.stack }}>Elige el tema, la tipografía y el tamaño que te resulten más cómodos.</span>
      </div>
    </article>
  );
}
