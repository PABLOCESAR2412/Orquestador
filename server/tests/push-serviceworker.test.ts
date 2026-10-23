import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

async function recibirPush(respuesta: boolean | null, visible = true) {
  const mostradas: { titulo: string; opciones: Record<string, unknown> }[] = [];
  let escuchar: ((evento: unknown) => void) | undefined;
  let final: Promise<void> | undefined;
  class Canal {
    port1 = { onmessage: null as null | ((e: { data: unknown }) => void), close() {} };
    port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
  }
  runInNewContext(readFileSync(new URL("../../web/public/push-listener.js", import.meta.url), "utf8"), {
    MessageChannel: Canal,
    Notification: { permission: "granted" },
    setTimeout: (fn: () => void) => { queueMicrotask(fn); return 1; },
    clearTimeout() {},
    self: {
      addEventListener(tipo: string, fn: (e: unknown) => void) { if (tipo === "push") escuchar = fn; },
      clients: { matchAll: async () => visible ? [{ visibilityState: "visible", postMessage(_carga: unknown, puertos: Canal["port2"][]) { if (respuesta !== null) puertos[0].postMessage({ mostrada: respuesta }); } }] : [] },
      registration: { showNotification: async (titulo: string, opciones: Record<string, unknown>) => { mostradas.push({ titulo, opciones }); } },
    },
  });
  escuchar!({ data: { json: () => ({ titulo: "Telo", cuerpo: "Pendiente", url: "/tareas/1", etiqueta: "tarea-1" }) }, waitUntil(p: Promise<void>) { final = p; } });
  await final;
  return mostradas;
}

test("permiso concedido y ventana visible sin ACK no silencian el push", async () => {
  const avisos = await recibirPush(null);
  expect(avisos).toHaveLength(1);
  expect(avisos[0].opciones.tag).toBe("tarea-1");
  expect(avisos[0].opciones.renotify).toBe(false);
  expect(avisos[0].opciones.data).toEqual({ url: "/tareas/1", evento: undefined });
});

test("si la página tiene avisos locales desactivados el worker muestra el push", async () => {
  expect(await recibirPush(false)).toHaveLength(1);
});

test("solo un ACK de entrega real evita la segunda notificación", async () => {
  expect(await recibirPush(true)).toHaveLength(0);
  expect(await recibirPush(null, false)).toHaveLength(1);
});
