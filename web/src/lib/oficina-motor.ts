// Motor de la oficina: lógica pura (sin DOM) que decide dónde está cada personaje y cómo llega.
// Todo es determinista (semilla = id del chat) y sin LLM: el estado sale de los datos que la app ya tiene.
import {
  ESCRITORIOS, escritorios, asientosMesa, colaGerente, esperaMesa, nodos, puestosDescanso, rincones,
  rutaNodos, nodoCercano, salasReunion, type Dir, type Punto, type Puesto,
} from "./oficina-mapa";

export type Pose = "camina" | "parado" | "sentado" | "teclea" | "escritorio";
export type Marca = "aprobacion" | "error" | null;
export type EstadoEntrada = "trabajando" | "libre" | "aprobacion";

/** Un chat (supervisor) o un subagente, tal como lo ve la oficina. */
export type Entrada = {
  id: string;
  titulo: string;
  /** Id del chat supervisor si es un subagente. */
  padre?: string | null;
  estado: EstadoEntrada;
  /** Está en modo plan: el supervisor planifica con su equipo en una sala de reuniones. */
  planificando?: boolean;
  /** Último paso de actividad (burbuja). */
  actividad?: string | null;
  error?: boolean;
  /** Orden de prioridad para repartir escritorios (más reciente = mayor). */
  reciente: number;
};

type Destino = Puesto & { pose: Pose; clave: string; charla?: boolean };

export type Actor = {
  id: string;
  personaje: string;
  titulo: string;
  padre: string | null;
  x: number; y: number;
  dir: Dir;
  pose: Pose;
  /** Puntos que faltan para llegar. */
  ruta: Punto[];
  destino: Destino | null;
  escritorio: number | null;
  marca: Marca;
  burbuja: string | null;
  velocidad: number;
  /** Fase de ocio de los libres: sentado en su escritorio o de paseo. */
  fase: "escritorio" | "paseo";
  hasta: number;
  ciclo: number;
  llegado: boolean;
  semilla: number;
  estado: EstadoEntrada;
  /** Grupo en el que está ahora: reunión, mesa o ninguno. */
  lugar: "escritorio" | "reunion" | "mesa" | "cola" | "ocio";
};

export const PERSONAJES = ["ana", "carla", "diego", "javier", "luis", "sofia"] as const;
export const DURACION_REUNION_S = 8;      // convención visual: una delegación nueva pasa por la sala antes de la mesa
const ORDEN_MESA = [4, 5, 6, 7, 0, 1, 2, 3];   // primero los asientos de abajo (de espaldas, tecleando)
const VELOCIDAD = 80;                       // px del plano por segundo

// ── Utilidades deterministas ─────────────────────────────────────────────────────────────────
export function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const entre = (r: () => number, a: number, b: number) => a + (b - a) * r();

export function dirDe(dx: number, dy: number, actual: Dir): Dir {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return actual;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "frente" : "espalda";
  return dx > 0 ? "derecha" : "izquierda";
}

/** Reparte escritorios de forma estable: conserva los ya asignados y rellena los libres por prioridad. */
export function asignarEscritorios(previo: Map<string, number>, principales: Pick<Entrada, "id" | "estado" | "reciente">[]): Map<string, number> {
  const orden = [...principales].sort((a, b) =>
    Number(b.estado !== "libre") - Number(a.estado !== "libre") || b.reciente - a.reciente || (a.id < b.id ? -1 : 1));
  const elegidos = orden.slice(0, ESCRITORIOS);
  const ids = new Set(elegidos.map((e) => e.id));
  const res = new Map<string, number>();
  const usados = new Set<number>();
  for (const [id, d] of previo) if (ids.has(id) && !usados.has(d)) { res.set(id, d); usados.add(d); }
  let libre = 0;
  for (const e of elegidos) {
    if (res.has(e.id)) continue;
    while (usados.has(libre)) libre++;
    res.set(e.id, libre); usados.add(libre);
  }
  return res;
}

export class MotorOficina {
  actores = new Map<string, Actor>();
  /** Escritorios con el monitor encendido (alguien trabajando ahí). */
  encendidos = new Set<number>();
  /** Escritorios asignados: id del chat → índice. */
  escritorioDe = new Map<string, number>();
  /** Chats principales sin escritorio (más de 30 conversaciones). */
  sinEscritorio = 0;

