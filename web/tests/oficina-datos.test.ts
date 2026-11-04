import { describe, expect, test } from "bun:test";
import type { Conversation } from "../src/api";
import { entradasDesdeConversaciones, estadoEntrada, recortarTexto } from "../src/lib/oficina-datos";

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({ id, title: id, model: null, effort: null, created_at: "2026-11-02T10:00:00Z", ...extra });

describe("datos de la oficina", () => {
  test("traduce el estado de cada chat", () => {
    expect(estadoEntrada(conv("a"))).toBe("libre");
    expect(estadoEntrada(conv("a", { en_proceso: true }))).toBe("trabajando");
    expect(estadoEntrada(conv("a", { ocupada: true }))).toBe("trabajando");
    expect(estadoEntrada(conv("a", { pendiente_aprobacion: true, en_proceso: true }))).toBe("aprobacion");
  });

  test("solo los subagentes que corren aparecen, ligados a su supervisor", () => {
    const hijos = [
      conv("h1", { parent_conversation_id: "a", subagent_status: "running", subagent_agent: "telo-auditor" }),
      conv("h2", { parent_conversation_id: "a", subagent_status: "done" }),
      conv("h3", { parent_conversation_id: "a", subagent_status: "failed" }),
    ];
    const entradas = entradasDesdeConversaciones([conv("a", { en_proceso: true, subchats: hijos }), conv("b")], new Map());
    expect(entradas.map((e) => [e.id, e.padre ?? null])).toEqual([["a", null], ["h1", "a"], ["b", null]]);
    expect(entradas[1].titulo).toBe("telo-auditor");
  });

  test("planifica solo si está trabajando en modo plan, y la burbuja solo si trabaja", () => {
    const e = entradasDesdeConversaciones([
      conv("a", { en_proceso: true, work_mode: "plan" }), conv("b", { work_mode: "plan" }), conv("c", { en_proceso: true, work_mode: "build" }),
    ], new Map([["a", "Leyendo archivos"], ["b", "Algo"]]));
    expect(e.map((x) => x.planificando)).toEqual([true, false, false]);
    expect(e.map((x) => x.actividad)).toEqual(["Leyendo archivos", null, null]);
  });

  test("recorta textos largos con elipsis", () => {
    expect(recortarTexto("a".repeat(40), 10)).toBe("aaaaaaaaa…");
    expect(recortarTexto("  espacios   dobles ")).toBe("espacios dobles");
  });

  test("ignora los chats que son subagentes en la lista principal", () => {
    const e = entradasDesdeConversaciones([conv("h", { parent_conversation_id: "a" })], new Map());
    expect(e).toHaveLength(0);
  });

  test("el personaje usa su apodo y el chat conserva su título", () => {
    const supervisor = conv("a", { title: "Título del chat", apodo_oficina: "Nora" });
    supervisor.subchats = [conv("h", {
      parent_conversation_id: "a", subagent_status: "running", subagent_agent: "revisor", apodo_oficina: "Luz",
    })];
    expect(entradasDesdeConversaciones([supervisor], new Map()).map((e) => e.titulo)).toEqual(["Nora", "Luz"]);
    expect(supervisor.title).toBe("Título del chat");
  });
});
