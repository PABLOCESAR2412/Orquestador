import { describe, expect, test } from "bun:test";
import { MotorOficina, asignarEscritorios, dirDe, type Entrada } from "../src/lib/oficina-motor";
import {
  ESCRITORIOS, PLANO, asientosMesa, colaGerente, escritorios, nodos, puestosDescanso, rincones, rutaNodos, salasReunion,
} from "../src/lib/oficina-mapa";

const chat = (id: string, extra: Partial<Entrada> = {}): Entrada => ({ id, titulo: id, estado: "libre", reciente: 0, ...extra });
const sub = (id: string, padre: string, extra: Partial<Entrada> = {}): Entrada => ({ id, titulo: id, padre, estado: "trabajando", reciente: 0, ...extra });
const correr = (m: MotorOficina, segundos: number, paso = 0.1) => { for (let t = 0; t < segundos; t += paso) m.avanzar(paso); };

describe("mapa de la oficina", () => {
  test("tiene 30 escritorios, 3 salas de reuniones de 8 asientos y una mesa de 8", () => {
    expect(escritorios).toHaveLength(30);
    expect(ESCRITORIOS).toBe(30);
    expect(salasReunion).toHaveLength(3);
    for (const s of salasReunion) expect(s.asientos).toHaveLength(8);
    expect(asientosMesa).toHaveLength(8);
  });

  test("todos los puntos caen dentro del plano y cada vecino es recíproco", () => {
    const puntos = [
      ...escritorios.map((e) => e.asiento), ...asientosMesa, ...colaGerente, ...puestosDescanso, ...rincones,
      ...salasReunion.flatMap((s) => s.asientos),
    ];
    for (const p of puntos) {
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(PLANO.ancho);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(PLANO.alto);
    }
    for (const [id, n] of Object.entries(nodos)) for (const v of n.vecinos) expect(nodos[v].vecinos).toContain(id);
  });

  test("todo puesto tiene ruta desde la puerta del baño (el grafo está conectado)", () => {
    const destinos = [
      ...escritorios.map((e) => e.nodo), ...asientosMesa.map((p) => p.nodo), ...colaGerente.map((p) => p.nodo),
      ...puestosDescanso.map((p) => p.nodo), ...rincones.map((p) => p.nodo), ...salasReunion.flatMap((s) => s.asientos.map((p) => p.nodo)),
    ];
    for (const d of destinos) expect(rutaNodos("bano", d)).not.toBeNull();
  });
});

describe("escritorios estables", () => {
  test("conserva el escritorio de quien ya tenía y reparte los libres por prioridad", () => {
    const primera = asignarEscritorios(new Map(), [chat("a", { reciente: 1 }), chat("b", { reciente: 2 }), chat("c", { reciente: 3 })]);
    expect(new Set(primera.values()).size).toBe(3);
    const segunda = asignarEscritorios(primera, [chat("a"), chat("b"), chat("c"), chat("d", { estado: "trabajando" })]);
    for (const id of ["a", "b", "c"]) expect(segunda.get(id)).toBe(primera.get(id));
    expect(new Set(segunda.values()).size).toBe(4);
  });

  test("con más de 30 chats solo los 30 más activos o recientes tienen escritorio", () => {
    const chats = Array.from({ length: 34 }, (_, i) => chat(`c${i}`, { reciente: i }));
    chats.push(chat("activo", { estado: "trabajando", reciente: -1 }));
    const m = asignarEscritorios(new Map(), chats);
    expect(m.size).toBe(30);
    expect(m.has("activo")).toBe(true);
    expect(m.has("c0")).toBe(false);
    expect(new Set(m.values()).size).toBe(30);
  });
});

