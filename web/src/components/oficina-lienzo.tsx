import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import manifiesto from "../lib/oficina-manifiesto.json";
import { ESCRITORIO, MESA, MESA_POS, NOMBRES_SALAS, PLANO, escritorios, nodos } from "../lib/oficina-mapa";
import { MotorOficina, type Actor, type Entrada } from "../lib/oficina-motor";

const E = manifiesto.escala_atlas;
const C = manifiesto.caminar;
const T = manifiesto.trabajar;
const COLUMNA_DIR = { frente: 0, espalda: 1, derecha: 2, izquierda: 3 } as const;
const ZOOM_MAX = 2.5;
const ZOOM_CERCA = 0.85;   // desde aquí se muestran todas las etiquetas
const FPS = 30;

type Vista = { x: number; y: number; z: number };
export type OficinaLienzoHandle = { enfocar: (id: string) => void };
type Props = {
  entradas: Entrada[];
  seleccion: string | null;
  onSeleccion: (id: string) => void;
  calibrar?: boolean;
};

// Imagen y recorte del cuadro que corresponde a cada pose (en píxeles del plano)
function cuadro(a: Actor, t: number) {
  const base = { ancho: C.celda[0] / E, atlas: `/oficina/${a.personaje}-caminar.webp` };
  const tamanoC = `${(C.celda[0] * 4) / E}px ${(C.celda[1] * 4 + C.sentado.celda[1]) / E}px`;
  if (a.pose === "teclea" || a.pose === "escritorio") {
    const col = a.pose === "teclea" ? Math.floor(t * 6 + (a.semilla % 4)) % 4 : 0;
    const w = T.celda[0] / E, h = T.celda[1] / E;
    return { clave: `t${col}`, atlas: `/oficina/${a.personaje}-trabajar.webp`, w, h, ax: T.ancla[0] / E, ay: T.ancla[1] / E, tamano: `${w * 4}px ${h}px`, pos: `${-col * w}px 0px` };
  }
  if (a.pose === "sentado") {
    const col = COLUMNA_DIR[a.dir];
    const h = C.sentado.celda[1] / E;
    return { clave: `s${col}`, atlas: base.atlas, w: base.ancho, h, ax: C.sentado.ancla[0] / E, ay: C.sentado.ancla[1] / E, tamano: tamanoC, pos: `${-col * base.ancho}px ${-C.sentado.y / E}px` };
  }
  const fila = COLUMNA_DIR[a.dir];
  const col = a.pose === "camina" ? Math.floor(t * 8 + (a.semilla % 4)) % 4 : 0;
  const h = C.celda[1] / E;
  return { clave: `c${fila}${col}`, atlas: base.atlas, w: base.ancho, h, ax: C.ancla[0] / E, ay: C.ancla[1] / E, tamano: tamanoC, pos: `${-col * base.ancho}px ${-fila * h}px` };
}

// Segunda línea de la etiqueta: aprobación, error o el último paso. Si aún no llegó ningún paso, el estado.
function textoEtiqueta(a: Actor): string | null {
  if (a.marca === "aprobacion") return "Espera aprobación";
  if (a.marca === "error") return "Error";
  return a.burbuja ?? (a.estado === "trabajando" ? "En ejecución" : null);
}

function recortar(v: Vista, cw: number, ch: number, zMin: number): Vista {
  const z = Math.min(ZOOM_MAX, Math.max(zMin, v.z));
  const w = PLANO.ancho * z, h = PLANO.alto * z;
  return {
    z,
    x: w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, v.x)),
    y: h <= ch ? (ch - h) / 2 : Math.min(0, Math.max(ch - h, v.y)),
  };
}

