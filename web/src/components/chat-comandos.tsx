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
