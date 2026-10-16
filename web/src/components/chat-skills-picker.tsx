export type SkillOpcion = {
  nombre: string;
  descripcion: string | null;
  ambito: "proyecto" | "global";
};

type Props = {
  skills: SkillOpcion[];
  prefijo: "$" | "/";
  activo: number;
  onElegir: (skill: SkillOpcion) => void;
};

// Menú emergente de autocompletado de skills al escribir $ o / en el compositor
export function MenuSkillsChat({ skills, prefijo, activo, onElegir }: Props) {
  if (skills.length === 0) return null;

  return (
    <div className="tl-slash tl-skills-picker" role="listbox" aria-label="Skills disponibles">
      <div className="tl-skills-picker-header">
        <span className="tl-skills-picker-titulo">Skills disponibles ({prefijo})</span>
        <span className="tl-skills-picker-ayuda">Tab o Enter para insertar</span>
      </div>
      <div className="tl-skills-picker-lista">
        {skills.map((s, i) => (
          <button
            key={`${s.ambito}-${s.nombre}`}
            id={`skill-opcion-${s.nombre}`}
            type="button"
            role="option"
            aria-selected={i === activo}
            className={`picker-item tl-slash-item${i === activo ? " is-activa" : ""}`}
            aria-current={i === activo || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onElegir(s)}
          >
            <span className="picker-main">
              <span className="picker-name">
                <span className="tl-skill-simbolo">{prefijo}</span>
                {s.nombre}
                <span className={`tl-skill-ambito-tag is-${s.ambito}`}>
                  {s.ambito === "proyecto" ? "Proyecto" : "Global"}
                </span>
              </span>
              {s.descripcion && <span className="picker-id">{s.descripcion}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
