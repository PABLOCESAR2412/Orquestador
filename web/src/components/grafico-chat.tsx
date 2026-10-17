type TipoGrafico = "bar" | "line" | "pie" | "donut" | "stats";
type PuntoGrafico = { label: string; value: number; detail?: string };
export type DatosGraficoChat = {
  type: TipoGrafico;
  title: string;
  unit: string;
  data: PuntoGrafico[];
};

const TITULOS: Record<TipoGrafico, string> = {
  bar: "Gráfico de barras",
  line: "Gráfico de líneas",
  pie: "Gráfico circular",
  donut: "Gráfico de dona",
  stats: "Estadísticas",
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

// El bloque es contenido de modelo: limitarlo y validarlo evita SVG arbitrario y evita escalas absurdas.
export function leerGraficoChat(codigo: string): DatosGraficoChat | null {
  if (codigo.length > 8_000) return null;
  try {
    const valor: unknown = JSON.parse(codigo);
    if (!esRegistro(valor) || !["bar", "line", "pie", "donut", "stats"].includes(String(valor.type))) return null;
    const type = valor.type as TipoGrafico;
    const filas = valor.data;
    if (!Array.isArray(filas) || filas.length < (type === "line" || type === "pie" || type === "donut" ? 2 : 1) || filas.length > 12) return null;

    const data: PuntoGrafico[] = [];
    for (const fila of filas) {
      if (!esRegistro(fila) || typeof fila.label !== "string" || typeof fila.value !== "number") return null;
      const label = fila.label.trim();
      if (!label || label.length > 80 || /[\u0000-\u001f]/.test(label)) return null;
      if (!Number.isFinite(fila.value) || Math.abs(fila.value) > 1_000_000_000_000) return null;
      if ((type === "pie" || type === "donut") && fila.value < 0) return null;
      if (fila.detail !== undefined && (typeof fila.detail !== "string" || fila.detail.length > 160)) return null;
      data.push({ label, value: fila.value, ...(typeof fila.detail === "string" ? { detail: fila.detail } : {}) });
    }
    if ((type === "pie" || type === "donut") && data.reduce((sum, point) => sum + point.value, 0) <= 0) return null;
    if (valor.title !== undefined && (typeof valor.title !== "string" || valor.title.length > 100)) return null;
    if (valor.unit !== undefined && (typeof valor.unit !== "string" || valor.unit.length > 20)) return null;
    return {
      type,
      title: (typeof valor.title === "string" && valor.title.trim()) || TITULOS[type],
      unit: typeof valor.unit === "string" ? valor.unit.trim() : "",
      data,
    };
  } catch {
    return null;
  }
}

function numero(valor: number): string {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(valor);
}

function valorConUnidad(valor: number, unidad: string): string {
  return `${numero(valor)}${unidad ? ` ${unidad}` : ""}`;
}

function graficoLinea(datos: DatosGraficoChat) {
  const ancho = 360;
  const alto = 220;
  const izq = 34;
  const der = 352;
  const arriba = 18;
  const abajo = 178;
  const minimo = Math.min(0, ...datos.data.map((punto) => punto.value));
  const maximo = Math.max(0, ...datos.data.map((punto) => punto.value));
  const rango = maximo - minimo || 1;
  const x = (indice: number) => izq + (indice * (der - izq)) / Math.max(1, datos.data.length - 1);
  const y = (valor: number) => abajo - ((valor - minimo) / rango) * (abajo - arriba);
  const puntos = datos.data.map((punto, indice) => `${x(indice)},${y(punto.value)}`).join(" ");
  const saltoEtiqueta = Math.max(1, Math.ceil(datos.data.length / 4));

  return (
    <svg className="tl-grafico-linea" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${datos.title}: ${datos.data.map((p) => `${p.label}, ${valorConUnidad(p.value, datos.unit)}`).join("; ")}`}>
      {[0, 0.5, 1].map((fraccion) => {
        const yTick = abajo - fraccion * (abajo - arriba);
        const valorTick = minimo + rango * fraccion;
        return <g key={fraccion}><line className="tl-grafico-cuadricula" x1={izq} x2={der} y1={yTick} y2={yTick} /><text className="tl-grafico-eje" x={izq - 7} y={yTick + 3} textAnchor="end">{numero(valorTick)}</text></g>;
      })}
      <polyline className="tl-grafico-trazo" points={puntos} />
      {datos.data.map((punto, indice) => (
        <g key={`${punto.label}-${indice}`}>
          <circle className="tl-grafico-punto" cx={x(indice)} cy={y(punto.value)} r="4"><title>{punto.label}: {valorConUnidad(punto.value, datos.unit)}</title></circle>
          {(indice % saltoEtiqueta === 0 || indice === datos.data.length - 1) && <text className="tl-grafico-eje" x={x(indice)} y={abajo + 19} textAnchor="middle">{punto.label.slice(0, 12)}</text>}
        </g>
      ))}
    </svg>
  );
}

function puntoPolar(centro: number, radio: number, angulo: number): [number, number] {
  const radianes = ((angulo - 90) * Math.PI) / 180;
  return [centro + radio * Math.cos(radianes), centro + radio * Math.sin(radianes)];
}

function graficoCircular(datos: DatosGraficoChat) {
  const total = datos.data.reduce((suma, punto) => suma + punto.value, 0);
  let angulo = 0;
  const radio = 68;
  const centro = 80;
  const segmentos = datos.data.flatMap((punto, indice) => {
    if (punto.value === 0) return [];
    const barrido = (punto.value / total) * 360;
    const inicio = puntoPolar(centro, radio, angulo);
    angulo += barrido;
    if (barrido >= 359.99) return [{ punto, indice, completo: true, d: "" }];
    const fin = puntoPolar(centro, radio, angulo);
    return [{
      punto,
      indice,
      completo: false,
      d: `M ${centro} ${centro} L ${inicio[0]} ${inicio[1]} A ${radio} ${radio} 0 ${barrido > 180 ? 1 : 0} 1 ${fin[0]} ${fin[1]} Z`,
    }];
  });
  const esDona = datos.type === "donut";

  return (
    <div className={`tl-grafico-circular${esDona ? " is-dona" : ""}`}>
      <svg viewBox="0 0 160 160" role="img" aria-label={`${datos.title}; total ${valorConUnidad(total, datos.unit)}`}>
        <title>{datos.title}</title>
        {segmentos.map(({ punto, indice, completo, d }) => completo
          ? <circle key={`${punto.label}-${indice}`} className={`tl-grafico-segmento c${indice % 6}`} cx={centro} cy={centro} r={radio} />
          : <path key={`${punto.label}-${indice}`} className={`tl-grafico-segmento c${indice % 6}`} d={d} />)}
        {esDona && <><circle className="tl-grafico-centro" cx={centro} cy={centro} r="43" /><text className="tl-grafico-total" x={centro} y={centro - 1} textAnchor="middle">{numero(total)}</text><text className="tl-grafico-total-etiqueta" x={centro} y={centro + 16} textAnchor="middle">{datos.unit || "total"}</text></>}
      </svg>
      <ul className="tl-grafico-leyenda" aria-label="Valores del gráfico">
        {datos.data.map((punto, indice) => <li key={`${punto.label}-${indice}`}><span className={`tl-grafico-muestra c${indice % 6}`} aria-hidden="true" /><span>{punto.label}</span><strong>{valorConUnidad(punto.value, datos.unit)} <small>{((punto.value / total) * 100).toFixed(1)}%</small></strong></li>)}
      </ul>
    </div>
  );
}

function graficoBarras(datos: DatosGraficoChat) {
  const minimo = Math.min(0, ...datos.data.map((punto) => punto.value));
  const maximo = Math.max(0, ...datos.data.map((punto) => punto.value));
  const rango = maximo - minimo || 1;
  const cero = (-minimo / rango) * 100;
  return (
    <ul className="tl-grafico-barras" aria-label={datos.title}>
      {datos.data.map((punto, indice) => (
        <li key={`${punto.label}-${indice}`}>
          <span className="tl-grafico-etiqueta" title={punto.label}>{punto.label}</span>
          <span className="tl-grafico-pista" aria-hidden="true">
            <span className="tl-grafico-cero" style={{ left: `${cero}%` }} />
            <span className="tl-grafico-barra" style={{ left: `${Math.min(cero, ((punto.value - minimo) / rango) * 100)}%`, width: `${Math.abs(punto.value / rango) * 100}%` }} />
          </span>
          <strong>{valorConUnidad(punto.value, datos.unit)}</strong>
        </li>
      ))}
    </ul>
  );
}

function contenidoGrafico(datos: DatosGraficoChat) {
  if (datos.type === "bar") return graficoBarras(datos);
  if (datos.type === "line") return graficoLinea(datos);
  if (datos.type === "pie" || datos.type === "donut") return graficoCircular(datos);
  return <ul className="tl-grafico-estadisticas">{datos.data.map((punto, indice) => <li key={`${punto.label}-${indice}`}><span>{punto.label}</span><strong>{valorConUnidad(punto.value, datos.unit)}</strong>{punto.detail && <small>{punto.detail}</small>}</li>)}</ul>;
}

export function GraficoChat({ datos }: { datos: DatosGraficoChat }) {
  return (
    <figure className="tl-grafico-chat">
      <figcaption>{datos.title}</figcaption>
      {contenidoGrafico(datos)}
      <details className="tl-grafico-datos">
        <summary>Ver datos exactos</summary>
        <table>
          <thead><tr><th scope="col">Categoría</th><th scope="col">Valor</th>{datos.data.some((punto) => punto.detail) && <th scope="col">Detalle</th>}</tr></thead>
          <tbody>{datos.data.map((punto, indice) => <tr key={`${punto.label}-${indice}`}><th scope="row">{punto.label}</th><td>{valorConUnidad(punto.value, datos.unit)}</td>{datos.data.some((fila) => fila.detail) && <td>{punto.detail ?? "—"}</td>}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
