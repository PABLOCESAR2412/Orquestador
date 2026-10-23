import { describe, expect, test } from "bun:test";

// Almacenamiento en memoria para probar los borradores fuera del navegador.
const memoria = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (clave: string) => memoria.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void memoria.set(clave, valor),
    removeItem: (clave: string) => void memoria.delete(clave),
  },
  configurable: true,
});

const { leerBorrador, guardarBorrador, leerEnvio, guardarEnvio, borrarEnvio } = await import(
  "../src/lib/chat-borrador"
);

describe("borradores y envíos en vuelo", () => {
  test("el borrador por chat se guarda, se lee y se vacía", () => {
    guardarBorrador("a", "hola mundo");
    expect(leerBorrador("a")).toBe("hola mundo");
    guardarBorrador("a", "");
    expect(leerBorrador("a")).toBe("");
    expect(memoria.has("telo:borrador:a")).toBe(false);
  });

  test("el marcador de envío en vuelo guarda texto y contenido, y se borra al confirmar", () => {
    guardarEnvio("c", "borrador tal cual", "contenido compuesto");
    const envio = leerEnvio("c");
    expect(envio?.texto).toBe("borrador tal cual");
    expect(envio?.contenido).toBe("contenido compuesto");
    expect(envio?.fecha).toBeGreaterThan(0);
    borrarEnvio("c");
    expect(leerEnvio("c")).toBe(null);
  });

  test("un marcador corrupto o incompleto devuelve nulo sin romper", () => {
    memoria.set("telo:envio:x", "{no-json");
    expect(leerEnvio("x")).toBe(null);
    memoria.set("telo:envio:y", JSON.stringify({ texto: 3, contenido: true }));
    expect(leerEnvio("y")).toBe(null);
    expect(leerBorrador("sin-clave")).toBe("");
  });
});
