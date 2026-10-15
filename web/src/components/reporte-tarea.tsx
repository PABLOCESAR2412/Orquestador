export function ReporteTarea({ reporte }: { reporte: string | null }) {
  if (!reporte) return null;
  const r = JSON.parse(reporte) as {
    cambios: { archivo: string; tipo: string }[];
    pruebas: { comando: string; resultado: string }[];
    pendientes: string[];
  };
  return (
    <details className="panel approval-panel">
      <summary>Ver reporte de cambios y pruebas</summary>
      {r.cambios.length > 0 && (
        <ul>
          {r.cambios.map((c, i) => (
            <li key={i}>
              {c.tipo}: <code>{c.archivo}</code>
            </li>
          ))}
        </ul>
      )}
      <h3>Pruebas</h3>
      {r.pruebas.length ? (
        <ul>
          {r.pruebas.map((p, i) => (
            <li key={i}>
              <code>{p.comando}</code> ·{" "}
              {{ ok: "Aprobada", fallo: "Falló", no_aplica: "No aplica" }[p.resultado] ??
                p.resultado}
            </li>
          ))}
        </ul>
      ) : (
        <p>El obrero no informó pruebas.</p>
      )}
      {r.pendientes.length > 0 && (
        <>
          <h3>Pendientes</h3>
          <ul>
            {r.pendientes.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
