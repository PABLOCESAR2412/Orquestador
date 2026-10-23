import { expect, test } from "bun:test";
import { actualizarVentanaMensajes } from "../src/lib/chat-mensajes";
import type { Message, PaginaMensajes } from "../src/api";
import { api } from "../src/api";

const mensaje = (n: number): Message & { cursor: number } => ({ id: String(n), conversation_id: "c", role: "user", content: `Mensaje ${n}`, created_at: "2026-10-23", cursor: n });
test("reconcilia avisos retirados y compactaciones sin volver a descargar su contenido", () => {
  const pagina: PaginaMensajes = { messages: [mensaje(3)], vigentes: [{ id: "1", sesion_compactada: 1 }, { id: "3", sesion_compactada: 0 }], anterior: null, ultimo: 3, mas: false, reiniciar: false };
  const actualizada = actualizarVentanaMensajes([mensaje(1), mensaje(2)], pagina);
  expect(actualizada.map(m => m.id)).toEqual(["1", "3"]);
  expect(actualizada[0]?.sesion_compactada).toBe(1);
});
test("la memoria y la representación quedan limitadas a 120 mensajes", () => {
  const anteriores = Array.from({ length: 120 }, (_, n) => mensaje(n));
  const nuevos = Array.from({ length: 40 }, (_, n) => mensaje(120 + n));
  const pagina: PaginaMensajes = { messages: nuevos, vigentes: [...anteriores, ...nuevos].map(m => ({ id: m.id, sesion_compactada: 0 })), anterior: 1, ultimo: 159, mas: false, reiniciar: false };
  const actualizada = actualizarVentanaMensajes(anteriores, pagina);
  expect(actualizada).toHaveLength(120);
  expect(actualizada[0]?.id).toBe("40"); expect(actualizada.at(-1)?.id).toBe("159");
});
test("exportar recorre todas las páginas explícitamente y conserva el orden", async () => {
  const original = globalThis.fetch;
  const consultas: string[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const ruta = String(entrada); consultas.push(ruta);
    const anterior = new URL(ruta, "http://telo").searchParams.get("antes");
    return Response.json({ messages: anterior ? [mensaje(1), mensaje(2)] : [mensaje(3), mensaje(4)], anterior: anterior ? null : 3, ultimo: anterior ? 2 : 4, mas: false, vigentes: [], reiniciar: false });
  }) as typeof fetch;
  try {
    expect((await api.allMessages("c")).map(m => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(consultas).toHaveLength(2);
    expect(consultas[1]).toContain("antes=3");
  } finally { globalThis.fetch = original; }
});
