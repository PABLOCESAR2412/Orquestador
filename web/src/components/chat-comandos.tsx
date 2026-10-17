// Un comando del compositor. Se abre al escribir "/" al inicio del mensaje.
export type ComandoChat = {
  id: string;
  etiqueta: string;
  descripcion: string;
  ejecutar: () => void;
};

type Props = {
  comandos: ComandoChat[];
  activo: number;
  onElegir: (comando: ComandoChat) => void;
};

// Lista de comandos sobre el compositor. El foco se queda en el campo: por eso el clic no roba el foco.
export function MenuComandosChat({ comandos, activo, onElegir }: Props) {
  return (
    <div className="tl-slash" role="listbox" aria-label="Comandos del chat">
      {comandos.map((c, i) => (
        <button
          key={c.id}
          id={`comando-chat-${c.id}`}
          type="button"
          role="option"
          aria-selected={i === activo}
          className="picker-item tl-slash-item"
          aria-current={i === activo || undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onElegir(c)}
        >
          <span className="picker-main">
            <span className="picker-name">{c.etiqueta}</span>
            <span className="picker-id">{c.descripcion}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export const COMANDOS_RAPIDOS = [
  { id: "gauntlet", etiqueta: "/gauntlet", titulo: "Gauntlet 4 Cajas", desc: "Inserta la plantilla Gauntlet con Constructor y Árbitro" },
  { id: "plan", etiqueta: "/plan", titulo: "Plan de Trabajo", desc: "Genera un plan estructurado paso a paso" },
  { id: "diff", etiqueta: "/diff", titulo: "Ver Cambios", desc: "Muestra el diff detallado frente a la rama base" },
  { id: "test", etiqueta: "/test", titulo: "Ejecutar Pruebas", desc: "Corre la suite de pruebas del proyecto y reporta resultados" },
] as const;

export function BarraAtajosRapidos({
  onEjecutar,
}: {
  onEjecutar: (id: string) => void;
}) {
  return (
    <div className="tl-atajos-barra" role="toolbar" aria-label="Comandos rápidos">
      <span className="tl-atajos-titulo">Atajos rápidos:</span>
      <div className="tl-atajos-items">
        {COMANDOS_RAPIDOS.map((cmd) => (
          <button
            key={cmd.id}
            type="button"
            className="tl-atajo-pill"
            title={cmd.desc}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onEjecutar(cmd.id)}
          >
            <span className="tl-atajo-rayo" aria-hidden="true">⚡</span>
            <code className="tl-atajo-codigo">{cmd.etiqueta}</code>
            <span className="tl-atajo-nombre">{cmd.titulo}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

