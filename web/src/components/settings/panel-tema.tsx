import { useState } from "react";
import { guardarTema, leerTema, type Tema } from "../../lib/tema";

const OPCIONES_TEMA: { valor: Tema; texto: string }[] = [
  { valor: "sistema", texto: "Sistema" },
  { valor: "oscuro", texto: "Oscuro" },
  { valor: "claro", texto: "Claro" },
];

export function TemaPanel() {
  const [tema, setTema] = useState<Tema>(() => leerTema());

  return (
    <article className="aj-tarjeta" aria-labelledby="ajustes-tema">
      <h3 id="ajustes-tema" className="aj-tarjeta-titulo-simple">
        Tema
      </h3>
      <p className="aj-nota">Se guarda en este dispositivo. Sistema sigue el modo de tu teléfono o PC.</p>
      <div className="segmented" role="group" aria-label="Tema de la app">
        {OPCIONES_TEMA.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={tema === o.valor}
            onClick={() => {
              setTema(o.valor);
              guardarTema(o.valor);
            }}
          >
            {o.texto}
          </button>
        ))}
      </div>
    </article>
  );
}
