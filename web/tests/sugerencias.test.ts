import { describe, expect, test } from "bun:test";
import { sugerenciasChat } from "../src/lib/sugerencias";

describe("sugerenciasChat", () => {
  test("cambia según el último intercambio y conserva referencias a archivos", () => {
    const error = sugerenciasChat([
      { role: "user", content: "Corrige el error de la pantalla" },
      { role: "assistant", content: "Falló el test de web/src/pages/chat.tsx." },
    ]);
    const github = sugerenciasChat([
      { role: "user", content: "Prepara el commit y push" },
      { role: "assistant", content: "El diff está listo en la rama fix/chat." },
    ]);

    expect(error[0]).toContain("web/src/pages/chat.tsx");
    expect(github[0]).toContain("GitHub");
    expect(github[0]).not.toBe(error[0]);
  });

  test("espera una respuesta y un intercambio completo antes de sugerir", () => {
    expect(sugerenciasChat([{ role: "user", content: "Arregla la pantalla" }])).toEqual([]);
    expect(sugerenciasChat([
      { role: "assistant", content: "Ya está" },
      { role: "system", content: "No se pudo responder" },
    ])).toEqual([]);
  });
});
