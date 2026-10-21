type SkeletonKind = "lineas" | "tarjetas" | "contenido";

/** Reemplazo visual y accesible para los estados de carga iniciales. */
export function LoadingSkeleton({
  tipo = "lineas",
  cantidad = 3,
  className = "",
}: {
  tipo?: SkeletonKind;
  cantidad?: number;
  className?: string;
}) {
  return (
    <div
      className={`carga-esqueleto carga-esqueleto--${tipo}${className ? ` ${className}` : ""}`}
      role="status"
      aria-label="Cargando contenido"
    >
      {Array.from({ length: cantidad }, (_, index) => (
        <div className="carga-esqueleto-pieza" key={index} aria-hidden="true">
          {tipo === "tarjetas" ? (
            <>
              <span className="carga-esqueleto-linea" />
              <span className="carga-esqueleto-linea" />
              <span className="carga-esqueleto-linea" />
            </>
          ) : (
            <>
              <span className="carga-esqueleto-linea" />
              {tipo === "contenido" && <span className="carga-esqueleto-linea" />}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
