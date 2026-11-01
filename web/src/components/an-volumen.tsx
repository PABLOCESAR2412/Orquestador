import { useLayoutEffect, useRef, useState } from "react";
import type { AnalyticsVolume } from "../api";
import { niceMax } from "./charts";

// Barras por intervalo, hechas a mano con SVG como el resto de gráficas.
// El último punto va en --ink y los anteriores en --bar.
// Mide su ancho real para que el texto no se encoja en móvil.

const ALTO = 220;
const PAD = { top: 30, right: 4, bottom: 30, left: 4 };
const RADIO = 4;
const ANCHO_MAX_BARRA = 44;

type PuntoLlamadas = AnalyticsVolume["puntos"][number];
type Intervalo = AnalyticsVolume["intervalo"];

export function fechaPunto(at: string, intervalo: Intervalo, completa = false): string {
  const esDia = intervalo === "dia";
  const fecha = new Date(esDia ? `${at}T12:00:00Z` : `${at.replace(" ", "T")}Z`);
  if (esDia) return fecha.toLocaleDateString("es-EC", completa
    ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
  return fecha.toLocaleString("es-EC", completa
    ? { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
    : intervalo === "hora"
      ? { day: "numeric", month: "short", hour: "2-digit", timeZone: "UTC" }
      : { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

// Barra con esquina redondeada solo arriba; la base queda recta sobre el eje.
function barra(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIO, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// Mantiene etiquetas legibles aun cuando el rango contiene cientos de intervalos.
function indicesEtiquetados(n: number): Set<number> {
  const paso = n <= 7 ? 1 : Math.ceil(n / 8);
  const indices = new Set<number>();
  for (let i = 0; i < n; i += paso) indices.add(i);
  if (n > 0) {
    const hoy = n - 1;
    const ultimo = [...indices].at(-1) ?? 0;
    // Si el último día con etiqueta queda demasiado cerca de hoy, se cambia por hoy.
    if (hoy - ultimo < paso * 0.6) indices.delete(ultimo);
    indices.add(hoy);
  }
  return indices;
}

export function VolumenLlamadas({ data, titulo, intervalo, puntoSeleccionado, onSeleccionPunto }: { data: PuntoLlamadas[]; titulo: string; intervalo: Intervalo; puntoSeleccionado?: string | null; onSeleccionPunto?: (at: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(640);
  const [detalle, setDetalle] = useState<{ day: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entrada]) => setAncho(Math.max(280, Math.round(entrada.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.length;
  const anchoSvg = Math.max(ancho, n > 120 ? n * 6 : ancho);
  const max = niceMax(Math.max(0, ...data.map((d) => d.calls)));
  const innerW = anchoSvg - PAD.left - PAD.right;
  const innerH = ALTO - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;
  const slot = n ? innerW / n : innerW;
  const anchoBarra = Math.min(ANCHO_MAX_BARRA, Math.max(3, slot * 0.56));
  const etiquetados = indicesEtiquetados(n);
  const vacio = data.every((d) => d.calls === 0);
  const hoy = n - 1;
  const diaDetalle = detalle ? data.find((d) => d.at === detalle.day) : null;
  const tooltipX = detalle ? Math.max(8, Math.min(detalle.x, ancho - 268)) : 0;
  const tooltipY = detalle ? Math.max(8, Math.min(detalle.y, ALTO - 174)) : 0;

  const mostrarDetalle = (day: string, x: number, y: number) => setDetalle({ day, x, y });

  return (
    <div className="an-grafica" ref={ref}>
      <div className="an-grafica-scroll">
      <svg width={anchoSvg} height={ALTO} viewBox={`0 0 ${anchoSvg} ${ALTO}`} role="group" aria-label={titulo}>
        <line className="an-eje" x1={PAD.left} x2={anchoSvg - PAD.right} y1={base} y2={base} />

        {data.map((d, i) => {
          const x = PAD.left + i * slot + (slot - anchoBarra) / 2;
          const h = (d.calls / max) * innerH;
          const esHoy = i === hoy;
          const seleccionado = detalle?.day === d.at;
          return (
            <g
              key={d.at}
              className={seleccionado || puntoSeleccionado === d.at ? "an-barra-grupo is-activo" : "an-barra-grupo"}
              role="button"
              aria-label={`${fechaPunto(d.at, intervalo, true)}: ${d.calls} ${d.calls === 1 ? "petición" : "peticiones"}, ${d.tokens.toLocaleString("es-EC")} tokens`}
              aria-pressed={puntoSeleccionado === d.at}
              tabIndex={0}
              onPointerEnter={(event) => mostrarDetalle(d.at, event.clientX - ref.current!.getBoundingClientRect().left, event.clientY - ref.current!.getBoundingClientRect().top)}
              onPointerMove={(event) => mostrarDetalle(d.at, event.clientX - ref.current!.getBoundingClientRect().left, event.clientY - ref.current!.getBoundingClientRect().top)}
              onPointerLeave={() => setDetalle(null)}
              onClick={() => onSeleccionPunto?.(d.at)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSeleccionPunto?.(d.at);
                }
              }}
              onFocus={(event) => {
                const caja = event.currentTarget.getBoundingClientRect();
                const grafica = ref.current!.getBoundingClientRect();
                mostrarDetalle(d.at, caja.left + caja.width / 2 - grafica.left, caja.top - grafica.top);
              }}
              onBlur={() => setDetalle(null)}
            >
              <title>{`${fechaPunto(d.at, intervalo, true)}: ${d.calls} ${d.calls === 1 ? "petición" : "peticiones"}`}</title>
              {h > 0 && <path className={esHoy ? "an-barra is-hoy" : "an-barra"} d={barra(x, base - h, anchoBarra, h)} />}
              {esHoy && d.calls > 0 && (
                <text className="an-valor-hoy" x={x + anchoBarra / 2} y={base - h - 8} textAnchor="middle">
                  {d.calls}
                </text>
              )}
              {etiquetados.has(i) && (
                <text
                  className={esHoy ? "an-etiqueta is-hoy" : "an-etiqueta"}
                  x={x + anchoBarra / 2}
                  y={base + 19}
                  textAnchor="middle"
                >
                  {fechaPunto(d.at, intervalo)}
                </text>
              )}
            </g>
          );
        })}

        {vacio && (
          <text className="an-vacio" x={ancho / 2} y={PAD.top + innerH / 2} textAnchor="middle">
            Sin peticiones en este periodo
          </text>
        )}
      </svg>
      </div>
      {diaDetalle && (
        <div className="an-tooltip-dia" role="tooltip" style={{ left: tooltipX, top: tooltipY }}>
          <strong>{fechaPunto(diaDetalle.at, intervalo, true)}</strong>
          <div className="an-tooltip-total"><span>Peticiones</span><b>{diaDetalle.calls}</b></div>
          <div className="an-tooltip-total"><span>Tokens</span><b>{diaDetalle.tokens.toLocaleString("es-EC")}</b></div>
          {diaDetalle.modelos.length > 0 && (
            <ul>
              {[...diaDetalle.modelos].sort((a, b) => b.calls - a.calls).slice(0, 2).map((modelo) => (
                <li key={`${modelo.provider}/${modelo.model}`}>
                  <span title={`${modelo.provider} · ${modelo.model}`}>{modelo.model}</span>
                  <b>{modelo.tokens.toLocaleString("es-EC")} tok · {modelo.calls} {modelo.calls === 1 ? "petición" : "peticiones"}</b>
                </li>
              ))}
              {diaDetalle.modelos.length > 2 && <li className="an-tooltip-mas">{diaDetalle.modelos.length - 2} más · ver detalle abajo</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
