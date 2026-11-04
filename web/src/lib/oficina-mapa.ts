// Mapa de la oficina: todo lo que depende del plano (coordenadas en píxeles del plano, 1672 × 1590).
// El plano y los muebles se generan con web/scripts/oficina-assets.py; si cambia el plano base,
// se recalibra solo este archivo (usa ?calibrar en la pantalla para ver la rejilla y los puntos).
import manifiesto from "./oficina-manifiesto.json";

export type Dir = "frente" | "espalda" | "derecha" | "izquierda";
export type Punto = { x: number; y: number };
export type Puesto = Punto & { dir: Dir; nodo: string; sala?: string };

const E = manifiesto.escala_atlas;

export const PLANO = { archivo: manifiesto.plano.archivo, ancho: manifiesto.plano.ancho, alto: manifiesto.plano.alto };
export const ESCRITORIO = {
  ancho: manifiesto.escritorio.tamano[0] / E,
  alto: manifiesto.escritorio.tamano[1] / E,
  asiento: { x: manifiesto.escritorio.asiento[0] / E, y: manifiesto.escritorio.asiento[1] / E },
};
export const MESA = { ancho: manifiesto.mesa.tamano[0] / E, alto: manifiesto.mesa.tamano[1] / E };

// ── Área de trabajo: 5 columnas × 6 filas = 30 escritorios ─────────────────────────────────────
export const COLUMNAS = 5;
export const FILAS = 6;
export const ESCRITORIOS = COLUMNAS * FILAS;
const X0_ESC = 759, Y0_ESC = 160, PASO_X = 165, PASO_Y = 180;
const Y_PASILLO = (fila: number) => Y0_ESC + PASO_Y * fila + 148;   // pasillo bajo cada fila de escritorios
export const MESA_POS = { x: Math.round(1164 - MESA.ancho / 2), y: 1255 };

export type Escritorio = { indice: number; x: number; y: number; asiento: Punto; nodo: string };
export const escritorios: Escritorio[] = Array.from({ length: ESCRITORIOS }, (_, i) => {
  const fila = Math.floor(i / COLUMNAS), col = i % COLUMNAS;
  const x = X0_ESC + PASO_X * col, y = Y0_ESC + PASO_Y * fila;
  return { indice: i, x, y, asiento: { x: x + ESCRITORIO.asiento.x, y: y + ESCRITORIO.asiento.y }, nodo: `esc${i}` };
});

// ── Salas ────────────────────────────────────────────────────────────────────────────────────
const SALAS_REUNION = [0, 1, 2].map((k) => ({ id: `reunion${k + 1}`, nombre: `Sala de reuniones ${k + 1}`, desp: 159 + 258 * k }));
export const NOMBRES_SALAS = [
  { nombre: "Cocina y descanso", x: 40, y: 38 },
  ...SALAS_REUNION.map((s) => ({ nombre: s.nombre, x: 40, y: s.desp + 345 })),
  { nombre: "Oficina del gerente", x: 40, y: 1285 },
  { nombre: "Área de trabajo", x: 740, y: 50 },
];

// Puertas (centro del hueco y del muro). El pasillo va por x≈604.
const X_PASILLO = 604;
const PUERTAS_IZQ = { cocina1: 258, cocina2: 418, reunion1: 617, reunion2: 875, reunion3: 1133, gerente: 1398 } as const;
const PUERTAS_DER = [434, 932, 1412];

// ── Grafo de caminos ─────────────────────────────────────────────────────────────────────────
export type Nodo = Punto & { vecinos: string[] };
export const nodos: Record<string, Nodo> = {};
const nodo = (id: string, x: number, y: number) => { nodos[id] = { x, y, vecinos: [] }; return id; };
const unir = (...ids: string[]) => {
  for (let i = 0; i < ids.length - 1; i++) {
    const a = nodos[ids[i]], b = nodos[ids[i + 1]];
    if (!a || !b) throw new Error(`Nodo inexistente en el mapa: ${ids[i]} → ${ids[i + 1]}`);
    if (!a.vecinos.includes(ids[i + 1])) a.vecinos.push(ids[i + 1]);
    if (!b.vecinos.includes(ids[i])) b.vecinos.push(ids[i]);
  }
};

