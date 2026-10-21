import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

const { cantidadSuscriptores, eventosDesde, publicar } = await import("../src/bus");
const { stream } = await import("../src/routes/stream");
const app = new Hono().route("/api", stream);

describe("contrapresión del stream de eventos", () => {
  test("desconecta un lector lento con memoria acotada y conserva el buffer para reconectar", async () => {
    const cursor = publicar({ tipo: "chat", conversacion_id: "cursor-inicial", estado: "terminado" });
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

  test("el sondeo fija un cursor inicial y entrega eventos nuevos sin mantener SSE abierto", async () => {
    const cursorInicial = publicar({ tipo: "chat", conversacion_id: "cursor-poll", estado: "terminado" });
    const inicio = await app.request("/api/eventos-vivos/poll?espera=0");
    expect(inicio.status).toBe(200);
    expect(await inicio.json()).toEqual({ cursor: cursorInicial, eventos: [] });

    const pendiente = app.request(`/api/eventos-vivos/poll?desde=${cursorInicial}&espera=8000`);
    await Bun.sleep(10);
    const id = publicar({ tipo: "chat", conversacion_id: "conv-poll", estado: "en_curso" });
    const response = await pendiente;
    const lote = await response.json() as { cursor: number; eventos: { id: number; evento: unknown }[] };

    expect(response.status).toBe(200);
    expect(lote.cursor).toBe(id);
    expect(lote.eventos).toEqual([{ id, evento: { tipo: "chat", conversacion_id: "conv-poll", estado: "en_curso" } }]);
    expect(cantidadSuscriptores()).toBe(0);
  });

  test("el sondeo rechaza cursores y esperas inválidos", async () => {
    expect((await app.request("/api/eventos-vivos/poll?desde=-1")).status).toBe(400);
    expect((await app.request("/api/eventos-vivos/poll?espera=10000")).status).toBe(400);
    expect((await app.request("/api/eventos-vivos/poll?espera=15000")).status).toBe(400);
    expect((await app.request("/api/eventos-vivos/poll?espera=20000")).status).toBe(400);
  });
});
