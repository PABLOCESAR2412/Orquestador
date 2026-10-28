import { expect, test } from "bun:test";
import { iniciarVigilante, leerConTope, tiempoSinActividadConfigurado, TIEMPO_SIN_ACTIVIDAD_PREDETERMINADO_MS } from "../src/runners/proteccion";

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
    tiempoSinActividadMs: null,
    cortar: () => (cortes += 1),
  });
  vigilante.patada();
  vigilante.patada();
  vigilante.detener();
  expect(vigilante.silenciado()).toBe(false);
  expect(cortes).toBe(0);
});

test("un valor de entorno por debajo del mínimo vuelve al límite seguro predeterminado", () => {
  const vigilante = iniciarVigilante({ tiempoSinActividadMs: 5_000, cortar: () => {} });
  vigilante.detener();
  expect(tiempoSinActividadConfigurado("5000")).toBe(TIEMPO_SIN_ACTIVIDAD_PREDETERMINADO_MS);
});

test("un valor cero o inválido de entorno conserva el watchdog seguro de 15 minutos", () => {
  expect(tiempoSinActividadConfigurado("0")).toBe(TIEMPO_SIN_ACTIVIDAD_PREDETERMINADO_MS);
  expect(tiempoSinActividadConfigurado("no-es-numero")).toBe(TIEMPO_SIN_ACTIVIDAD_PREDETERMINADO_MS);
  expect(tiempoSinActividadConfigurado("60000")).toBe(60_000);
});

test("el vigilante corta por falta de salida aun si el proceso sigue ejecutándose", async () => {
  let cortes = 0;
  const vigilante = iniciarVigilante({ tiempoSinActividadMs: 25, cortar: () => cortes++ });
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(vigilante.silenciado()).toBe(true);
  expect(cortes).toBe(1);
  vigilante.detener();
});