// Pasillo central
const ysPasillo = [215, ...Object.values(PUERTAS_IZQ), ...PUERTAS_DER, 1480].sort((a, b) => a - b);
const idPas = (y: number) => `pas${y}`;
for (const y of ysPasillo) nodo(idPas(y), X_PASILLO, y);
unir(...ysPasillo.map(idPas));
// Baño (puerta en su pared inferior)
nodo("bano_p", X_PASILLO, 190); nodo("bano", 600, 132); unir(idPas(215), "bano_p", "bano");

// Puertas y vestíbulos del muro izquierdo del pasillo
const vestibulo = (clave: string, y: number) => {
  nodo(`pu_${clave}`, 526, y); nodo(`in_${clave}`, 470, y);
  unir(idPas(y), `pu_${clave}`, `in_${clave}`);
  return `in_${clave}`;
};

// Cocina y descanso: dos mesas redondas (4 butacas cada una)
export const puestosDescanso: Puesto[] = [];
[0, 1].forEach((k) => {
  const d = 159 * k, y = k === 0 ? PUERTAS_IZQ.cocina1 : PUERTAS_IZQ.cocina2;
  const dentro = vestibulo(k === 0 ? "cocina1" : "cocina2", y);
  nodo(`coc${k}_e`, 425, 218 + d); nodo(`coc${k}_n`, 272, 141 + d); nodo(`coc${k}_o`, 150, 218 + d);
  unir(dentro, `coc${k}_e`, `coc${k}_n`, `coc${k}_o`);
  const sillas: [string, number, number, Dir, string][] = [
    ["ne", 332, 175, "izquierda", `coc${k}_e`], ["se", 327, 262, "izquierda", `coc${k}_e`],
    ["no", 220, 175, "derecha", `coc${k}_o`], ["so", 217, 262, "derecha", `coc${k}_o`],
  ];
  for (const [n, x, ys, dir, ref] of sillas) {
    const id = nodo(`silla${k}_${n}`, x + (dir === "izquierda" ? 46 : -46), ys + d - 4); unir(ref, id);
    puestosDescanso.push({ x, y: ys + d + 10, dir, nodo: id, sala: "descanso" });
  }
});

// Lugares de pie de la cocina (frente al mostrador) y otros rincones
export const puntosCocina: Puesto[] = [];
{
  nodo("coc_barra", 330, 148);
  unir("coc0_n", "coc_barra");
  for (const [n, x] of [["fregadero", 210], ["cafetera", 292], ["microondas", 392], ["refrigerador", 458]] as const) {
    const id = nodo(`coc_${n}`, x, 148); unir("coc_barra", id);
    puntosCocina.push({ x, y: 148, dir: "espalda", nodo: id, sala: "descanso" });
  }
}

