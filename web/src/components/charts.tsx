import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

// Gráficas hechas a mano con SVG. Reglas de la guía de dataviz:
// una sola serie (un color), barras de 20 px como máximo con esquina redondeada
// solo arriba, separación de 6 px entre barras, líneas de 1 px, texto en tokens
// de texto y no en el color de la serie, y tabla alternativa en la página.

const HEIGHT = 220;
const PAD = { top: 14, right: 8, bottom: 30, left: 56 };
const RADIUS = 4;
const MAX_BAR = 20;

// Redondea el máximo a 1, 2, 5 o 10 por potencia de diez, para ticks limpios.
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * base >= value) return step * base;
  }
  return 10 * base;
}

export const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "short", timeZone: "UTC" });

// Mide el ancho real del contenedor, para que el texto del SVG no se encoja en móvil.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

// Barra con esquina redondeada solo arriba; la base queda recta sobre el eje.
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

type DayPoint = { day: string; cost: number; tokens: number; calls: number };

export function DailyBars({
  data,
  formatValue,
  title,
}: {
  data: DayPoint[];
  formatValue: (n: number) => string;
  title: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const max = niceMax(Math.max(0, ...data.map((d) => d.cost)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;
  const slot = data.length ? innerW / data.length : innerW;
  const barW = Math.min(MAX_BAR, Math.max(3, slot - 6));
  const yOf = (v: number) => base - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const empty = data.every((d) => d.cost === 0);

  const move = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!data.length) return;
    if (e.key === "ArrowRight") setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? data.length) - 1));
    if (e.key === "Escape") setHover(null);
  };

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={title}
        tabIndex={0}
        onKeyDown={move}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className={t === 0 ? "chart-axis" : "chart-grid"} x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} />
            <text className="chart-tick" x={PAD.left - 8} y={yOf(t) + 4} textAnchor="end">
              {formatValue(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = (d.cost / max) * innerH;
          const isHover = hover === i;
          return (
            <g key={d.day}>
              {h > 0 && <path className={`chart-bar${isHover ? " is-hover" : ""}`} d={barPath(x, yOf(d.cost), barW, h)} />}
              <rect
                className="chart-hit"
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={innerH}
                onMouseEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
              {(i % labelEvery === 0 || i === data.length - 1) && (
                <text className="chart-tick" x={x + barW / 2} y={base + 18} textAnchor="middle">
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}

        {empty && (
          <text className="chart-empty" x={width / 2} y={PAD.top + innerH / 2} textAnchor="middle">
            Sin uso en este periodo
          </text>
        )}
      </svg>

      {hovered && hover !== null && (
        <div
          className="chart-tooltip"
          style={{ left: PAD.left + hover * slot + slot / 2, top: PAD.top + (1 - hovered.cost / max) * innerH }}
          role="status"
        >
          <span className="tooltip-day">{shortDay(hovered.day)}</span>
          <strong>{formatValue(hovered.cost)}</strong>
          <span className="tooltip-meta">
            {hovered.calls} llamadas · {compact(hovered.tokens)} tokens
          </span>
        </div>
      )}
    </div>
  );
}

// Barras horizontales por modelo: una sola serie, sin leyenda. Si todos los
// modelos son gratis, la longitud usa tokens y lo dice explícitamente.
export function ModelBars({
  rows,
  formatValue,
}: {
  rows: { model: string; cost: number; tokens: number; calls: number }[];
  formatValue: (n: number) => string;
}) {
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const byCost = totalCost > 0;
  const metric = (r: (typeof rows)[number]) => (byCost ? r.cost : r.tokens);
  const max = Math.max(0, ...rows.map(metric)) || 1;

  if (rows.length === 0) return <p className="muted-note">Todavía no hay uso en este periodo.</p>;

  return (
    <>
      <ul className="hbars">
        {rows.map((r) => (
          <li key={r.model} className="hrow">
            <span className="hrow-name" title={r.model}>
              {r.model}
            </span>
            <span className="hrow-track" aria-hidden="true">
              <span className="hrow-fill" style={{ width: `${(metric(r) / max) * 100}%` }} />
            </span>
            <span className="hrow-value">
              {byCost ? formatValue(r.cost) : `${compact(r.tokens)} tokens`}
              <span className="muted-note"> · {r.calls}</span>
            </span>
          </li>
        ))}
      </ul>
      {!byCost && <p className="muted-note">Los modelos usados son gratuitos, así que la barra mide tokens.</p>}
    </>
  );
}

export function compact(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)} k`;
  return String(n);
}