  private reservas = new Map<string, string>();      // clave de puesto → id del actor
  private t = 0;
  private iniciado = false;
  private hijosVistos = new Set<string>();
  private reunionHasta = new Map<string, number>();  // supervisor → instante en que termina la reunión de delegación
  private salaDe = new Map<string, number>();        // supervisor → sala de reuniones asignada
  private entradas: Entrada[] = [];

  constructor(private semilla = 0) {}

  get ahora() { return this.t; }

  // ── Sincronización con los datos ──────────────────────────────────────────────────────────
  /** `salto`: coloca a todos directamente en su destino (carga inicial o regreso a la pestaña). */
  sincronizar(entradas: Entrada[], salto = false) {
    this.entradas = entradas;
    const primera = !this.iniciado;
    const snap = salto || primera;
    const principales = entradas.filter((e) => !e.padre);
    const hijos = entradas.filter((e) => e.padre);
    const existentes = new Set(entradas.map((e) => e.id));

    // Altas y bajas
    for (const id of [...this.actores.keys()]) if (!existentes.has(id)) this.quitar(id);
    this.escritorioDe = asignarEscritorios(this.escritorioDe, principales);
    this.sinEscritorio = principales.length - this.escritorioDe.size;
    for (const e of entradas) {
      if (e.padre === undefined || e.padre === null) {
        if (!this.escritorioDe.has(e.id)) { this.quitar(e.id); continue; }   // sin escritorio: no se dibuja
      }
      if (!this.actores.has(e.id)) this.crear(e);
      const a = this.actores.get(e.id)!;
      a.titulo = e.titulo; a.estado = e.estado; a.padre = e.padre ?? null;
      a.escritorio = this.escritorioDe.get(e.id) ?? null;
      a.marca = e.error ? "error" : e.estado === "aprobacion" ? "aprobacion" : null;
      a.burbuja = e.estado === "trabajando" ? (e.actividad ?? null) : null;
    }

    // Delegaciones nuevas: un subagente que aparece trabajando mientras la pantalla está abierta
    for (const h of hijos) {
      if (!this.hijosVistos.has(h.id)) {
        this.hijosVistos.add(h.id);
        if (!primera && h.padre) this.reunionHasta.set(h.padre, this.t + DURACION_REUNION_S);
      }
    }

    // Liberar reservas de quien ya no existe y recalcular destinos
    for (const [clave, id] of this.reservas) if (!this.actores.has(id)) this.reservas.delete(clave);
    this.repartir(snap);
    this.iniciado = true;
  }

  private crear(e: Entrada) {
    const h = hash(e.id) ^ this.semilla;
    const a: Actor = {
      id: e.id, personaje: PERSONAJES[hash(e.id) % PERSONAJES.length], titulo: e.titulo, padre: e.padre ?? null,
      x: 604, y: 1480, dir: "frente", pose: "parado", ruta: [], destino: null, escritorio: null, marca: null, burbuja: null,
      velocidad: VELOCIDAD * (0.9 + (h % 21) / 100), fase: "escritorio", hasta: 0, ciclo: 0, llegado: true,
      semilla: h, estado: e.estado, lugar: "escritorio",
    };
    this.actores.set(e.id, a);
  }

  private quitar(id: string) {
    this.actores.delete(id);
    for (const [clave, quien] of this.reservas) if (quien === id) this.reservas.delete(clave);
    this.salaDe.delete(id); this.reunionHasta.delete(id);
  }

  // ── Reparto de lugares ───────────────────────────────────────────────────────────────────
  private libre(clave: string, id: string) { const q = this.reservas.get(clave); return q === undefined || q === id; }
  private reservar(clave: string, id: string) { this.reservas.set(clave, id); }
  private soltarTodo(id: string) { for (const [c, q] of this.reservas) if (q === id) this.reservas.delete(c); }
  private soltar(id: string, prefijo: string) { for (const [c, q] of this.reservas) if (q === id && c.startsWith(prefijo)) this.reservas.delete(c); }

