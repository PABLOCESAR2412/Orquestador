// Paginación de una lista: anterior, siguiente y "Página X de Y". Sin paginación si todo cabe en una página.
export function Paginacion({
  pagina,
  total,
  porPagina,
  onCambio,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  onCambio: (pagina: number) => void;
}) {
  if (total <= porPagina) return null;
  const paginas = Math.ceil(total / porPagina);

  return (
    <nav className="paginacion" aria-label="Paginación">
      <button
        type="button"
        className="ghost paginacion-boton"
        disabled={pagina <= 1}
        onClick={() => onCambio(pagina - 1)}
      >
        Anterior
      </button>
      <span className="paginacion-estado" aria-live="polite">
        Página {pagina} de {paginas}
      </span>
      <button
        type="button"
        className="ghost paginacion-boton"
        disabled={pagina >= paginas}
        onClick={() => onCambio(pagina + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
