import { expect, test } from "bun:test";
import { iniciarVigilante, leerConTope } from "../src/runners/proteccion";

test("leer con tope conserva el arranque y la cola bajo un tope de RAM", async () => {
  const trozo = "x".repeat(5 * 1024 * 1024);
  const flujo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(new TextEncoder().encode(trozo));
      control.enqueue(new TextEncoder().encode(trozo));
      control.enqueue(new TextEncoder().encode("cola-final"));
      control.close();
    },
  });
  const texto = await leerConTope(flujo, 6 * 1024 * 1024);
  expect(texto.startsWith(trozo.slice(0, 100_000))).toBe(true);
  expect(texto.endsWith("cola-final")).toBe(true);
  expect(texto).toContain("recortada");
});

test("el vigilante sin tope no corta nada y se apaga limpio", () => {
  let cortes = 0;
  const vigilante = iniciarVigilante({
    pid: 9999999,
    tiempoSinActividadMs: null,
    cortar: () => (cortes += 1),
  });
  vigilante.patada();
  vigilante.patada();
  vigilante.detener();
  expect(vigilante.silenciado()).toBe(false);
  expect(cortes).toBe(0);
});

test("un tope por debajo del mínimo tampoco activa el reloj del vigilante", () => {
  const vigilante = iniciarVigilante({ pid: 9999999, tiempoSinActividadMs: 5_000, cortar: () => {} });
  expect(vigilante.silenciado()).toBe(false);
  vigilante.detener();
});