  private repartir(snap: boolean) {
    const trabajando = this.entradas.filter((e) => !e.padre && e.estado === "trabajando" && this.actores.has(e.id));
    const hijosPorPadre = new Map<string, Entrada[]>();
    for (const h of this.entradas.filter((e) => e.padre)) {
      if (!this.actores.has(h.id)) continue;
      (hijosPorPadre.get(h.padre!) ?? hijosPorPadre.set(h.padre!, []).get(h.padre!)!).push(h);
    }
    const asignados = new Set<string>();   // actores que ya recibieron destino en este reparto
    this.encendidos.clear();

    // Quien deja de trabajar libera su sala y sus asientos de equipo
    for (const [padre] of this.salaDe) {
      const e = this.entradas.find((x) => x.id === padre);
      if (!e || e.estado !== "trabajando") this.salaDe.delete(padre);
    }

    for (const sup of trabajando) {
      const a = this.actores.get(sup.id); if (!a) continue;
      const equipo = (hijosPorPadre.get(sup.id) ?? []).filter((h) => h.estado === "trabajando");
      const reunion = (this.reunionHasta.get(sup.id) ?? 0) > this.t || sup.planificando;
      const grupo = [sup, ...equipo];
      if (reunion) {
        this.enSala(grupo, snap, asignados);
      } else if (equipo.length) {
        this.salaDe.delete(sup.id);
        this.enMesa(grupo, snap, asignados);
      } else {
        this.salaDe.delete(sup.id);
        this.alEscritorio(a, "teclea", snap); asignados.add(a.id);
      }
    }

    // Quien espera aprobación hace fila frente al gerente
    for (const e of this.entradas.filter((x) => !x.padre && x.estado === "aprobacion")) {
      const a = this.actores.get(e.id); if (!a) continue;
      this.soltar(a.id, "sala:"); this.soltar(a.id, "mesa:"); this.soltar(a.id, "ocio:");
      const p = colaGerente.find((c, i) => this.libre(`cola:${i}`, a.id));
      if (!p) { this.alEscritorio(a, "escritorio", snap); asignados.add(a.id); continue; }
      const i = colaGerente.indexOf(p); this.reservar(`cola:${i}`, a.id);
      this.ir(a, { ...p, pose: "parado", clave: `cola:${i}` }, snap, "cola"); asignados.add(a.id);
    }

    // Subagentes sin supervisor visible: a la mesa conjunta
    const huerfanos = this.entradas.filter((e) => e.padre && !asignados.has(e.id) && e.estado === "trabajando"
      && !trabajando.some((s) => s.id === e.padre));
    if (huerfanos.length) this.enMesa(huerfanos, snap, asignados);

    // Los demás: ocio
    for (const e of this.entradas) {
      if (asignados.has(e.id)) continue;
      const a = this.actores.get(e.id); if (!a) continue;
      if (e.padre) { this.quitar(e.id); continue; }   // un subagente que terminó se va de la oficina
      const veniaDeOcio = a.lugar === "ocio" || (a.lugar === "escritorio" && a.destino?.pose === "escritorio");
      if (!veniaDeOcio) {   // venía de trabajar, de una reunión o de la cola: reinicia su ciclo de ocio
        this.soltar(a.id, "sala:"); this.soltar(a.id, "mesa:"); this.soltar(a.id, "cola:");
        a.destino = null; a.fase = "escritorio"; a.hasta = 0;
      }
      if (!a.destino) this.siguienteOcio(a, snap);
    }
    if (snap) for (const a of this.actores.values()) this.llegar(a);
    this.recalcularEncendidos();
  }

  private recalcularEncendidos() {
    this.encendidos.clear();
    for (const a of this.actores.values()) {
      if (a.escritorio !== null && a.pose === "teclea" && a.destino?.clave === `esc:${a.escritorio}` && a.llegado) this.encendidos.add(a.escritorio);
    }
  }

  private alEscritorio(a: Actor, pose: "teclea" | "escritorio", snap: boolean) {
    this.soltar(a.id, "sala:"); this.soltar(a.id, "mesa:"); this.soltar(a.id, "cola:"); this.soltar(a.id, "ocio:");
    if (a.escritorio === null) return;
    const e = escritorios[a.escritorio];
    if (a.destino?.clave === `esc:${a.escritorio}` && a.destino.pose === pose) return;
    this.ir(a, { x: e.asiento.x, y: e.asiento.y, dir: "espalda", nodo: e.nodo, pose, clave: `esc:${a.escritorio}` }, snap, "escritorio");
  }

