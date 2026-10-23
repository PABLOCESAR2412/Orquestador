import { describe, expect, test } from "bun:test";
import type { Conversation, PaginaConversaciones } from "../src/api";
import { normalizaPaginaConversaciones } from "../src/lib/pagina-conversaciones";

const chat = (id: string): Conversation => ({
  id,
  title: `Chat ${id}`,
  model: null,
  effort: null,
});

describe("normalizaPaginaConversaciones", () => {
  test("la página del servidor actual pasa sin cambios", () => {
    const pagina: PaginaConversaciones = { conversations: [chat("a")], siguiente: "b" };
    expect(normalizaPaginaConversaciones(pagina)).toBe(pagina);
  });

  test("el array plano de un servidor anterior se envuelve con siguiente=null", () => {
    const plano = [chat("a"), chat("b")];
    expect(normalizaPaginaConversaciones(plano)).toEqual({ conversations: plano, siguiente: null });
  });

  test("un array vacío también queda como página sin memoria", () => {
    expect(normalizaPaginaConversaciones([])).toEqual({ conversations: [], siguiente: null });
  });
});