describe("estados y destinos", () => {
  test("al cargar, quien trabaja aparece sentado en su escritorio con el monitor encendido", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando" }), chat("b")]);
    const a = m.actores.get("a")!;
    const e = escritorios[a.escritorio!];
    expect([a.x, a.y]).toEqual([e.asiento.x, e.asiento.y]);
    expect(a.pose).toBe("teclea");
    expect(m.encendidos.has(a.escritorio!)).toBe(true);
    expect(m.encendidos.has(m.actores.get("b")!.escritorio!)).toBe(false);
  });

  test("si empieza a trabajar con la pantalla abierta, camina a su escritorio y lo enciende al llegar", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a")]);
    correr(m, 120);   // ya está paseando o sentado
    m.sincronizar([chat("a", { estado: "trabajando" })]);
    const a = m.actores.get("a")!;
    correr(m, 60);
    expect(a.pose).toBe("teclea");
    expect(a.llegado).toBe(true);
    expect(m.encendidos.has(a.escritorio!)).toBe(true);
  });

  test("un supervisor con subagentes trabajando se sienta en la mesa conjunta, abajo primero", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando" }), sub("h1", "a"), sub("h2", "a")]);
    const lugares = ["a", "h1", "h2"].map((id) => m.actores.get(id)!);
    for (const x of lugares) expect(x.destino?.clave.startsWith("mesa:")).toBe(true);
    expect(new Set(lugares.map((x) => x.destino!.clave)).size).toBe(3);
    expect(lugares.every((x) => x.pose === "teclea")).toBe(true);
  });

  test("una delegación nueva pasa por una sala de reuniones y luego a la mesa", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando" })]);
    m.sincronizar([chat("a", { estado: "trabajando" }), sub("h1", "a")]);
    expect(m.actores.get("a")!.destino!.clave.startsWith("sala:")).toBe(true);
    expect(m.actores.get("h1")!.destino!.clave.startsWith("sala:")).toBe(true);
    expect(m.actores.get("h1")!.destino!.pose).toBe("sentado");
    correr(m, 40);   // la reunión dura 8 s de convención visual
    expect(m.actores.get("a")!.destino!.clave.startsWith("mesa:")).toBe(true);
    expect(m.actores.get("h1")!.destino!.clave.startsWith("mesa:")).toBe(true);
  });

  test("en modo plan el supervisor planifica sentado en una sala de reuniones", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando", planificando: true })]);
    expect(m.actores.get("a")!.destino!.clave.startsWith("sala:")).toBe(true);
    m.sincronizar([chat("a", { estado: "trabajando", planificando: false })]);
    expect(m.actores.get("a")!.destino!.clave.startsWith("esc:")).toBe(true);
  });

  test("tres supervisores planificando usan tres salas distintas", () => {
    const m = new MotorOficina();
    m.sincronizar(["a", "b", "c"].map((id) => chat(id, { estado: "trabajando", planificando: true })));
    const salas = new Set(["a", "b", "c"].map((id) => m.actores.get(id)!.destino!.clave.split(":")[1]));
    expect(salas.size).toBe(3);
  });

  test("quien espera aprobación hace fila de pie frente al gerente, con marca ámbar", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "aprobacion" }), chat("b", { estado: "aprobacion" })]);
    const a = m.actores.get("a")!, b = m.actores.get("b")!;
    expect(a.marca).toBe("aprobacion");
    expect(a.destino!.clave.startsWith("cola:")).toBe(true);
    expect(a.destino!.clave).not.toBe(b.destino!.clave);
    expect(a.pose).toBe("parado");
  });

  test("un subagente que termina se va y sus asientos quedan libres", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando" }), sub("h1", "a")]);
    m.sincronizar([chat("a", { estado: "trabajando" })]);
    expect(m.actores.has("h1")).toBe(false);
    expect(m.actores.get("a")!.destino!.clave.startsWith("esc:")).toBe(true);
  });

  test("con más de ocho integrantes en la mesa, los demás esperan de pie junto a ella", () => {
    const m = new MotorOficina();
    const hijos = Array.from({ length: 9 }, (_, i) => sub(`h${i}`, "a"));
    m.sincronizar([chat("a", { estado: "trabajando" }), ...hijos]);
    const claves = [...m.actores.values()].map((x) => x.destino!.clave);
    expect(new Set(claves).size).toBe(claves.length);   // nadie comparte puesto
    expect(claves.filter((c) => c.startsWith("mesa:e")).length).toBe(2);
  });

  test("más de 30 chats: los que no tienen escritorio no se dibujan y se cuentan", () => {
    const m = new MotorOficina();
    m.sincronizar(Array.from({ length: 33 }, (_, i) => chat(`c${i}`, { reciente: i })));
    expect(m.actores.size).toBe(30);
    expect(m.sinEscritorio).toBe(3);
  });
});

describe("movimiento", () => {
  test("los libres cambian de lugar con el tiempo y nunca comparten puesto", () => {
    const m = new MotorOficina();
    m.sincronizar(Array.from({ length: 20 }, (_, i) => chat(`c${i}`)));
    const vistos = new Set<string>();
    for (let t = 0; t < 400; t += 0.5) {
      m.avanzar(0.5);
      const ocupados = [...m.actores.values()].filter((a) => a.llegado && a.destino).map((a) => a.destino!.clave);
      expect(new Set(ocupados).size).toBe(ocupados.length);
      for (const a of m.actores.values()) if (a.destino?.clave.startsWith("ocio:")) vistos.add(a.destino.clave);
    }
    expect(vistos.size).toBeGreaterThan(3);
  });

  test("es determinista: la misma semilla produce los mismos recorridos", () => {
    const entradas = Array.from({ length: 8 }, (_, i) => chat(`c${i}`));
    const instantanea = () => {
      const m = new MotorOficina(7); m.sincronizar(entradas); correr(m, 200, 0.25);
      return [...m.actores.values()].map((a) => [a.id, Math.round(a.x), Math.round(a.y), a.pose]);
    };
    expect(instantanea()).toEqual(instantanea());
  });

  test("el personaje de un chat es siempre el mismo", () => {
    const a = new MotorOficina(); a.sincronizar([chat("chat-x")]);
    const b = new MotorOficina(); b.sincronizar([chat("chat-x")]);
    expect(a.actores.get("chat-x")!.personaje).toBe(b.actores.get("chat-x")!.personaje);
  });

  test("la dirección sigue el eje dominante del movimiento", () => {
    expect(dirDe(0, 5, "frente")).toBe("frente");
    expect(dirDe(0, -5, "frente")).toBe("espalda");
    expect(dirDe(5, 1, "frente")).toBe("derecha");
    expect(dirDe(-5, 1, "frente")).toBe("izquierda");
    expect(dirDe(0, 0, "izquierda")).toBe("izquierda");
  });

  test("caminar no atraviesa el tiempo: llega a la cola del gerente desde el área de trabajo", () => {
    const m = new MotorOficina();
    m.sincronizar([chat("a", { estado: "trabajando" })]);
    m.sincronizar([chat("a", { estado: "aprobacion" })]);
    const a = m.actores.get("a")!;
    expect(a.pose).toBe("camina");
    correr(m, 90);
    expect(a.llegado).toBe(true);
    expect([a.x, a.y]).toEqual([a.destino!.x, a.destino!.y]);
  });
});