  private asientosLibres(lista: Puesto[], prefijo: string, id: string) {
    return lista.map((p, i) => ({ p, clave: `${prefijo}:${i}` })).filter(({ clave }) => this.libre(clave, id));
  }

  private enSala(grupo: Entrada[], snap: boolean, asignados: Set<string>) {
    const sup = grupo[0];
    let idx = this.salaDe.get(sup.id);
    if (idx === undefined || salasReunion[idx] === undefined) {
      // Una sala sin otro supervisor; si todas están usadas, la que tenga más asientos libres
      const usadas = new Set(this.salaDe.values());
      const vacia = salasReunion.findIndex((_, i) => !usadas.has(i));
      idx = vacia >= 0 ? vacia : salasReunion
        .map((s, i) => ({ i, n: s.asientos.filter((_, k) => this.libre(`sala:${i}:${k}`, sup.id)).length }))
        .sort((a, b) => b.n - a.n)[0].i;
      this.salaDe.set(sup.id, idx);
    }
    const sala = salasReunion[idx];
    for (const m of grupo) {
      const a = this.actores.get(m.id); if (!a) continue;
      this.soltar(a.id, "mesa:"); this.soltar(a.id, "cola:"); this.soltar(a.id, "ocio:");
      const actual = a.destino?.clave.startsWith(`sala:${idx}:`) ? a.destino.clave : null;
      const k = actual ? Number(actual.split(":")[2]) : sala.asientos.findIndex((_, j) => this.libre(`sala:${idx}:${j}`, a.id));
      if (k < 0) { this.alEscritorio(a, "escritorio", snap); asignados.add(a.id); continue; }
      this.reservar(`sala:${idx}:${k}`, a.id);
      const p = sala.asientos[k];
      this.ir(a, { ...p, pose: "sentado", clave: `sala:${idx}:${k}` }, snap, "reunion");
      asignados.add(a.id);
    }
  }

  private enMesa(grupo: Entrada[], snap: boolean, asignados: Set<string>) {
    for (const m of grupo) {
      const a = this.actores.get(m.id); if (!a) continue;
      this.soltar(a.id, "sala:"); this.soltar(a.id, "cola:"); this.soltar(a.id, "ocio:");
      const actual = a.destino?.clave.startsWith("mesa:") ? Number(a.destino.clave.split(":")[1]) : -1;
      const k = actual >= 0 && this.libre(`mesa:${actual}`, a.id) ? actual : ORDEN_MESA.find((j) => this.libre(`mesa:${j}`, a.id)) ?? -1;
      if (k >= 0) {
        this.reservar(`mesa:${k}`, a.id);
        const p = asientosMesa[k];
        // Arriba se ve de frente (sin teclear: el monitor mira hacia ellos); abajo de espaldas, tecleando
        this.ir(a, { ...p, pose: p.dir === "espalda" ? "teclea" : "sentado", clave: `mesa:${k}` }, snap, "mesa");
        asignados.add(a.id);
        continue;
      }
      const j = esperaMesa.findIndex((_, q) => this.libre(`mesa:e${q}`, a.id));
      if (j >= 0) {
        this.reservar(`mesa:e${j}`, a.id);
        this.ir(a, { ...esperaMesa[j], pose: "parado", clave: `mesa:e${j}` }, snap, "mesa");
      } else this.alEscritorio(a, "teclea", snap);
      asignados.add(a.id);
    }
  }

  // ── Ocio de los libres ───────────────────────────────────────────────────────────────────
  private siguienteOcio(a: Actor, snap: boolean) {
    this.soltar(a.id, "ocio:");
    const r = mulberry32(a.semilla + a.ciclo * 7919 + Math.floor(this.semilla));
    a.ciclo++;
    a.hasta = 0;
    if (a.fase === "escritorio" && a.escritorio !== null) {
      const e = escritorios[a.escritorio];
      this.ir(a, { x: e.asiento.x, y: e.asiento.y, dir: "espalda", nodo: e.nodo, pose: "escritorio", clave: `esc:${a.escritorio}` }, snap, "escritorio");
      return;
    }
    // De paseo: un rincón o una butaca del descanso libres
    const opciones: Destino[] = [];
    rincones.forEach((p, i) => opciones.push({ ...p, pose: "parado", clave: `ocio:r${i}`, charla: p.sala === "pasillo" }));
    puestosDescanso.forEach((p, i) => opciones.push({ ...p, pose: "sentado", clave: `ocio:d${i}` }));
    const libres = opciones.filter((o) => this.libre(o.clave, a.id));
    const elegido = libres[Math.floor(r() * libres.length)];
    if (!elegido) { a.fase = "escritorio"; return; }
    this.reservar(elegido.clave, a.id);
    a.fase = "paseo";
    this.ir(a, elegido, snap, "ocio");
  }