// Salas de reuniones: 8 asientos cada una (3 arriba, 3 abajo y 2 en las cabeceras)
export type Sala = { id: string; nombre: string; asientos: Puesto[]; pizarra: Puesto };
export const salasReunion: Sala[] = SALAS_REUNION.map((s) => {
  const d = s.desp;
  const dentro = vestibulo(s.id, PUERTAS_IZQ[s.id as "reunion1" | "reunion2" | "reunion3"]);
  const abajo = nodo(`${s.id}_abajo`, 462, 553 + d), izq = nodo(`${s.id}_izq`, 115, 553 + d);
  const sube = nodo(`${s.id}_sube`, 115, 425 + d), cruce = nodo(`${s.id}_cruce`, 160, 392 + d), norte = nodo(`${s.id}_norte`, 160, 360 + d);
  const ancho = nodo(`${s.id}_der`, 462, 455 + d);
  unir(dentro, ancho, abajo, izq, sube, cruce, norte);
  const xs = [210, 287, 362];
  const asientos: Puesto[] = [];
  for (const i of [2, 1, 0]) {   // abajo (de espaldas): se encadenan de derecha a izquierda desde la esquina
    const x = xs[i];
    const id = nodo(`${s.id}_ab${i}`, x, 553 + d); unir(i === 2 ? abajo : `${s.id}_ab${i + 1}`, id);
    asientos.push({ x, y: 532 + d, dir: "espalda", nodo: id, sala: s.id });
  }
  unir(`${s.id}_ab0`, izq);
  const cab = nodo(`${s.id}_cab_d`, 462, 470 + d); unir(ancho, cab);
  asientos.push({ x: 425, y: 472 + d, dir: "izquierda", nodo: cab, sala: s.id });
  const cabI = nodo(`${s.id}_cab_i`, 115, 475 + d); unir(sube, cabI);
  asientos.push({ x: 150, y: 472 + d, dir: "derecha", nodo: cabI, sala: s.id });
  xs.forEach((x, i) => {   // arriba (de frente)
    const id = nodo(`${s.id}_ar${i}`, x, 360 + d);
    unir(i === 0 ? norte : `${s.id}_ar${i - 1}`, id);
    asientos.push({ x, y: 406 + d, dir: "frente", nodo: id, sala: s.id });
  });
  const piz = nodo(`${s.id}_pizarra`, 115, 470 + d); unir(sube, piz);
  return { id: s.id, nombre: s.nombre, asientos, pizarra: { x: 110, y: 505 + d, dir: "izquierda", nodo: piz, sala: s.id } };
});

// Oficina del gerente: espera de aprobación (de pie frente al escritorio)
export const colaGerente: Puesto[] = [];
{
  const dentro = vestibulo("gerente", PUERTAS_IZQ.gerente);
  const e = nodo("ger_este", 487, 1545); unir(dentro, e);
  let previo = e;
  [350, 300, 250, 200].forEach((x, i) => {
    const sur = nodo(`ger_sur${i}`, x, 1546); unir(previo, sur); previo = sur;
    colaGerente.push({ x, y: 1492, dir: "espalda", nodo: sur, sala: "gerente" });
  });
  [350, 300, 250, 200].forEach((x, i) => {   // segunda fila
    colaGerente.push({ x, y: 1522, dir: "espalda", nodo: `ger_sur${i}`, sala: "gerente" });
  });
}

// Área de trabajo: pasillos horizontales bajo cada fila, carriles laterales y puertas del muro derecho
const ysFila = Array.from({ length: FILAS }, (_, f) => Y_PASILLO(f));
const X_IZQ = 728, X_DER = 1600;
const ysLaterales = [130, ...ysFila, ...PUERTAS_DER].sort((a, b) => a - b);
for (const y of ysLaterales) { nodo(`li${y}`, X_IZQ, y); nodo(`ld${y}`, X_DER, y); }
unir(...ysLaterales.map((y) => `li${y}`));
unir(...ysLaterales.map((y) => `ld${y}`));
for (const y of PUERTAS_DER) { nodo(`mu${y}`, 678, y); unir(idPas(y), `mu${y}`, `li${y}`); }
nodo("copiadora", 1436, 114); unir("li130", "copiadora");
// Filas de escritorios
for (let f = 0; f < FILAS; f++) {
  const y = ysFila[f];
  const ids = [`li${y}`, ...Array.from({ length: COLUMNAS }, (_, c) => { const e = escritorios[f * COLUMNAS + c]; nodo(e.nodo, e.asiento.x, y); return e.nodo; }), `ld${y}`];
  unir(...ids);
}
unir("li130", `ld130`);   // pasillo superior (junto a la copiadora)