export const OficinaLienzo = forwardRef<OficinaLienzoHandle, Props>(function OficinaLienzo({ entradas, seleccion, onSeleccion, calibrar }, ref) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mundo = useRef<HTMLDivElement>(null);
  const [motor] = useState(() => new MotorOficina());
  const elementos = useRef(new Map<string, HTMLButtonElement>());
  const escritoriosEl = useRef<(HTMLDivElement | null)[]>([]);
  const vista = useRef<Vista>({ x: 0, y: 0, z: 0.5 });
  const tamano = useRef({ w: 0, h: 0 });
  const entradasRef = useRef(entradas);
  const seleccionRef = useRef(seleccion);
  seleccionRef.current = seleccion;
  const [lista, setLista] = useState<{ id: string; titulo: string; texto: string | null }[]>([]);
  const [sinMovimiento, setSinMovimiento] = useState(false);

  const zoomMinimo = () => Math.min(tamano.current.w / PLANO.ancho, tamano.current.h / PLANO.alto) || 0.1;

  // ── Etiquetas sin encimarse ─────────────────────────────────────────────────────────────────
  // Las etiquetas miden lo mismo en pantalla sea cual sea el zoom, así que con la oficina llena se
  // montarían unas sobre otras. Cada ~250 ms (y al mover la vista) se muestran por prioridad solo las
  // que no chocan con otra: seleccionado, espera de aprobación, error, trabajando y, con zoom, el resto.
  const anclaY = useRef(new Map<string, number>());
  const ultimaEtiqueta = useRef(0);
  const visiblesEtiqueta = useRef(new Set<string>());
  const colocarEtiquetas = useCallback(() => {
    ultimaEtiqueta.current = performance.now();
    const v = vista.current, { w, h } = tamano.current;
    const cerca = v.z >= ZOOM_CERCA;
    const candidatos: { id: string; prio: number; antes: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const a of motor.actores.values()) {
      const prio = a.id === seleccionRef.current ? 0 : a.marca === "aprobacion" ? 1 : a.marca === "error" ? 2 : a.estado === "trabajando" ? 3 : cerca ? 4 : 9;
      if (prio === 9) continue;
      const texto = textoEtiqueta(a);
      const ancho = Math.min(118, Math.max(a.titulo.length * 6.4, (texto?.length ?? 0) * 5.6) + 16) + 4;
      const alto = (texto ? 32 : 19) + 4;
      const cx = a.x * v.z + v.x, base = (a.y - (anclaY.current.get(a.id) ?? 0)) * v.z + v.y - 2;
      if (cx + ancho / 2 < 0 || cx - ancho / 2 > w || base < 0 || base - alto > h) continue;   // fuera de la vista
      candidatos.push({ id: a.id, prio, antes: visiblesEtiqueta.current.has(a.id) ? 0 : 1, x0: cx - ancho / 2, x1: cx + ancho / 2, y0: base - alto, y1: base });
    }
    candidatos.sort((p, q) => p.prio - q.prio || p.antes - q.antes || (p.id < q.id ? -1 : 1));
    const puestos: typeof candidatos = [], ahora = new Set<string>();
    for (const c of candidatos) {
      if (c.prio > 0 && puestos.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0)) continue;
      puestos.push(c); ahora.add(c.id);
    }
    for (const [id, el] of elementos.current) {
      const quiere = ahora.has(id) ? "1" : "";
      if (el.dataset.etq !== quiere) el.dataset.etq = quiere;
    }
    visiblesEtiqueta.current = ahora;
  }, []);

  const aplicarVista = useCallback((nueva?: Vista) => {
    const { w, h } = tamano.current;
    if (nueva) vista.current = recortar(nueva, w, h, zoomMinimo());
    const v = vista.current;
    if (mundo.current) mundo.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`;
    const c = contenedor.current;
    if (c) {
      c.style.setProperty("--z", String(v.z));
      c.dataset.zoom = v.z >= ZOOM_CERCA ? "cerca" : "lejos";
    }
    colocarEtiquetas();
  }, [colocarEtiquetas]);

  // ── Pintado de actores y escritorios (sin pasar por React) ──────────────────────────────────
  const encendidosPrevios = useRef(new Set<number>());
  const pintar = useCallback(() => {
    const m = motor;
    for (const a of m.actores.values()) {
      const el = elementos.current.get(a.id);
      if (!el) continue;
      const c = cuadro(a, m.ahora);
      if (el.dataset.c !== `${a.personaje}${c.clave}`) {
        el.dataset.c = `${a.personaje}${c.clave}`;
        const s = el.style;
        s.width = `${c.w}px`; s.height = `${c.h}px`;
        s.backgroundImage = `url(${c.atlas})`; s.backgroundSize = c.tamano; s.backgroundPosition = c.pos;
        s.setProperty("--ax", `${c.ax}px`); s.setProperty("--ay", `${c.ay}px`);
      }
      el.style.transform = `translate3d(${(a.x - c.ax).toFixed(1)}px, ${(a.y - c.ay).toFixed(1)}px, 0)`;
      el.style.zIndex = String(Math.round(a.y));
      anclaY.current.set(a.id, c.ay);
      const marca = a.marca ?? "";
      if (el.dataset.marca !== marca) el.dataset.marca = marca;
      const activo = a.estado === "trabajando" ? "1" : "";
      if (el.dataset.activo !== activo) el.dataset.activo = activo;
    }
    if (performance.now() - ultimaEtiqueta.current > 250) colocarEtiquetas();
    const on = m.encendidos, previos = encendidosPrevios.current;
    if (on.size !== previos.size || [...on].some((i) => !previos.has(i))) {
      for (const i of previos) if (!on.has(i)) escritoriosEl.current[i]?.classList.remove("is-on");
      for (const i of on) if (!previos.has(i)) escritoriosEl.current[i]?.classList.add("is-on");
      encendidosPrevios.current = new Set(on);
    }
  }, [colocarEtiquetas]);

  const sincronizar = useCallback((salto: boolean) => {
    const m = motor;
    m.sincronizar(entradasRef.current, salto);
    setLista((previa) => {
      const nueva = [...m.actores.values()].map((a) => ({
        id: a.id, titulo: a.titulo,
        texto: textoEtiqueta(a),
      })).sort((a, b) => (a.id < b.id ? -1 : 1));
      const igual = previa.length === nueva.length && previa.every((p, i) => p.id === nueva[i].id && p.titulo === nueva[i].titulo && p.texto === nueva[i].texto);
      return igual ? previa : nueva;
    });
    pintar();
  }, [pintar]);

  // Reducción de movimiento: posiciones finales, sin caminatas ni animaciones
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const actualizar = () => setSinMovimiento(mq.matches);
    actualizar();
    mq.addEventListener("change", actualizar);
    return () => mq.removeEventListener("change", actualizar);
  }, []);

  useEffect(() => { entradasRef.current = entradas; sincronizar(sinMovimiento); }, [entradas, sinMovimiento, sincronizar]);
  useEffect(() => { colocarEtiquetas(); }, [seleccion, colocarEtiquetas]);

  // Un solo reloj para toda la oficina: ~30 fps y en pausa con la pestaña oculta
  useEffect(() => {
    if (sinMovimiento) return;
    let raf = 0, ultimo = performance.now(), acumulado = 0;
    const bucle = (ahora: number) => {
      raf = requestAnimationFrame(bucle);
      const dt = (ahora - ultimo) / 1000; ultimo = ahora;
      if (document.hidden) return;
      if (dt > 2) { sincronizar(true); return; }   // volvió de una pausa larga: cada quien en su sitio
      acumulado += dt;
      if (acumulado < 1 / FPS) return;
      motor.avanzar(Math.min(acumulado, 0.25)); acumulado = 0;
      pintar();
    };
    raf = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(raf);
  }, [sinMovimiento, sincronizar, pintar]);

  // Los elementos nuevos se pintan en cuanto existen
  useEffect(() => { pintar(); }, [lista, pintar]);

  // ── Zoom y arrastre ─────────────────────────────────────────────────────────────────────────
  const zoomEn = useCallback((factor: number, cx?: number, cy?: number) => {
    const { w, h } = tamano.current, v = vista.current;
    const px = cx ?? w / 2, py = cy ?? h / 2;
    const z = Math.min(ZOOM_MAX, Math.max(zoomMinimo(), v.z * factor));
    aplicarVista({ z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z });
  }, [aplicarVista]);

  const verTodo = useCallback(() => aplicarVista({ x: 0, y: 0, z: 0 }), [aplicarVista]);
  const vistaInicial = useCallback(() => {
    const { w } = tamano.current;
    const z = Math.max(w / PLANO.ancho, w < 700 ? 0.55 : 0);
    aplicarVista({ z, x: -700 * z + 8, y: -40 * z });   // empieza sobre el área de trabajo
  }, [aplicarVista]);

  useImperativeHandle(ref, () => ({
    enfocar(id: string) {
      const a = motor.actores.get(id);
      if (!a) return;
      const { w, h } = tamano.current;
      const z = Math.max(vista.current.z, 0.9);
      aplicarVista({ z, x: w / 2 - a.x * z, y: h / 2 - a.y * z });
    },
  }), [aplicarVista]);

  useEffect(() => {
    const c = contenedor.current; if (!c) return;
    let primera = true;
    const observador = new ResizeObserver(() => {
      tamano.current = { w: c.clientWidth, h: c.clientHeight };
      if (primera) { primera = false; vistaInicial(); } else aplicarVista(vista.current);
    });
    observador.observe(c);
    const rueda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;   // la rueda sola sigue moviendo la página
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomEn(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener("wheel", rueda, { passive: false });
    return () => { observador.disconnect(); c.removeEventListener("wheel", rueda); };
  }, [aplicarVista, vistaInicial, zoomEn]);

  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ x: number; y: number; vx: number; vy: number; moviendo: boolean } | null>(null);
  const pellizco = useRef<{ d: number; z: number; mx: number; my: number; vx: number; vy: number } | null>(null);

  const alBajar = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = vista.current;
    if (punteros.current.size === 1) gesto.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moviendo: false };
    if (punteros.current.size === 2) {
      const [p, q] = [...punteros.current.values()];
      pellizco.current = { d: Math.hypot(p.x - q.x, p.y - q.y), z: v.z, mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, vx: v.x, vy: v.y };
      gesto.current = null;
    }
  };
  const alMover = (e: React.PointerEvent) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = contenedor.current!.getBoundingClientRect();
    if (pellizco.current && punteros.current.size >= 2) {
      const [p, q] = [...punteros.current.values()];
      const k = pellizco.current, d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const z = Math.min(ZOOM_MAX, Math.max(zoomMinimo(), k.z * (d / (k.d || 1))));
      const mx = (p.x + q.x) / 2 - r.left, my = (p.y + q.y) / 2 - r.top;
      const bx = k.mx - r.left, by = k.my - r.top;
      aplicarVista({ z, x: mx - ((bx - k.vx) / k.z) * z, y: my - ((by - k.vy) / k.z) * z });
      return;
    }
    const g = gesto.current; if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moviendo && Math.hypot(dx, dy) > 6) {
      g.moviendo = true;
      try { contenedor.current!.setPointerCapture(e.pointerId); } catch { /* el arrastre sigue sin captura */ }
    }
    if (g.moviendo) aplicarVista({ ...vista.current, x: g.vx + dx, y: g.vy + dy });
  };
  const alSoltar = (e: React.PointerEvent) => {
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pellizco.current = null;
    if (punteros.current.size === 0) gesto.current = null;
  };
  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const paso = 80, v = vista.current;
    if (e.key === "+" || e.key === "=") zoomEn(1.25);
    else if (e.key === "-") zoomEn(0.8);
    else if (e.key === "0") verTodo();
    else if (e.key === "ArrowLeft") aplicarVista({ ...v, x: v.x + paso });
    else if (e.key === "ArrowRight") aplicarVista({ ...v, x: v.x - paso });
    else if (e.key === "ArrowUp") aplicarVista({ ...v, y: v.y + paso });
    else if (e.key === "ArrowDown") aplicarVista({ ...v, y: v.y - paso });
    else return;
    e.preventDefault();
  };

  return <div className="oficina-lienzo-caja">
    <div ref={contenedor} className="oficina-lienzo" role="group" aria-label="Plano de la oficina. Flechas para moverte, más y menos para acercar" tabIndex={0}
      onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} onKeyDown={alTeclear} data-zoom="lejos">
      <div ref={mundo} className="oficina-mundo" style={{ width: PLANO.ancho, height: PLANO.alto }}>
        <img className="oficina-plano-img" src={`/oficina/${PLANO.archivo}`} width={PLANO.ancho} height={PLANO.alto} alt="" draggable={false} decoding="async" />
        {escritorios.map((d, i) => <div key={d.indice} className="oficina-escritorio" ref={(el) => { escritoriosEl.current[i] = el; }}
          style={{ left: d.x, top: d.y, width: ESCRITORIO.ancho, height: ESCRITORIO.alto }}>
          <img src={`/oficina/${manifiesto.escritorio.apagado}`} alt="" draggable={false} />
          <img className="enc" src={`/oficina/${manifiesto.escritorio.encendido}`} alt="" draggable={false} />
        </div>)}
        <img className="oficina-mesa-img" src={`/oficina/${manifiesto.mesa.archivo}`} alt="" draggable={false}
          style={{ left: MESA_POS.x, top: MESA_POS.y, width: MESA.ancho, height: MESA.alto }} />
        {NOMBRES_SALAS.map((s) => <span key={s.nombre} className="oficina-sala-nombre" style={{ left: s.x, top: s.y }}>{s.nombre}</span>)}
        {calibrar && <svg className="oficina-calibrar" width={PLANO.ancho} height={PLANO.alto} aria-hidden="true">
          {Object.values(nodos).flatMap((n) => n.vecinos.map((v) => <line key={`${n.x},${n.y}-${v}`} x1={n.x} y1={n.y} x2={nodos[v].x} y2={nodos[v].y} />))}
          {Object.entries(nodos).map(([id, n]) => <circle key={id} cx={n.x} cy={n.y} r={3}><title>{id}</title></circle>)}
        </svg>}
        {lista.map((a) => <button type="button" key={a.id} ref={(el) => { if (el) elementos.current.set(a.id, el); else elementos.current.delete(a.id); }}
          className={`oficina-actor${seleccion === a.id ? " is-seleccionado" : ""}`} data-id={a.id}
          aria-label={`${a.titulo}`} aria-pressed={seleccion === a.id}
          onClick={() => onSeleccion(a.id)}>
          <span className="oficina-etiqueta"><b>{a.titulo}</b>{a.texto && <small>{a.texto}</small>}</span>
        </button>)}
      </div>
    </div>
    <div className="oficina-zoom" role="group" aria-label="Zoom del plano">
      <button type="button" onClick={() => zoomEn(1.3)} aria-label="Acercar">+</button>
      <button type="button" onClick={() => zoomEn(1 / 1.3)} aria-label="Alejar">−</button>
      <button type="button" onClick={verTodo}>Ver todo</button>
    </div>
  </div>;
});