  // ── Movimiento ───────────────────────────────────────────────────────────────────────────
  private ir(a: Actor, d: Destino, snap: boolean, lugar: Actor["lugar"]) {
    const igual = a.destino && a.destino.clave === d.clave && a.destino.pose === d.pose;
    a.lugar = lugar;
    if (igual) return;
    a.destino = d; a.llegado = false;
    if (snap || !this.iniciado || Math.hypot(a.x - d.x, a.y - d.y) < 1) { a.ruta = []; this.llegar(a); return; }
    const origen = nodoCercano({ x: a.x, y: a.y });
    const camino = rutaNodos(origen, d.nodo);
    if (!camino) { a.ruta = []; this.llegar(a); return; }
    const puntos: Punto[] = [];
    // Si está sentado o parado fuera del grafo, primero sale hasta su nodo más cercano
    puntos.push({ x: nodos[origen].x, y: nodos[origen].y });
    for (const id of camino) puntos.push({ x: nodos[id].x, y: nodos[id].y });
    puntos.push({ x: d.x, y: d.y });
    a.ruta = limpiarRuta({ x: a.x, y: a.y }, puntos);
    a.pose = "camina";
  }

  private llegar(a: Actor) {
    const d = a.destino; if (!d) return;
    a.x = d.x; a.y = d.y; a.dir = d.dir; a.pose = d.pose; a.ruta = []; a.llegado = true;
    if (a.estado === "libre" && a.hasta === 0) {   // los libres se quedan un rato y luego cambian de plan
      const r = mulberry32(a.semilla + a.ciclo * 104729 + Math.floor(this.semilla));
      a.hasta = this.t + (a.fase === "escritorio" ? entre(r, 12, 40) : entre(r, 9, 22));
    }
  }

  /** Avanza `dt` segundos. */
  avanzar(dt: number) {
    this.t += dt;
    let cambio = false;
    for (const a of this.actores.values()) {
      if (a.ruta.length) {
        let resto = a.velocidad * dt;
        while (resto > 0 && a.ruta.length) {
          const p = a.ruta[0];
          const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
          if (d <= resto) { a.x = p.x; a.y = p.y; a.ruta.shift(); resto -= d; if (d > 0.01) a.dir = dirDe(dx, dy, a.dir); }
          else { a.x += (dx / d) * resto; a.y += (dy / d) * resto; a.dir = dirDe(dx, dy, a.dir); resto = 0; }
        }
        a.pose = "camina";
        if (!a.ruta.length && a.destino) { this.llegar(a); cambio = true; }
      }
      // Ciclo de ocio
      if (a.estado === "libre" && a.llegado && a.hasta > 0 && this.t >= a.hasta) {
        a.fase = a.fase === "escritorio" ? "paseo" : "escritorio";
        a.hasta = 0; a.llegado = false;
        this.siguienteOcio(a, false);
        cambio = true;
      }
    }
    // La reunión de una delegación nueva termina sola
    for (const [padre, hasta] of this.reunionHasta) {
      if (hasta <= this.t) { this.reunionHasta.delete(padre); this.repartir(false); cambio = true; }
    }
    if (cambio) this.recalcularEncendidos();
  }
}

/** Quita puntos repetidos y los que ya están donde está el actor. */
function limpiarRuta(inicio: Punto, puntos: Punto[]): Punto[] {
  const res: Punto[] = [];
  let previo = inicio;
  for (const p of puntos) {
    if (Math.hypot(p.x - previo.x, p.y - previo.y) < 0.5) continue;
    res.push(p); previo = p;
  }
  return res;
}