// Mesa de trabajo en conjunto (8 asientos) y sus carriles
export const asientosMesa: Puesto[] = manifiesto.mesa.asientos.map((a, i) => {
  const x = MESA_POS.x + a.x / E, y = MESA_POS.y + a.y / E;
  const arriba = a.dir === "frente";
  const id = nodo(`mesa${i}`, x, arriba ? 1236 : 1530);
  return { x, y, dir: a.dir as Dir, nodo: id, sala: "mesa" };
});
{
  const ys = Y_PASILLO(FILAS - 1);
  const izq = nodo("mesa_izq", 868, 1236), der = nodo("mesa_der", 1470, 1236);
  unir(`li${ys}`, nodo("mesa_li", X_IZQ, 1236), izq);
  unir(`ld${ys}`, nodo("mesa_ld", X_DER, 1236), der);
  unir("mesa_li", "li" + ys); unir("mesa_ld", "ld" + ys);
  for (let i = 0; i < 4; i++) unir(i === 0 ? izq : `mesa${i - 1}`, `mesa${i}`);
  unir("mesa3", der);
  const sur_i = nodo("mesa_sur_i", 868, 1530), sur_d = nodo("mesa_sur_d", 1470, 1530);
  unir(izq, nodo("mesa_lat_i", 868, 1380), sur_i); unir(der, nodo("mesa_lat_d", 1470, 1380), sur_d);
  for (let i = 4; i < 8; i++) unir(i === 4 ? sur_i : `mesa${i - 1}`, `mesa${i}`);
  unir("mesa7", sur_d);
}
export const esperaMesa: Puesto[] = [
  { x: 868, y: 1380, dir: "derecha", nodo: "mesa_lat_i", sala: "mesa" },
  { x: 1470, y: 1380, dir: "izquierda", nodo: "mesa_lat_d", sala: "mesa" },
];

// Rincones donde pasean los libres (de pie)
export const rincones: Puesto[] = [
  ...puntosCocina,
  { x: 1436, y: 114, dir: "derecha", nodo: "copiadora", sala: "area" },
  { x: 600, y: 132, dir: "frente", nodo: "bano", sala: "bano" },
  ...salasReunion.map((s) => s.pizarra),
  // pareja que charla en el pasillo, frente a frente
  { x: 580, y: 720, dir: "derecha", nodo: idPas(617), sala: "pasillo" },
  { x: 628, y: 720, dir: "izquierda", nodo: idPas(617), sala: "pasillo" },
  { x: 700, y: Y_PASILLO(4), dir: "izquierda", nodo: `li${Y_PASILLO(4)}`, sala: "area" },
];

// ── Rutas (Dijkstra sobre el grafo) ───────────────────────────────────────────────────────────
const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

export function nodoCercano(p: Punto): string {
  let mejor = "", d = Infinity;
  for (const [id, n] of Object.entries(nodos)) { const x = dist(p, n); if (x < d) { d = x; mejor = id; } }
  return mejor;
}

const cacheRutas = new Map<string, string[] | null>();
export function rutaNodos(desde: string, hasta: string): string[] | null {
  if (desde === hasta) return [desde];
  const clave = `${desde}>${hasta}`;
  const guardada = cacheRutas.get(clave);
  if (guardada !== undefined) return guardada;
  const d: Record<string, number> = { [desde]: 0 }, previo: Record<string, string> = {};
  const pendientes = new Set<string>([desde]);
  while (pendientes.size) {
    let u = "", m = Infinity;
    for (const id of pendientes) if (d[id] < m) { m = d[id]; u = id; }
    pendientes.delete(u);
    if (u === hasta) break;
    for (const v of nodos[u].vecinos) {
      const nd = d[u] + dist(nodos[u], nodos[v]);
      if (nd < (d[v] ?? Infinity)) { d[v] = nd; previo[v] = u; pendientes.add(v); }
    }
  }
  if (d[hasta] === undefined) { cacheRutas.set(clave, null); return null; }
  const ruta = [hasta];
  while (ruta[0] !== desde) ruta.unshift(previo[ruta[0]]);
  cacheRutas.set(clave, ruta);
  return ruta;
}
