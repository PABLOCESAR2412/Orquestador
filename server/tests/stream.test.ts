import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

const { cantidadSuscriptores, eventosDesde, publicar, ultimoEventoId } = await import("../src/bus");
const { stream } = await import("../src/routes/stream");
const app = new Hono().route("/api", stream);

describe("contrapresión del stream de eventos", () => {
  test("desconecta un lector lento con memoria acotada y conserva el buffer para reconectar", async () => {
    const cursor = ultimoEventoId();
    const response = await app.request("/api/eventos-vivos");
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const inicio = await reader.read();
    expect(new TextDecoder().decode(inicio.value)).toContain(`id: ${cursor}`);
    expect(cantidadSuscriptores()).toBe(1);

    for (let i = 0; i < 300; i++) {
      publicar({ tipo: "tarea", id: `tarea-${i}`, status: "running", finished_at: null });
    }

    expect(eventosDesde(cursor)).toHaveLength(100);
    expect(cantidadSuscriptores()).toBe(0);

    const recibidos: string[] = [];
    for (;;) {
      const parte = await reader.read();
      if (parte.done) break;
      recibidos.push(new TextDecoder().decode(parte.value));
    }
    expect(recibidos.join("")).toContain("event: tarea");
    expect(recibidos.length).toBeLessThanOrEqual(1);

    const reconexion = await app.request("/api/eventos-vivos", {
      headers: { "last-event-id": String(cursor) },
    });
    expect(reconexion.status).toBe(200);
    const lectorReconexion = reconexion.body!.getReader();
    expect(new TextDecoder().decode((await lectorReconexion.read()).value)).toContain(": ok");
    const eventosRecuperados: string[] = [];
    for (let i = 0; i < 100; i++) {
      const parte = await lectorReconexion.read();
      expect(parte.done).toBe(false);
      eventosRecuperados.push(new TextDecoder().decode(parte.value));
    }
    expect(eventosRecuperados[0]).toContain('"id":"tarea-200"');
    expect(eventosRecuperados.at(-1)).toContain('"id":"tarea-299"');
    await lectorReconexion.cancel();
    expect(cantidadSuscriptores()).toBe(0);
  });
});
