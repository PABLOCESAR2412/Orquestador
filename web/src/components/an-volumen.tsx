import { useLayoutEffect, useRef, useState } from "react";
import { niceMax } from "./charts";

// Barras de llamadas por día, hechas a mano con SVG como el resto de gráficas.
// El día actual (último punto) va en --ink y los demás días en --bar.
// Mide su ancho real para que el texto no se encoja en móvil.

const ALTO = 220;
const PAD = { top: 30, right: 4, bottom: 30, left: 4 };
const RADIO = 4;
const ANCHO_MAX_BARRA = 44;

type ModeloDia = { model: string; provider: string; calls: number; tokens: number; estimados: number };
type DiaLlamadas = { day: string; calls: number; tokens?: number; tokensEstimados?: number; modelos?: ModeloDia[] };

function diaSemana(day: string): string {
  const texto = new Date(`${day}T12:00:00Z`).toLocaleDateString("es", { weekday: "short", timeZone: "UTC" });
  const limpio = texto.replace(".", "");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export function diaCompleto(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "UTC" });
}

// Barra con esquina redondeada solo arriba; la base queda recta sobre el eje.
function barra(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIO, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// Qué días llevan etiqueta: con 7 días, todos (día de la semana); con más, uno de cada varios
// (número del día). El día actual siempre tiene etiqueta.
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

export function VolumenLlamadas({ data, titulo }: { data: DiaLlamadas[]; titulo: string }) {
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
  const max = niceMax(Math.max(0, ...data.map((d) => d.calls)));
  const innerW = ancho - PAD.left - PAD.right;
  const innerH = ALTO - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;
  const slot = n ? innerW / n : innerW;
  const anchoBarra = Math.min(ANCHO_MAX_BARRA, Math.max(3, slot * 0.56));
  const etiquetados = indicesEtiquetados(n);
  const vacio = data.every((d) => d.calls === 0);
  const hoy = n - 1;
  const diaDetalle = detalle ? data.find((d) => d.day === detalle.day) : null;
  const tooltipX = detalle ? Math.max(8, Math.min(detalle.x, ancho - 288)) : 0;
  const tooltipY = detalle ? Math.max(8, Math.min(detalle.y, ALTO - 148)) : 0;

  const mostrarDetalle = (day: string, x: number, y: number) => setDetalle({ day, x, y });

  return (
    <div className="an-grafica" ref={ref}>
      <svg width={ancho} height={ALTO} viewBox={`0 0 ${ancho} ${ALTO}`} role="group" aria-label={titulo}>
        <line className="an-eje" x1={PAD.left} x2={ancho - PAD.right} y1={base} y2={base} />

        {data.map((d, i) => {
          const x = PAD.left + i * slot + (slot - anchoBarra) / 2;
          const h = (d.calls / max) * innerH;
          const esHoy = i === hoy;
          const seleccionado = detalle?.day === d.day;
          return (
            <g
              key={d.day}
              className={seleccionado ? "an-barra-grupo is-activo" : "an-barra-grupo"}
              role="img"
              aria-label={`${diaCompleto(d.day)}: ${d.calls} ${d.calls === 1 ? "llamada" : "llamadas"}, ${d.tokens ?? 0} tokens`}
              tabIndex={d.calls > 0 ? 0 : -1}
              onPointerEnter={(event) => mostrarDetalle(d.day, event.clientX - ref.current!.getBoundingClientRect().left, event.clientY - ref.current!.getBoundingClientRect().top)}
              onPointerMove={(event) => mostrarDetalle(d.day, event.clientX - ref.current!.getBoundingClientRect().left, event.clientY - ref.current!.getBoundingClientRect().top)}
              onPointerLeave={() => setDetalle(null)}
              onFocus={() => mostrarDetalle(d.day, x + anchoBarra / 2, Math.max(PAD.top, base - h))}
              onBlur={() => setDetalle(null)}
            >
              <title>{`${diaCompleto(d.day)}: ${d.calls} ${d.calls === 1 ? "llamada" : "llamadas"}`}</title>
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
                  {n <= 7 ? diaSemana(d.day) : String(Number(d.day.slice(8, 10)))}
                </text>
              )}
            </g>
          );
        })}

        {vacio && (
          <text className="an-vacio" x={ancho / 2} y={PAD.top + innerH / 2} textAnchor="middle">
            Sin llamadas en este periodo
          </text>
        )}
      </svg>
      {diaDetalle && (
        <div className="an-tooltip-dia" role="tooltip" style={{ left: tooltipX, top: tooltipY }}>
          <strong>{diaCompleto(diaDetalle.day)}</strong>
          <div className="an-tooltip-total"><span>Llamadas</span><b>{diaDetalle.calls}</b></div>
          <div className="an-tooltip-total"><span>Tokens procesados</span><b>{new Intl.NumberFormat("es").format(diaDetalle.tokens ?? 0)}</b></div>
          {diaDetalle.tokensEstimados ? <small>{diaDetalle.tokensEstimados} registros con tokens estimados</small> : null}
          {diaDetalle.modelos && diaDetalle.modelos.length > 0 && (
            <ul>
              {[...diaDetalle.modelos].sort((a, b) => b.tokens - a.tokens).slice(0, 5).map((modelo) => (
                <li key={`${modelo.provider}/${modelo.model}`}>
                  <span>{modelo.provider} · {modelo.model}</span>
                  <b>{new Intl.NumberFormat("es").format(modelo.tokens)} tok · {modelo.calls} {modelo.calls === 1 ? "llamada" : "llamadas"}</b>
                </li>
              ))}
              {diaDetalle.modelos.length > 5 && <li className="an-tooltip-mas">y {diaDetalle.modelos.length - 5} modelos más</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
